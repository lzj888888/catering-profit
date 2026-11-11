// tools/check_import_paste_guard.js —— R702：批量导入「整表粘贴体检 + 对账行」接线守卫
//
// 🔴 为什么需要它（本仓反复吃过的亏）：
//   函数写好了、断言也绿了，但**页面没调用** —— 于是线上行为一点没变。
//   R69x 期间连续三次踩这个坑（工具存在但零调用）。所以「逻辑层绿」不算数，
//   必须单独守**页面真的接上了**：
//     · onParse 里真的调了 diagnosePaste
//     · 拒收分支真的 return（不是"提示一下继续解析"）
//     · blockTip / reconText 真的进了 data，且 wxml 真的渲染
//     · 对账行的「跳过行数」真的用原始行数算，不是恒 0
//
// 三组：A 逻辑层（体检函数存在且两类真表都判得出）
//       B 接线层（页面调用 + 数据字段 + wxml 渲染，三面缺一不可）
//       C 反恒真（影子样本：把接线删掉 / 把 return 去掉，判据必须变红）

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } };

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  (' + extra + ')' : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }

const js = read('subpkg/biz/card/import.js');
const wxml = read('subpkg/biz/card/import.wxml');

// ================== A · 逻辑层 ==================
sec('A · 逻辑层：体检函数真的能判出「这不是菜单」');
const DI = require(path.join(ROOT, 'utils/dishImport.js'));
check('A-① diagnosePaste 已导出（页面才 require 得到）', typeof DI.diagnosePaste === 'function');
check('A-② 套餐明细 ⇒ combo_detail',
  DI.diagnosePaste('说明行\n菜品编码\t套餐\t单品名称\t类型\nD001\t川味套餐\t水煮鱼\t单品').kind === 'combo_detail');
check('A-③ 首列是日期的账单 ⇒ no_name_col',
  (function () {
    const t = '2026-08-04\t541\t门店\t2026-08-01\t26.02\n2026-08-05\t541\t门店\t2026-08-02\t18.20\n2026-08-06\t541\t门店\t2026-08-03\t24.62';
    return DI.diagnosePaste(t).kind === 'no_name_col';
  })());
check('A-④ 正常三列仍是 ok（不许把老路径也拦了）',
  DI.diagnosePaste('鱼香肉丝,热炒荤菜,38').kind === 'ok');

// ================== B · 接线层 ==================
sec('B · 接线层：页面真的调用了（三面缺一不可）');
check('B-① import.js 真的调用 DI.diagnosePaste(', /DI\.diagnosePaste\s*\(/.test(js));
check('B-② 拒收分支同时覆盖 combo_detail 与 no_name_col 两类',
  /combo_detail/.test(js) && /no_name_col/.test(js));
check('B-③ 拒收分支必须 return（不能"提示完继续解析"——那等于没拦）',
  (function () {
    const i = js.indexOf('diagnosePaste');
    if (i < 0) return false;
    const seg = js.slice(i, i + 900);
    const hasReturn = /\breturn\s*;/.test(seg);
    // return 必须出现在 setData（清空 rows）之后、解析循环之前
    const setIdx = seg.indexOf('rows: []');
    const retIdx = seg.search(/\breturn\s*;/);
    return hasReturn && setIdx >= 0 && retIdx > setIdx;
  })());
check('B-④ 拒收时把 rows 清空（这是"不建卡"的实际动作，不是靠 UI 隐藏）',
  /blockTip[\s\S]{0,80}?rows:\s*\[\]/.test(js) || /rows:\s*\[\][\s\S]{0,200}?blockTip/.test(js));
check('B-⑤ data 里真的声明了 blockTip 与 reconText（wxml 才绑得上）',
  /blockTip:\s*''/.test(js) && /reconText:\s*''/.test(js));
check('B-⑥ wxml 真的渲染 blockTip（有 data 没渲染 = 老板看不见）',
  /\{\{\s*blockTip\s*\}\}/.test(wxml));
check('B-⑦ wxml 真的渲染 reconText',
  /\{\{\s*reconText\s*\}\}/.test(wxml));
check('B-⑧ 被拒时空态文案不许与「没解析出菜品」同时出现（否则老板看到两句互相矛盾的话）',
  (function () {
    const m = wxml.match(/wx:if="\{\{parsed && !rows\.length[^"]*\}\}"/g) || [];
    // 两个分支必须互斥：一个带 !blockTip，一个带 blockTip
    return m.length >= 2 && m.some((s) => /!\s*blockTip/.test(s)) && m.some((s) => /[^!]\s*blockTip/.test(s));
  })(), (wxml.match(/wx:if="\{\{parsed && !rows\.length[^"]*\}\}"/g) || []).join(' / '));

// ================== C · 对账行真的算 ==================
sec('C · 对账行：三个数真的算出来，不是写死的');
check('C-① onParse 记录了原始行数（对账要「粘贴了几行」）', /this\._rawN\s*=/.test(js));
check('C-② syncSummary 用原始行数算「跳过」', /_rawN/.test(js) && /rawN\s*-\s*n/.test(js));
check('C-③ 对账文案走 terms 单源（页面不自己拼中文）', /TERMS\.card\.impRecon\s*\(/.test(js));
check('C-④ 已填价合计按「有价的行」求和（不是全表行数 × 某个数）',
  /priced/.test(js) && /reduce\(/.test(js));
check('C-⑤ 改价/改品类后也会重算（否则对账数停在解析那一刻，越改越不准）',
  (js.match(/this\.syncSummary\(/g) || []).length >= 3,
  '调用 ' + (js.match(/this\.syncSummary\(/g) || []).length + ' 处');

// ================== D · 反恒真 ==================
sec('D · 反恒真：判据有分辨力（影子样本必红）');
check('D-① 去掉 diagnosePaste 调用 ⇒ B-① 必须不成立（证明不是恒真）',
  !/DI\.diagnosePaste\s*\(/.test('// 注释掉的 DI.diagnosePaste 不算'));
check('D-② 只提示不 return 的假接线必须被判出（影子样本）',
  (function () {
    const fake = 'const diag = DI.diagnosePaste(src);\nif (diag.kind === "combo_detail") { this.setData({ blockTip: "x" }); }';
    const seg = fake;
    const setIdx = seg.indexOf('blockTip');
    const retIdx = seg.search(/\breturn\s*;/);
    return !(setIdx >= 0 && retIdx > setIdx);   // 没有 return ⇒ 这条为 true ⇒ 说明我们的判据能识别假接线
  })());
check('D-③ terms 里两条拦截文案都非空（文案是 i18n 单源，缺一条页面就白框）',
  (function () {
    const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
    return !!(T.card.impBlockCombo && T.card.impBlockNoName && typeof T.card.impRecon === 'function');
  })());
check('D-④ 对账文案在「无跳过、无价」时不输出空尾巴',
  require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.card.impRecon(5, 5, 0, 0, '0.00')
    === '粘贴 5 行 → 识别 5 道',
  require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.card.impRecon(5, 5, 0, 0, '0.00'));

// ================== E · 前置体检 + 补价回来要刷新（R704） ==================
// 根因（李老师真机「有点发懵」）：老板从菜单导入走到「去补价」才发现要一道道填价 ——
// 因为没人告诉他原料库能一次性批量建、建好后补价是**选料**（价自动带出）。
// 另一半：补完价返回，那一行状态永远不变（本页改前只有 onLoad 没有 onShow）⇒ 以为白干了。
sec('E · 前置体检 + 补价返回刷新（R704）');
check('E-① 导入页有 onShow（没有它，补价回来状态永远不会变）',
  /^\s*onShow\s*\(/m.test(js));
check('E-② onShow 真的调用确认逻辑（定义了但没人调 = 假接线）',
  /onShow\s*\([^)]*\)\s*\{[\s\S]{0,400}?this\.confirmSaved\s*\(/.test(js));
// 🔴 关键：判据必须是「查库有没有这张卡」，不能是「点过就算」——
//   老板可能进编辑页后中途退出、或保存失败（配额满/断网），按"点过"标绿就是假信号。
check('E-③ 已保存判据走 getCostCard 查同名卡（不是"点过就算"）',
  /confirmSaved[\s\S]{0,600}?getCostCard/.test(js) && /list\.some\(/.test(js));
check('E-④ 体检结果 matN 初值为 -1（读不到就不显示，绝不默认 0 去误报"你还没有原料"）',
  /matN\s*:\s*-1/.test(js));
check('E-⑤ 体检块在粘贴框之前（放页面底部 = 等于没放，老板已经走到补价了）',
  (function () {
    const pre = wxml.indexOf('imp-prereq');
    const box = wxml.indexOf('card2');
    return pre > 0 && box > 0 && pre < box;
  })(), 'imp-prereq@' + wxml.indexOf('imp-prereq') + ' card2@' + wxml.indexOf('card2'));
check('E-⑥ 空库时给的是「批量录入」入口（几十种一次粘完，不是逐条新建）',
  /\/subpkg\/biz\/material\/batch/.test(js));
// 反恒真：把 onShow 从源码里抠掉，E-① 的判据必须转红
check('E-⑦ 反恒真：抠掉 onShow 后 E-① 判据必须不成立',
  !/^\s*onShow\s*\(/m.test(js.replace(/^\s*onShow\s*\(/m, '')), '影子样本已证伪');

console.log('\n' + '='.repeat(60));
console.log('===== 整表粘贴体检接线守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
