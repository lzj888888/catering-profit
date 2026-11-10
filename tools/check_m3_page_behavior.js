// tools/check_m3_page_behavior.js —— M3 成本卡编辑页 **行为**守卫（R568）
// 运行：node tools/check_m3_page_behavior.js   （由 verify_all.js 的 [m3-page-behavior] 调用）
//
// 为什么必须有这一层（2026-10-29 实测）：
//   `subpkg/biz/card/edit.js::onPickCategory` 里写着
//       const wasEmpty = this.data.lines.length === 0;
//   而新建页 `load()` 初始化就塞了一行出厂空行（`emptyLine()`）⇒ 该判据 **恒假** ⇒
//   「空卡补示例主料」整段是**死代码**。后果不是观感问题，是**数字失真**：
//   新建 → 选「热炒荤菜」只得到调料一行 ⇒ 38 元的菜成本只剩 ¥0.51、毛利率 **98.66%**。
//   而既有 219 个套件**一条都没转红**：`category-presets` 只守品类数据单源、`check_dish_category_free`
//   只守「分类可自由输入」，**没有一条真跑过 onPickCategory**。
//
// 与既往守卫的分工（别重复造）：
//   · `utils/categoryPresets.selftest.js` = **数据**面（默认值/出净率/燃料）；
//   · 本套件 = **行为**面（页面源码真 require + 真调 onPickCategory，看 setData 真正送出什么）。
//   ⚠️ 抄一份循环出来测会掩盖「页面根本没接上」（R298Y 教训：**读到了 ≠ 送出去了**）。
//
// 🔴 R675（2026-11-10）本套件**改造成反向守卫**。
//   历史：R568~R636 它测「选品类后到底预填了什么」（A 空卡 / B 已有行 / C 11 品类 / D 变异）。
//   李老师决定删掉「这道菜属于哪类」后，那些判据全部失效。
//   **删功能不等于丢掉守卫** —— 改成守三件事：
//     S 品类默认模板**删干净了**（方法/wxml 界面/燃气开关/估算卡横幅，剥注释后判）
//     R 没删过头（category 字段仍在、列表筛选仍用、品类预设文件与 cardEst 保留给导入路径）
//     Y 🔴 **出净率不能掉回 100** —— 品类原本是唯一给净率的人，它一走必须有接手方：
//        模板行自带（applyTemplate 输出 yield_rate）+ 选原料时按原料联动（yieldOf）
//     M 变异回灌：把 onPickCategory 加回 / 去掉 yield_rate / 去掉 yieldOf ⇒ 对应判据必须转红
//   G 导入页「从剪贴板粘贴」（R570-G，与品类无关，**原样保留**）：
//     绑定在场 / 有内容就填并自动出预览 / 已有内容**追加不覆盖** /
//     剪贴板空与读失败都要说人话 / API 缺失不崩 / 变异回灌（改成覆盖式必须转红）
//
// fail-closed：源码缺失 / 捕获不到 Page 配置 / 变异不转红 ⇒ 一律判红，绝不静默跳过。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDIT = path.join(ROOT, 'subpkg', 'biz', 'card', 'edit.js');
const PRESETS = path.join(ROOT, 'utils', 'categoryPresets.js');
const CONDIMENT = '调料(含油盐酱醋)';

let pass = 0, failN = 0;
const bad = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
  else { failN++; bad.push(name + (detail ? ' · ' + detail : '')); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
}

// ---------- 桩：把页面源码真跑起来 ----------
function makeStubs() {
  const store = {};
  let cfg = null;
  const toasts = [];
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    showToast: (o) => { toasts.push(o && o.title); },
    showModal: (o) => toasts.push('MODAL:' + ((o && o.content) || '')),
    showLoading: () => {}, hideLoading: () => {},
    setNavigationBarTitle: () => {}, setNavigationBarColor: () => {},
    stopPullDownRefresh: () => {}, navigateTo: () => {}, navigateBack: () => {},
    redirectTo: () => {}, reLaunch: () => {}, switchTab: () => {},
    getSystemInfoSync: () => ({ windowHeight: 800 }),
    requestSubscribeMessage: () => {}, vibrateShort: () => {},
    cloud: { callFunction: () => Promise.resolve({ result: { code: 'SUCCESS', data: {} } }) },
  };
  return { getCfg: () => cfg, toasts };
}

/** 用给定的源码文本加载页面（正常态 = 原文件；变异态 = 替换后的文本）
 *  file 必填时指向另一个页面（R570-G 用它测 subpkg/biz/card/import.js）；不传则默认编辑页。 */
function loadPage(srcText, tag, file) {
  const target = file || EDIT;
  const stubs = makeStubs();
  const dir = path.dirname(target);
  const fakeRequire = (p) => {
    const abs = /^[./]/.test(String(p)) ? path.resolve(dir, p) : String(p);
    return require(abs);
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', srcText)(
    mod, mod.exports, fakeRequire, dir, target
  );
  const cfg = stubs.getCfg();
  if (!cfg) throw new Error(tag + '：捕获不到 Page 配置');
  return { cfg, toasts: stubs.toasts };
}

/** 造一个可跑的页面实例（setData 真合并到 this.data，与小程序行为一致） */
function newPage(cfg, lines) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data || {}));
  if (Array.isArray(lines)) p.data.lines = JSON.parse(JSON.stringify(lines));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}

const namesOf = (lines) => (lines || []).map((l) => l.material_name || '');
const blankOf = (lines) => (lines || []).filter(
  (l) => !String(l.material_id || '').trim() && !String(l.material_name || '').trim() && !String(l.qty || '').trim()
).length;

// ============ S 🔴 品类默认模板已删干净（R675 反向守卫）============
// 为什么从「正向测预填」改成「反向守删除」：
//   2026-11-10 李老师决定删掉「这道菜属于哪类」，理由是
//     ① 示例主料是错的起点（建宫保鸡丁也拿到「猪肉 150 克」）；
//     ② 调料 0.5 元/份、燃气 0.15~0.4 元/份都没出处；
//     ③ 燃气属期间费用（M1 已有真实账单科目），菜品级再摊一次＝同一笔钱记两处。
//   功能删掉后旧判据全部失效 —— **但删功能不等于丢掉守卫**：
//     删不干净（方法删了 wxml 还留着 picker）⇒ 老板一点就报错；
//     被偷偷加回来 ⇒ 那三条错误重新成立，必须有人重新审。
console.log('\n===== S 品类默认模板已删干净（剥注释后判，防「注释里写着删了」假绿）=====');
// EDIT 在文件头已声明，这里只补 WXML/LIST/TPL（避免重复声明）
const WXML = path.join(ROOT, 'subpkg', 'biz', 'card', 'edit.wxml');
const LIST = path.join(ROOT, 'subpkg', 'biz', 'card', 'index.js');
const TPL = path.join(ROOT, 'utils', 'dishTemplates.js');
const readIf = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
// 剥注释：否则「注释里说明为什么删掉 onPickCategory」会被判成「方法还在」
const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const editSrc = readIf(EDIT);
const editCode = stripC(editSrc);
const wxmlCode = stripC(readIf(WXML));

check('S1 编辑页源码存在且可读', editSrc.length > 1000, editSrc.length + ' 字符');
['onPickCategory', 'onClearCategory', 'onToggleEnergy'].forEach((m, i) => {
  check('S' + (2 + i) + ' 🔴 `' + m + '` 已删除（代码里不得出现）',
    editCode.indexOf(m) < 0, editCode.indexOf(m) < 0 ? '已删' : '仍在代码中');
});
check('S5 🔴 「选品类」picker 已从界面删除（方法删了但界面还在 ⇒ 点了报错）',
  wxmlCode.indexOf('onPickCategory') < 0 && wxmlCode.indexOf('catOptions') < 0);
check('S6 🔴 「燃气燃料分摊」开关已删（期间费用，M1 已有真实账单，菜品级不再摊）',
  wxmlCode.indexOf('energyFen') < 0 && wxmlCode.indexOf('onToggleEnergy') < 0);
check('S7 🔴 「估算卡」黄底横幅已删（没有品类预填了，就不存在"估算卡"）',
  wxmlCode.indexOf('est-banner') < 0 && wxmlCode.indexOf('hasPreset') < 0);

console.log('\n===== R 删品类时不能删过头的三样 =====');
check('R1 `category` 字段仍保留 —— 列表筛选/搜索还在用，只是不再参与计算',
  wxmlCode.indexOf('t.category') >= 0 && editCode.indexOf('category:') >= 0);
check('R2 列表页仍按 category 出筛选项',
  /category/i.test(readIf(LIST)), 'index.js 仍引用 category');
check('R3 品类预设文件**必须保留** —— 导入 Excel（import.js）还在用它识别菜品分类',
  fs.existsSync(PRESETS) && /CATEGORY_PRESETS/.test(readIf(path.join(ROOT, 'subpkg', 'biz', 'card', 'import.js'))));
check('R4 `utils/cardEst.js` 保留 —— 导入路径 dishImport.js 仍在用 isEstimatedCard',
  fs.existsSync(path.join(ROOT, 'utils', 'cardEst.js'))
  && /isEstimatedCard/.test(readIf(path.join(ROOT, 'utils', 'dishImport.js'))));

// ============ Y 🔴 出净率不能掉回 100（删品类最容易出的洞）============
// 品类原本是唯一给净率的人。它一走，若没人接（模板行不带 / 选原料不联动），
// 整条鱼的成本会低估 35%，而且**界面毫无提示** —— 这是本轮最需要守住的一条。
console.log('\n===== Y 🔴 出净率不能掉回 100 =====');
const tplSrc = readIf(TPL);
check('Y1 🔴 `applyTemplate` 输出带 `yield_rate`（模板行自己带净率）',
  /function applyTemplate/.test(tplSrc) && /yield_rate/.test(stripC(tplSrc.slice(tplSrc.indexOf('function applyTemplate')))));
check('Y2 🔴 编辑页套模板时读 `r.yield_rate`，且**不再**出现 catYieldDefault',
  /String\(r\.yield_rate/.test(editCode) && editCode.indexOf('catYieldDefault') < 0);
check('Y3 🔴 选原料时按原料自动带出净率（`yieldOf` 被真调用，不是只 import）',
  /yieldOf\(/.test(editCode),
  /yieldOf\(/.test(editCode) ? '已联动' : '未联动 ⇒ 选草鱼仍按 100 算，成本低估 35%');
check('Y4 只在「空/默认 100」时才覆盖 —— 老板手改过的值不能被机器改回去（R626 教训）',
  /yield_rate:\s*\(\s*!lines\[idx\]\.yield_rate/.test(editCode));

// ============ M 变异回灌：判据不能恒绿 ============
console.log('\n===== M 变异回灌：判据有分辨力吗 =====');
{
  const mutated = editCode + '\n  onPickCategory(e) { return e; }\n';
  check('M-① 变异体（加回 onPickCategory）能被 S2 抓到', mutated.indexOf('onPickCategory') >= 0);
  check('M-② 原代码里确实没有 onPickCategory（M-① 不是恒真）', editCode.indexOf('onPickCategory') < 0);
}
{
  const idx = tplSrc.indexOf('function applyTemplate');
  const tail = tplSrc.slice(idx);
  const mutated = tail.replace(/\n\s*yield_rate:[^\n]*\n/g, '\n');
  // ⚠️ 首跑这条是红的 —— **不是判据失效，是判据被自己的注释命中**：applyTemplate 里
  //   注释写着「行上若显式写了 yield_rate…」，变异只删了代码行、注释还在 ⇒ 字面仍含 yield_rate。
  //   和 L-④（check_loss_summary）同一个坑 ⇒ 一律先剥注释再判，否则「越强调越被判成有」。
  check('M-③ 变异体（去掉 applyTemplate 的 yield_rate）能被 Y1 抓到',
    mutated !== tail && /yield_rate/.test(stripC(mutated)) === false);
}
{
  // 变异：把 yieldOf 调用删掉 ⇒ Y3 必须红
  const mutated = editCode.replace(/yieldOf\(/g, 'String(');
  check('M-④ 变异体（去掉 yieldOf 调用）能被 Y3 抓到', /yieldOf\(/.test(mutated) === false);
}

// ============ G 导入页「从剪贴板粘贴」（R570-G）============
// 为什么守这一层：长按弹系统菜单是**原生 UI**，自动化点不到、机型差异大；若只教长按，
// 「能不能贴」这件事永远无法被门禁证明。所以产品改成单击按钮，行为面就必须有人守。
console.log('\n===== G 导入页剪贴板：能贴 / 追加不覆盖 / 读不到要说人话 =====');
const IMPORT = path.join(ROOT, 'subpkg', 'biz', 'card', 'import.js');
const IMPORT_WXML = path.join(ROOT, 'subpkg', 'biz', 'card', 'import.wxml');
let impSrc = '';
try { impSrc = fs.readFileSync(IMPORT, 'utf8'); } catch (e) { /* G-⑧ 会红 */ }
let impWxml = '';
try { impWxml = fs.readFileSync(IMPORT_WXML, 'utf8'); } catch (e) { /* G-① 会红 */ }

// 桩：makeStubs 不提供 getClipboardData ⇒ 默认就是「API 缺失」；每个场景前按需装一个。
// 🔴 必须在**调用前**装/卸，不能写在回调体里 delete（那样页面已判过 typeof 为 function，
//    表现为「静默什么都不做」，正是本条要防的失败形态）。
function installClip(mode, data) {
  if (mode === 'missing') { global.wx.getClipboardData = undefined; return; }
  global.wx.getClipboardData = (o) => {
    if (mode === 'fail') { o && o.fail && o.fail({ errMsg: 'getClipboardData:fail' }); return; }
    o && o.success && o.success({ data: data });
  };
}
function runClip(srcText, initText, mode, data) {
  const env = loadPage(srcText, '导入页', IMPORT);
  installClip(mode, data);
  const pg = newPage(env.cfg, null);
  pg.data.text = initText;
  pg.data.rows = [];
  pg.data.parsed = false;
  pg.onPasteClip();
  return { page: pg, toasts: env.toasts };
}

let impBase = null;
try { impBase = loadPage(impSrc, '导入页', IMPORT); } catch (e) { /* G-⑧ 会红 */ }
check('G-⑧ 导入页源码可加载且 onPasteClip 在场',
  !!impSrc && !!(impBase && typeof impBase.cfg.onPasteClip === 'function'));

check('G-① 已绑到 wxml（写了函数 ≠ 点得到）',
  impWxml.indexOf('bindtap="onPasteClip"') >= 0 && impWxml.indexOf('t.clipBtn') >= 0,
  'bindtap=' + (impWxml.indexOf('bindtap="onPasteClip"') >= 0) + ' clipBtn=' + (impWxml.indexOf('t.clipBtn') >= 0));

let g2 = null;
try { g2 = runClip(impSrc, '', 'ok', '鱼香肉丝 热炒荤菜 38\n凉拌黄瓜 凉拌 16\n'); } catch (e) { /* G-② 会红 */ }
check('G-② 空输入 + 剪贴板两行 ⇒ 填入并自动出预览',
  !!g2 && g2.page.data.text.indexOf('鱼香肉丝') >= 0 && (g2.page.data.rows || []).length === 2,
  g2 ? JSON.stringify(g2.page.data.text) + ' rows=' + (g2.page.data.rows || []).length : 'null');

let g3 = null;
try { g3 = runClip(impSrc, '宫保鸡丁 热炒荤菜 32', 'ok', '干锅花菜 热炒素菜 22'); } catch (e) { /* G-③ 会红 */ }
check('G-③ 已有内容 ⇒ 追加不覆盖（原菜名必须还在）',
  !!g3 && g3.page.data.text.indexOf('宫保鸡丁') >= 0 && g3.page.data.text.indexOf('干锅花菜') >= 0,
  g3 ? JSON.stringify(g3.page.data.text) : 'null');
check('G-④ 追加后是两行（没粘成一行）',
  !!g3 && g3.page.data.text.split('\n').filter((x) => x.trim()).length === 2,
  g3 ? JSON.stringify(g3.page.data.text) : 'null');

let g5 = null;
try { g5 = runClip(impSrc, '原文本', 'ok', '   '); } catch (e) { /* G-⑤ 会红 */ }
check('G-⑤ 剪贴板空 ⇒ 说人话且不动原文',
  !!g5 && g5.toasts.some((t) => String(t).indexOf('没有文字') >= 0) && g5.page.data.text === '原文本',
  g5 ? JSON.stringify(g5.toasts) + ' text=' + JSON.stringify(g5.page.data.text) : 'null');

let g6 = null;
try { g6 = runClip(impSrc, '', 'fail', ''); } catch (e) { /* G-⑥ 会红 */ }
check('G-⑥ 读失败 ⇒ 不静默（有提示）',
  !!g6 && g6.toasts.some((t) => String(t).indexOf('读不到剪贴板') >= 0),
  g6 ? JSON.stringify(g6.toasts) : 'null');

let g7 = null;
try { g7 = runClip(impSrc, '', 'missing', ''); } catch (e) { /* G-⑦ 会红 */ }
check('G-⑦ API 缺失 ⇒ 不崩且同一句人话',
  !!g7 && g7.toasts.some((t) => String(t).indexOf('读不到剪贴板') >= 0),
  g7 ? JSON.stringify(g7.toasts) : 'null');

// 变异回灌：把「追加」改成「覆盖」⇒ G-③ 必须转红
const MUT_CLIP = "const next = old ? (old + '\\n' + clip) : clip;";
check('G-⑨ 变异锚点在源码中（判据原文可定位）', impSrc.indexOf(MUT_CLIP) >= 0);
let g9 = null;
try { g9 = runClip(impSrc.replace(MUT_CLIP, 'const next = clip;'), '宫保鸡丁 热炒荤菜 32', 'ok', '干锅花菜 热炒素菜 22'); } catch (e) { /* G-⑩ 会红 */ }
check('G-⑩ 变异回灌：改成覆盖式 ⇒ G-③ 判据确实转红（本守卫有分辨力）',
  !(g9 && g9.page.data.text.indexOf('宫保鸡丁') >= 0),
  g9 ? JSON.stringify(g9.page.data.text) : 'null');

const failCount = bad.length;
console.log('\n===== M3 成本卡编辑页行为守卫结果：' + pass + ' 通过 / ' + failCount + ' 失败 =====');
if (failCount) bad.forEach((b) => console.log('   ❌ ' + b));
process.exit(failCount === 0 ? 0 : 1);
