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
// 判据（A 空卡 / B 已有真行 / C 全品类 / D 变异回灌 / S 自失效）：
//   A 空卡（只有出厂空行）⇒ 必须带出示例主料（猪肉/青椒）+ 调料，且**不留出厂空行**
//   B 已有真行再选品类 ⇒ 示例主料**不得重复追加**，原有行保留
//   C 11 个品类逐一 ⇒ 每个都至少带出 1 条非调料示例行（防「换个品类又漏」）
//   D 变异：把判据改回 `lines.length === 0` ⇒ A-①/② 必须转红（否则本守卫是假绿）
//   S 自失效护栏：页面源码可达 / onPickCategory 在场 / 品类单源非空 / A 组样本确有区分力
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

/** 用给定的源码文本加载页面（正常态 = 原文件；变异态 = 替换后的文本） */
function loadPage(srcText, tag) {
  const stubs = makeStubs();
  const dir = path.dirname(EDIT);
  const fakeRequire = (p) => {
    const abs = /^[./]/.test(String(p)) ? path.resolve(dir, p) : String(p);
    return require(abs);
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', srcText)(
    mod, mod.exports, fakeRequire, dir, EDIT
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

// ============ S 自失效护栏 ============
console.log('\n===== S 自失效护栏：扫描面非退化 + 关键锚点在场 =====');
check('S1 编辑页源码存在且可读', fs.existsSync(EDIT) && fs.readFileSync(EDIT, 'utf8').length > 1000);
let origSrc = '';
try { origSrc = fs.readFileSync(EDIT, 'utf8'); } catch (e) { /* S1 已红 */ }
check('S2 源码含 onPickCategory 定义', /onPickCategory\s*\(/.test(origSrc));
let presets = null;
try { presets = require(PRESETS).CATEGORY_PRESETS; } catch (e) { /* C 组会红 */ }
check('S3 品类单源非空且含 sample_lines', Array.isArray(presets) && presets.length > 0
  && presets.every((c) => Array.isArray(c.sample_lines) && c.sample_lines.length > 0),
  presets ? presets.length + ' 个品类' : 'require 失败');

let base = null;
try { base = loadPage(origSrc, '原文件'); } catch (e) { check('S4 页面源码可加载', false, e.message); }
check('S4 页面源码可加载且捕获到 onPickCategory', !!(base && typeof base.cfg.onPickCategory === 'function'));

// ============ A 空卡（只有出厂空行）============
console.log('\n===== A 空卡：必须带出示例主料，且不留出厂空行 =====');
const EMPTY_LINE = { input_type: 1, material_id: '', material_name: '', qty: '', qty_unit: '克', spec_hint: '', line_kind: 'main' };
let aLines = null;
try {
  const p = newPage(base.cfg, [EMPTY_LINE]);
  p.onPickCategory({ detail: { value: 0 } });     // 0 = 热炒荤菜
  aLines = p.data.lines;
} catch (e) { check('A0 onPickCategory 可执行', false, e.message); }
const aNames = namesOf(aLines);
check('A-① 空卡选品类后至少 3 行（调料 + 示例主料）', !!aLines && aLines.length >= 3,
  aLines ? aLines.length + ' 行：' + aNames.join(' / ') : 'null');
check('A-② 示例主料真的进来了（含「猪肉」与「青椒」）',
  aNames.indexOf('猪肉') >= 0 && aNames.indexOf('青椒') >= 0, aNames.join(' / '));
check('A-③ 调料行有且仅有一条', aNames.filter((n) => n === CONDIMENT).length === 1, aNames.join(' / '));
check('A-④ 不再残留出厂空行', blankOf(aLines) === 0, blankOf(aLines) + ' 行空');
check('A-⑤ 每行都是可保存的手工行（input_type=2）',
  !!aLines && aLines.every((l) => Number(l.input_type) === 2),
  aLines ? aLines.map((l) => l.input_type).join(',') : 'null');
check('A-⑥ 出净率套了品类默认（85，不是出厂 100）',
  !!aLines && aLines.filter((l) => l.material_name === '猪肉')[0] !== undefined
  && Number(aLines.filter((l) => l.material_name === '猪肉')[0].yield_rate) === 85,
  aLines ? JSON.stringify(aLines.filter((l) => l.material_name === '猪肉')[0]) : 'null');

// ============ B 已有真行：不得重复追加 ============
console.log('\n===== B 已有真行：再选品类不得重复补示例主料 =====');
let bLines = null;
try {
  const real = { input_type: 2, material_id: '', material_name: '猪肉', qty: '150', qty_unit: '克', unit_price_yuan: '0.012', yield_rate: '85', line_kind: 'main' };
  const p = newPage(base.cfg, [real]);
  p.onPickCategory({ detail: { value: 0 } });
  bLines = p.data.lines;
} catch (e) { check('B0 onPickCategory 可执行', false, e.message); }
const bNames = namesOf(bLines);
check('B-① 原有行保留（猪肉 150g 单价 0.012）',
  !!bLines && bLines.some((l) => l.material_name === '猪肉' && String(l.qty) === '150' && String(l.unit_price_yuan) === '0.012'),
  bLines ? JSON.stringify(bLines.map((l) => l.material_name + '/' + l.qty + '/' + l.unit_price_yuan)) : 'null');
check('B-② 猪肉不重复（只一条）', bNames.filter((n) => n === '猪肉').length === 1, bNames.join(' / '));
check('B-③ 已卡不再补示例主料（青椒不应出现）', bNames.indexOf('青椒') < 0, bNames.join(' / '));
check('B-④ 调料仍补且仅一条', bNames.filter((n) => n === CONDIMENT).length === 1, bNames.join(' / '));

// ============ C 全品类：每个都要带出示例主料 ============
console.log('\n===== C 11 个品类逐一：每个都必须带出示例主料 =====');
let cBad = [];
if (presets && base) {
  for (let i = 0; i < presets.length; i++) {
    try {
      const p = newPage(base.cfg, [EMPTY_LINE]);
      p.onPickCategory({ detail: { value: i } });
      const ns = namesOf(p.data.lines);
      const sample = ns.filter((n) => n !== CONDIMENT && n);
      if (sample.length === 0) cBad.push(presets[i].key + '(0 条示例主料)');
      else if (ns.filter((n) => n === CONDIMENT).length !== 1) cBad.push(presets[i].key + '(调料 ' + ns.filter((n) => n === CONDIMENT).length + ' 条)');
    } catch (e) { cBad.push(presets[i].key + '(抛错: ' + e.message + ')'); }
  }
}
check('C-① 每个品类都带出示例主料 + 恰一条调料', cBad.length === 0,
  cBad.length ? cBad.join(' / ') : (presets ? presets.length + ' 个品类全过' : '无单源'));

// ============ D 变异回灌：把判据改回 length===0 ⇒ 必须转红 ============
console.log('\n===== D 变异回灌：判据退回 `lines.length === 0` 必须被抓到 =====');
const TARGET = 'const wasEmpty = this.data.lines.length === 0 || this.data.lines.every(isBlankLine);';
check('D-① 变异锚点在源码中（判据原文可定位）', origSrc.indexOf(TARGET) >= 0);
let mutLines = null;
try {
  const mutSrc = origSrc.replace(TARGET, 'const wasEmpty = this.data.lines.length === 0;');
  const mut = loadPage(mutSrc, '变异体');
  const p = newPage(mut.cfg, [EMPTY_LINE]);
  p.onPickCategory({ detail: { value: 0 } });
  mutLines = p.data.lines;
} catch (e) { /* D-② 会按 null 处理 */ }
const mutNames = namesOf(mutLines);
check('D-② 变异后 A-② 判据确实转红（示例主料不再出现 ⇒ 本守卫有分辨力）',
  !(mutNames.indexOf('猪肉') >= 0 && mutNames.indexOf('青椒') >= 0),
  '变异体行数 ' + (mutLines ? mutLines.length : 'null') + '：' + mutNames.join(' / '));

const failCount = bad.length;
console.log('\n===== M3 成本卡编辑页行为守卫结果：' + pass + ' 通过 / ' + failCount + ' 失败 =====');
if (failCount) bad.forEach((b) => console.log('   ❌ ' + b));
process.exit(failCount === 0 ? 0 : 1);
