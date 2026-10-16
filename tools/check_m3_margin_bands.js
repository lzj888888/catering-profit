// tools/check_m3_margin_bands.js —— M3 毛利率「色阶 / 区间」阈值**单源守卫**（R298Y）
// 运行：node tools/check_m3_margin_bands.js      （EXIT 0 = 全绿）
//
// 背景（本仓「同族病」第 3 型：判据只守**形态/子集**，不守**行为/全集**）：
//   规范 `specs/dev-specs/core/开发规范v1.0_ModuleM3_菜品成本卡.md` §M3.8 定死
//   「≥60% 绿 / 40%~60% 黄 / <40% 红 / 未定价灰」，且明写「色阶阈值建议也从**同一配置源**读取」。
//   可这个口径被抄了三份、且三份不一致：
//     · `pages/card/index.js` 筛选写 30（「中」= 30%~60%）
//     · `pages/card/index.wxml` 色带写 40（≥40 才黄）
//     · `miniprogram/i18n/terms.js` 文案写 30
//   ⇒ 一张毛利 **35%** 的卡：色带判**红**（<40）、筛选却把它归**中**（≥30）—— 用户可见的自相矛盾。
//   而全部套件对此**零覆盖**（`marginHigh|marginMid|marginLow` 在 `tools/` 下零命中）。
//
// 修复形态 = **单源化**（而非只改数字）：阈值 + 文案 + 色值收敛到 `utils/marginBand.js`，
//   页面与 wxml 一律引用；`terms.js` 那三个键整体撤掉
//   （理由：terms.js 有双副本、被 K11 要求逐字节一致，两份目录深度不同 ⇒ 无法 require 同一相对路径）。
//
// 判据（五条腿：行为 / 形态 / 扫描面下界，缺一不可）：
//   ① 单源取值：`utils/marginBand.js` 可 require 且 HIGH=60 / MID=40。
//   ② **行为实跑**（真 require 生产模块，不是读文本）——含**反恒真锚点**：
//      `matchBand('mid', 35)` 必须 false（改前是 true，正是被修的 bug）、`bandOf(35)==='low'`、
//      `colorOf(35)==='#e74c3c'`；边界 `bandOf(40)==='mid'`、`bandOf(60)==='high'`、未定价 ⇒ 'none'。
//   ③ 全仓**不得再有游离阈值字面量**（`pages/**`、`utils/**`，排除单源自身）。
//   ④ `terms.js` **双副本**的 `marginHigh/marginMid/marginLow` **键定义**不得回流
//      （正则要求后跟冒号 ⇒ 注释里的裸词不误伤）。
//   ⑤ 扫描面下界 + 正样本锚点（防「探测器坏了」与「命中 0」长得一样，本仓高频坑）。
//
// ⚠️ 写新套件须知：本文件输出**不以 `===` 包裹段标题**（R66 会按段标题审计「段内 ✅ == 0」），
//   直接逐条 `✅` + 末行 `N 通过 / M 失败` 收尾（R69）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SINGLE_SRC = 'utils/marginBand.js';
const SINGLE_ABS = path.join(ROOT, SINGLE_SRC);

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('✅ ' + name + (detail ? '（' + detail + '）' : '')); }
  else { problems.push(name + (detail ? '（' + detail + '）' : '')); console.log('❌ ' + name + (detail ? '（' + detail + '）' : '')); }
}
const no = (name, detail) => ok(name, false, detail);

// —— 递归收集文件 ——
function walk(dir, exts, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(abs, exts, out);
    } else if (exts.indexOf(path.extname(ent.name)) >= 0) {
      out.push(abs);
    }
  }
  return out;
}
const relOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const readOr = (abs, dflt) => { try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return dflt; } };

// ============ ① 单源取值 ============
let band = null;
try { band = require(SINGLE_ABS); } catch (e) { band = null; }
ok('①-a 单源模块可加载', !!band && typeof band.bandOf === 'function', SINGLE_SRC);
if (!band) {
  no('①-b 单源取值', '模块加载失败 ⇒ 后续行为判据无法执行（fail-closed）');
} else {
  ok('①-b 阈值 HIGH=60 / MID=40', band.HIGH === 60 && band.MID === 40, 'HIGH=' + band.HIGH + ' MID=' + band.MID);

  // ============ ② 行为实跑（真 require 生产模块）============
  const cases = [
    ['bandOf(60)=high', band.bandOf(60) === 'high'],
    ['bandOf(59.9)=mid', band.bandOf(59.9) === 'mid'],
    ['bandOf(40)=mid', band.bandOf(40) === 'mid'],
    ['bandOf(39.9)=low', band.bandOf(39.9) === 'low'],
    ['bandOf(null)=none', band.bandOf(null) === 'none'],
    ['bandOf(undefined)=none', band.bandOf(undefined) === 'none'],
    ['bandOf(\'\')=none', band.bandOf('') === 'none'],
    // 🔴 反恒真锚点：这四条正是被修 bug 的行为判据（改前 35% 会被「中」筛出、色带却是红）
    ['matchBand(mid,35)=false  ← 被修 bug 的行为锚点', band.matchBand('mid', 35) === false],
    ['matchBand(low,35)=true   ← 同上', band.matchBand('low', 35) === true],
    ['matchBand(mid,45)=true', band.matchBand('mid', 45) === true],
    ['matchBand(high,60)=true', band.matchBand('high', 60) === true],
    ['matchBand(mid,null)=false（未定价三档永不命中）', band.matchBand('mid', null) === false],
    ['matchBand(all,35)=true', band.matchBand('all', 35) === true],
    ['matchBand(\'\',35)=true（空 = 不筛）', band.matchBand('', 35) === true],
    ['colorOf(35)=#e74c3c（35 必须红）', band.colorOf(35) === '#e74c3c'],
    ['colorOf(45)=#b45309', band.colorOf(45) === '#b45309'],
    ['colorOf(65)=#22a06b', band.colorOf(65) === '#22a06b'],
    ['colorOf(null)=#999（未定价灰）', band.colorOf(null) === '#999'],
    ['LABEL.mid 不含 30（文案与阈值同源）', !/30/.test(String(band.LABEL.mid))],
    ['LABEL.low 不含 30（同上）', !/30/.test(String(band.LABEL.low))],
    ['LABEL.mid === 中（40%~60%）', band.LABEL.mid === '中（40%~60%）'],
    ['LABEL.low === 低（<40%）', band.LABEL.low === '低（<40%）'],
  ];
  let bad = 0;
  for (const [n, c] of cases) { if (!c) { bad += 1; console.log('❌ ② ' + n); } }
  ok('② 行为实跑 ' + cases.length + ' 条', bad === 0, bad ? bad + ' 条不符' : '全数命中');
}

// ============ ③ 全仓无游离阈值字面量 ============
const scanExts = ['.js', '.wxml'];
const scanFiles = [];
walk(path.join(ROOT, 'pages'), scanExts, scanFiles);
walk(path.join(ROOT, 'utils'), scanExts, scanFiles);
// 下界：pages/ + utils/ 的 js/wxml 文件数（实测 60+；骤降说明探测面被写窄）
const SCAN_MIN = 30;
ok('⑤-a 扫描面文件数 ' + scanFiles.length + ' ≥ ' + SCAN_MIN, scanFiles.length >= SCAN_MIN, '防探测面被写窄');

// 只认「毛利字段 + 与 30/40/60 比大小」这种分界形态；`grossMargin` 等其它标识符不落入
const STRAY = /\bmargin\s*(?:>=|<=|>|<)\s*(?:30|40|60)\b/g;
const strays = [];
for (const abs of scanFiles) {
  if (relOf(abs) === SINGLE_SRC) continue;   // 单源自身就是唯一允许写 60/40 的地方
  const text = readOr(abs, '');
  const hit = text.match(STRAY);
  if (hit) strays.push(relOf(abs) + ' × ' + hit.length + '（' + hit[0] + '）');
}
ok('③ 无游离阈值字面量', strays.length === 0, strays.length ? strays.join(' / ') : '扫描 ' + scanFiles.length + ' 文件');

// 正样本锚点：单源必须真的被页面引用（否则"全仓无字面量"可能只是没人写色阶了）
const idxJs = readOr(path.join(ROOT, 'pages/card/index.js'), '');
const idxWxml = readOr(path.join(ROOT, 'pages/card/index.wxml'), '');
ok('⑤-b 正样本：index.js 引用单源', /require\(['"][^'"]*utils\/marginBand\.js['"]\)/.test(idxJs), 'require 单源');
ok('⑤-c 正样本：index.js 用 band.matchBand', /band\.matchBand\(/.test(idxJs));
ok('⑤-d 正样本：index.js 用 band.LABEL', /band\.LABEL\./.test(idxJs));
ok('⑤-e 正样本：index.wxml 用 item.margin_color', /item\.margin_color/.test(idxWxml));
ok('⑤-f 正样本：index.js 产出 margin_color', /margin_color\s*:/.test(idxJs));

// ============ ④ terms.js 双副本的键定义不得回流 ============
const TERMS_COPIES = ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js'];
const KEY_DEF = /^\s*margin(?:High|Mid|Low)\s*:/m;
for (const rel of TERMS_COPIES) {
  const text = readOr(path.join(ROOT, rel), null);
  if (text === null) { no('④-a 副本可读 ' + rel, '文件读不到 ⇒ fail-closed'); continue; }
  ok('④ ' + rel + ' 无 marginHigh/Mid/Low 键定义', !KEY_DEF.test(text));
}
ok('④-c terms.js 仍保留 marginAll（分类/标签下拉在用）', /^\s*marginAll\s*:/m.test(readOr(path.join(ROOT, TERMS_COPIES[0]), '')));

// ============ 结论 ============
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ M3 毛利率色阶单源校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ M3 毛利率色阶单源校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ M3 毛利率色阶单源校验通过（单源 ' + SINGLE_SRC + '，阈值 60/40，扫描 ' + scanFiles.length + ' 个页面/工具文件）');
console.log('✅ M3 毛利率色阶单源校验：' + total + ' 通过 / 0 失败');
