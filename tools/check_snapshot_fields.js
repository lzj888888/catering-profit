// tools/check_snapshot_fields.js —— R144 · 快照 5 字段完整性守卫
//
// 背景（为什么必须有这条）：
//   S0（round129）在成本卡明细行落库了原料侧的 5 个**快照**字段
//   `brand_spec / purchase_unit / purchase_price / convert_factor / yield_rate`
//   —— 快照的意义是"原料后来改价，历史版本仍按当时价算"。
//   读侧 `getCostCard` / `getCardVersions` 也补了对应出参。
//   但**一直没有任何守卫盯这 5 个字段** ⇒ 同类事故已在 R150 真实发生过：
//   `getCardVersions` 出参漏了 R150 的四个字段，被跨函数契约断言抓红 ——
//   **只给一个读侧加、另一个忘了，用户从版本历史恢复就会静默丢字段**（界面毫无异常）。
//
// 判据（判**字段集合**不判书写顺序；块级取函数体，不按行）：
//   L1 两处读侧 lineToOutput 各含 5 字段全集
//   L2 两处写侧（saveCostCard/syncCostCard 的 service.js）含 5 字段全集
//   L3 读侧两处字段集合 ≡（防"只加一处"—— 这正是 R150 的事故形态）
//   L4 读侧 fail-soft：缺字段给缺省值，不崩（存量行没有这 5 字段必须照常返回）
//   L5 写侧 Controller（saveCostCard/index.js）也带这 5 字段
//   L6 validate.js 对 yield_rate 有区间校验（(0,100]）—— 快照也得是合法值
//   S1~S2 自失效护栏（解析命中下界，防"扫了空集所以全绿"）
//   C1~C3 反恒真（删字段必红且点名到位 / 正样本绿 / 等价改写仍绿）
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const FIELDS = ['brand_spec', 'purchase_unit', 'purchase_price', 'convert_factor', 'yield_rate'];

// ⚠️ 两处读侧的映射函数**名字不同**（历史形成，不许为了守卫统一去改名）：
//   getCostCard = lineToOutput ／ getCardVersions = lineToOut
//   ⇒ 守卫按各自名字取；写成同一个名字会取到 null ⇒ 把正确的代码判成"缺 5 字段"（本轮首跑即踩）。
const READ_FILES = [
  ['cloudfunctions/getCostCard/service.js', 'lineToOutput'],
  ['cloudfunctions/getCardVersions/service.js', 'lineToOut'],
];
const WRITE_FILES = [
  'cloudfunctions/saveCostCard/service.js',
  'cloudfunctions/syncCostCard/service.js',
];
const CTRL_FILE = 'cloudfunctions/saveCostCard/index.js';
const VALIDATE_FILE = 'cloudfunctions/saveCostCard/validate.js';

const results = [];
function ok(msg) { results.push(['✅', msg]); }
function bad(msg) { results.push(['❌', msg]); }
function assert(cond, msg) { cond ? ok(msg) : bad(msg); return !!cond; }

function read(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch (e) { return ''; }
}

// 按**定义形态**取函数体（R156 教训：别用 indexOf 命中调用处当函数体 ⇒ 假红）
function fnBody(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  return null;
}

function fieldsIn(text) {
  return FIELDS.filter((f) => new RegExp('\\b' + f + '\\b').test(String(text || '')));
}

function missingIn(text) {
  return FIELDS.filter((f) => !new RegExp('\\b' + f + '\\b').test(String(text || '')));
}

// ---------- S 自失效护栏 ----------
const allSrc = READ_FILES.map((r) => read(r[0])).join('\n')
  + '\n' + WRITE_FILES.map(read).join('\n') + '\n' + read(CTRL_FILE);
assert(allSrc.length > 20000, 'S1 扫描面完整（四侧源码合计 ' + allSrc.length + ' 字符 > 20000，缩到很小即转红）');

const bodies = {};
for (const [rel, fn] of READ_FILES) {
  const b = fnBody(read(rel), fn);
  bodies[rel] = b;
  assert(!!b, 'S2 能取出读侧函数体 ' + fn + '（' + rel + '）—— 取不到说明改名了，守卫必须红');
}
assert(READ_FILES.every((r) => (bodies[r[0]] || '').length > 200),
  'S2 读侧函数体规模正常（>200 字符，防"取到空壳"假绿）');

// ---------- L1 读侧两处各含 5 字段全集 ----------
for (const [rel] of READ_FILES) {
  const miss = missingIn(bodies[rel]);
  assert(miss.length === 0,
    'L1 读侧含 5 字段全集（' + rel + '）' + (miss.length ? ' —— 缺 ' + miss.join(', ') : ''));
}

// ---------- L2 写侧两处含 5 字段全集 ----------
for (const rel of WRITE_FILES) {
  const src = read(rel);
  const miss = missingIn(src);
  assert(miss.length === 0,
    'L2 写侧落库含 5 字段全集（' + rel + '）' + (miss.length ? ' —— 缺 ' + miss.join(', ') : ''));
}

// ---------- L3 读侧两处字段集合 ≡（R150 事故形态专守）----------
const setA = fieldsIn(bodies[READ_FILES[0][0]]).join(',');
const setB = fieldsIn(bodies[READ_FILES[1][0]]).join(',');
assert(setA === setB,
  'L3 两处读侧字段集合 ≡（' + setA + ' vs ' + setB + '）—— 只给一处加即红（R150 事故形态）');

// ---------- L4 读侧 fail-soft（存量行缺这 5 字段不能崩）----------
for (const [rel] of READ_FILES) {
  const body = bodies[rel] || '';
  const soft = FIELDS.filter((f) => {
    const re = new RegExp('\\b' + f + '\\b[^\\n]*(\\|\\||!= null|!=null|\\?\\?)');
    return re.test(body);
  });
  assert(soft.length === FIELDS.length,
    'L4 读侧 fail-soft（' + rel + '）：5 字段均有缺省兜底，实际 ' + soft.length + '/5'
    + (soft.length < 5 ? ' —— 缺兜底 ' + FIELDS.filter((f) => soft.indexOf(f) < 0).join(', ') : ''));
}

// ---------- L5 写侧 Controller 也带这 5 字段 ----------
{
  const miss = missingIn(read(CTRL_FILE));
  assert(miss.length === 0,
    'L5 写侧 Controller 含 5 字段（' + CTRL_FILE + '）' + (miss.length ? ' —— 缺 ' + miss.join(', ') : ''));
}

// ---------- L6 validate 对 yield_rate 有区间校验 ----------
{
  const v = read(VALIDATE_FILE);
  assert(/yield_rate/.test(v) && /100/.test(v),
    'L6 validate.js 对 yield_rate 有区间校验（(0,100]）—— 快照值必须合法');
}

// ---------- C 反恒真（影子样本，证明判据有分辨力）----------
function judgeSample(bodyText) {
  // 复刻 L1/L4 的判据，作用在**传入的样本**上（纯函数，不碰磁盘）
  const miss = FIELDS.filter((f) => !new RegExp('\\b' + f + '\\b').test(bodyText));
  const soft = FIELDS.filter((f) =>
    new RegExp('\\b' + f + '\\b[^\\n]*(\\|\\||!= null|!=null|\\?\\?)').test(bodyText));
  return { miss, softShort: FIELDS.length - soft.length, green: miss.length === 0 && soft.length === FIELDS.length };
}

{
  const real = bodies[READ_FILES[0][0]] || '';
  // C1 删掉 yield_rate ⇒ 必红且点名
  const s1 = real.replace(/[^\n]*\byield_rate\b[^\n]*\n?/, '');
  const r1 = judgeSample(s1);
  assert(!r1.green && r1.miss.indexOf('yield_rate') >= 0,
    'C1 影子样本「删掉 yield_rate」判红且点名该字段（缺 ' + r1.miss.join(', ') + '）');

  // C2 正样本（真实写法）判绿 —— 正常写法不受伤
  const r2 = judgeSample(real);
  assert(r2.green, 'C2 影子样本「本轮真实写法」判绿（不误伤）');

  // C3 等价改写（字段顺序调换 + 加注释）仍绿 ⇒ 判字段不判顺序
  const lines = real.split('\n');
  const eq = lines.slice().reverse().join('\n');
  const r3 = judgeSample(eq);
  assert(r3.green, 'C3 等价改写（行序颠倒）仍判绿 ⇒ 判据判**字段存在**不判书写顺序');
}

// ---------- 输出（末尾统一打标准总结行；正文中禁止出现「N 通过 / M 失败」字样）----------
const fail = results.filter((r) => r[0] === '❌').length;
console.log('===== R144 · 快照 5 字段完整性守卫（S0 落库 ⇄ 读侧出参）=====');
for (const [mark, msg] of results) console.log('  ' + mark + ' ' + msg);
console.log('快照字段守卫结果：' + (results.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
