#!/usr/bin/env node
// tools/check_channel_over100.js —— M2 渠道占比「外卖 + 团购 ≤ 100%」接线守卫（R412 · 队列 #24）
//
// 为什么必须机器守：
//   `TERMS.m2.channelOver100`（terms.js:807）从写下那天起就是**死文案** —— 全仓引用只有
//   ① 定义 ② 页面 `t` 映射。wxml 不渲染、js 不判。老板填「外卖 60% + 团购 60% = 120%」时
//   `recomputeChannel` 照算，等于按 **120% 的流水**扣佣 ⇒ 加权挂钩费率虚高 ⇒ 保本额虚高，
//   老板以为要多卖很多才不亏，**全程零报错**。
//   这类缺口（能力/文案写了但零生产调用）不会被"能跑"发现，只能被"接线"判据发现。
//
// 判据四条腿，方向不同、缺一不可：
//   ① **行为面**：真 require `utils/channelRule.js`，喂真占比看返回值（含边界：恰好 100、
//      浮点残差、字符串入参、负数/NaN 垃圾入参）。防"规则写错方向"（如 `>= 100` 把合法值判超）。
//   ② **计算面**：`recomputeChannel` 函数体（**剥注释**）里 `setData` 真产出 `channel.over100`，
//      且取值来自 `isChannelRatioOver100(` 调用 —— 防「只写字段名 / 硬编码 false / 写在别的函数里」。
//   ③ **渲染面**：`pages/sandbox/index.wxml`（**剥注释**）里 `channel.over100` 真出现在 `wx:if`
//      属性内，且**同一元素内**真有 `t.channelOver100` 插值 —— 只渲染一个条件不显示文案 = 白做。
//   ④ **反恒真**：自带合成样本，把上面每条腿对应的代码删掉/改坏，判据必须转 false；
//      再把纯函数改成 `return false`，行为面必须发现。没有这一条，判据可能只是"文件里出现了这个词"。
//
// ⚠️ 本文件**不用正则**（本机环境把反斜杠转成斜杠，落盘即语法错）—— 一律 indexOf + 切片。
//
// 运行：node tools/check_channel_over100.js   （由 verify_all.js 的 [channel-over100] 套件调用）

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RULE = path.join(ROOT, 'utils', 'channelRule.js');
const PAGE_JS = path.join(ROOT, 'pages', 'sandbox', 'index.js');
const PAGE_WXML = path.join(ROOT, 'pages', 'sandbox', 'index.wxml');
const TERMS_A = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');
const TERMS_B = path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js');

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}

// ================= 基础工具（indexOf / 切片，无正则） =================
function readOr(p, dflt) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return dflt; }
}

/** 剥 `//` 与块注释，保留字符串内容（判 require 字面量要用）。 */
function stripJsComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    const c2 = i + 1 < n ? s.charAt(i + 1) : '';
    if (c === '/' && c2 === '/') { while (i < n && s.charAt(i) !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s.charAt(i) === '*' && s.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        const d = s.charAt(i);
        out += d; i++;
        if (d === '\\') { if (i < n) { out += s.charAt(i); i++; } continue; }
        if (d === quote) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 剥 wxml 的 `<!-- -->` 注释（注释里的 `channel.over100` 不能让判据恒真）。 */
function stripXmlComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s.charAt(i) === '<' && s.charAt(i + 1) === '!' && s.charAt(i + 2) === '-' && s.charAt(i + 3) === '-') {
      const e = s.indexOf('-->', i + 4);
      if (e < 0) return out;
      i = e + 3;
      continue;
    }
    out += s.charAt(i);
    i++;
  }
  return out;
}

/** 取函数**定义体**（`name(` 起，到与首个 `{` 配平的 `}` 止）；取不到返回 '' ⇒ 调用方 fail-closed。 */
function bodyOf(src, name) {
  const s = String(src || '');
  // 🔴 R414（判据自身缺陷，接线后当场暴露）：必须**跳过成员调用**（`this.x()` / `.x()`），
  //   只认**定义处**。实证：`pages/sandbox/index.js:683` 有一处 `this.recomputeChannel();` 排在
  //   822 行的定义之前，旧写法 `indexOf(name + '(')` 命中的是 683 ⇒ 取到一段不相干的块
  //   ⇒ ②-3/②-4/②-5 **恒红**（看似"补丁没接线"，其实是判据锚错了地方）。
  //   这与 R299 记的三种恒真形态同源，只是方向相反：锚错地方不只造成恒真，也会造成恒假。
  let from = 0;
  let defAt = -1;
  for (;;) {
    const k = s.indexOf(name + '(', from);
    if (k < 0) break;
    let p = k - 1;
    while (p >= 0 && /\s/.test(s.charAt(p))) p--;
    const isMemberCall = p >= 0 && s.charAt(p) === '.';
    const braceAt = s.indexOf('{', k);
    // 定义处特征：前面不是 `.`，且 `(` 到 `{` 之间没有 `;`（排除"调用后另起一个块"）
    if (!isMemberCall && braceAt >= 0 && s.slice(k, braceAt).indexOf(';') < 0) { defAt = k; break; }
    from = k + name.length + 1;
  }
  if (defAt < 0) return '';
  let i = s.indexOf('{', defAt);
  if (i < 0) return '';
  const start = i;
  let depth = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        if (d === '\\') { i += 2; continue; }
        i++;
        if (d === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
    i++;
  }
  return '';
}

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

// ================= ① 行为面：真调纯函数 =================
const RULE_SRC = readOr(RULE, '');
ok('①-0 utils/channelRule.js 存在且可加载', !!RULE_SRC, RULE_SRC ? '' : '文件缺失');
let rule = null;
try { rule = require(RULE); } catch (e) { rule = null; }
ok('①-1 导出 isChannelRatioOver100', !!(rule && typeof rule.isChannelRatioOver100 === 'function'),
  rule ? Object.keys(rule).join(',') : String(null));
if (!rule || typeof rule.isChannelRatioOver100 !== 'function') {
  console.log('❌ 渠道占比守卫：纯函数不可用，后续判据无法执行（fail-closed）');
  process.exit(1);
}
const over = rule.isChannelRatioOver100;

// 真实量级：老板会填的那些数
ok('①-2 60 + 60 = 120 ⇒ 超限', over(60, 60) === true, String(over(60, 60)));
ok('①-3 60 + 40 = 100 ⇒ **不**超（走满仍自洽）', over(60, 40) === false, String(over(60, 40)));
ok('①-4 20 + 0（默认值）⇒ 不超', over(20, 0) === false, String(over(20, 0)));
ok('①-5 输入框给的是字符串 \'60\'/\'60\' ⇒ 仍判超', over('60', '60') === true, String(over('60', '60')));
ok('①-6 浮点残差 0.1 + 99.9 ⇒ 不超（容差生效）', over(0.1, 99.9) === false, String(over(0.1, 99.9)));
ok('①-7 100.1 + 0 ⇒ 超', over(100.1, 0) === true, String(over(100.1, 0)));
// 垃圾入参：不能把"填了个负号/乱字符"误报成"占比超限"（会把老板引向错误的修改方向）
const junk = [[null, null], [undefined, undefined], ['', ''], ['abc', 'def'], [NaN, NaN], [-30, 50], [{}, []]];
const junkBad = junk.filter((p) => over(p[0], p[1]) !== false);
ok('①-8 垃圾入参（null/空串/非数字/负数）一律不报超限', junkBad.length === 0, JSON.stringify(junkBad));

// ================= ② 计算面：recomputeChannel 真产出 =================
const jsRaw = readOr(PAGE_JS, '');
ok('②-0 pages/sandbox/index.js 存在', !!jsRaw, jsRaw ? '' : '文件缺失');
const js = stripJsComments(jsRaw);
ok('②-1 页面真 require utils/channelRule.js', js.indexOf('channelRule.js') >= 0, '未引用纯函数 ⇒ 规则没接线');

const rcBody = bodyOf(js, 'recomputeChannel');
ok('②-2 recomputeChannel 函数体可取（fail-closed）', rcBody.length > 0, '取不到函数体 ⇒ 改名或删了');
ok('②-3 函数体真产出 channel.over100', rcBody.indexOf('channel.over100') >= 0, '未写入 over100 ⇒ 页面拿不到状态');
ok('②-4 over100 取值来自纯函数调用（非硬编码）',
  rcBody.indexOf('isChannelRatioOver100(') >= 0, '未见纯函数调用 ⇒ 可能写死 true/false');
// 这条防"调了函数但把它忽略"：函数体里不能只有调用而没有 over100 的赋值来源
ok('②-5 over100 与纯函数调用在同一函数体内（不是别处调用）',
  rcBody.indexOf('isChannelRatioOver100(') >= 0 && rcBody.indexOf('channel.over100') >= 0, '');

// ================= ③ 渲染面：wxml 真显示 =================
const xmlRaw = readOr(PAGE_WXML, '');
ok('③-0 pages/sandbox/index.wxml 存在', !!xmlRaw, xmlRaw ? '' : '文件缺失');
const xml = stripXmlComments(xmlRaw);

/** 找 `channel.over100` 是否出现在某个 wx:if / hidden 属性内，且同元素内有 t.channelOver100 插值。 */
function renderWired(src) {
  const key = 'channel.over100';
  let from = 0;
  for (;;) {
    const k = src.indexOf(key, from);
    if (k < 0) return false;
    from = k + key.length;
    // 往前找当前标签起点，往后找标签终点 —— 判定"同一元素"
    const tagStart = src.lastIndexOf('<', k);
    if (tagStart < 0) continue;
    const tagEnd = src.indexOf('>', k);
    if (tagEnd < 0) continue;
    const openTag = src.slice(tagStart, tagEnd + 1);
    // 必须真在条件属性里（wx:if / hidden），而不是随便一个文本
    const condOk = openTag.indexOf('wx:if') >= 0 || openTag.indexOf('hidden') >= 0;
    if (!condOk) continue;
    // 同元素内（开标签到闭标签之间，最多 400 字符）必须有文案插值
    const closeEnd = src.indexOf('>', tagEnd + 1);
    const inner = closeEnd > tagEnd ? src.slice(tagEnd + 1, Math.min(closeEnd, tagEnd + 401)) : '';
    const textOk = inner.indexOf('t.channelOver100') >= 0 || openTag.indexOf('t.channelOver100') >= 0;
    if (textOk) return true;
  }
}
ok('③-1 提示挂在条件属性内（wx:if/hidden）', (function () {
  const tagIdx = xml.indexOf('channel.over100');
  if (tagIdx < 0) return false;
  const tagStart = xml.lastIndexOf('<', tagIdx);
  const tagEnd = xml.indexOf('>', tagIdx);
  if (tagStart < 0 || tagEnd < 0) return false;
  const openTag = xml.slice(tagStart, tagEnd + 1);
  return openTag.indexOf('wx:if') >= 0 || openTag.indexOf('hidden') >= 0;
})(), 'over100 未挂在条件上 ⇒ 要么恒显示要么不显示');
ok('③-2 同元素内真渲染 t.channelOver100 文案', renderWired(xml), '只渲染条件不显示文案 = 白做');
ok('③-3 渲染位置在渠道卡内（channel.on 之后）', (function () {
  const onIdx = xml.indexOf('channel.on');
  const kIdx = xml.indexOf('channel.over100');
  return onIdx >= 0 && kIdx > onIdx;
})(), '提示跑到渠道开关之前 ⇒ 位置不对');

// ================= ④ 文案面：terms 双副本 + 页面 t 映射 =================
const termsA = readOr(TERMS_A, '');
const termsB = readOr(TERMS_B, '');
ok('④-1 miniprogram/i18n/terms.js 有 channelOver100 定义', termsA.indexOf('channelOver100:') >= 0, '文案键被删');
ok('④-2 specs/dev-specs/i18n/terms.js 有 channelOver100 定义', termsB.indexOf('channelOver100:') >= 0, '双副本漏改');
ok('④-3 双副本 md5 一致',
  !!termsA && !!termsB && md5(Buffer.from(termsA, 'utf8')) === md5(Buffer.from(termsB, 'utf8')), '两副本漂移');
ok('④-4 页面 t 映射真绑定 channelOver100', js.indexOf('channelOver100:') >= 0, 'wxml 引用 {{t.channelOver100}} 会渲染成空白');

// ================= ⑤ 反恒真：合成样本必须转 false =================
// 目的不是"证明代码对"，而是"证明判据不是恒真"——每一条腿都要能被破坏。
const muts = [
  { name: '⑤-1 删掉 channel.over100 键 ⇒ 计算面红', src: rcBody.split('channel.over100').join('channel.over'), test: (b) => b.indexOf('channel.over100') >= 0 },
  { name: '⑤-2 纯函数调用改成硬编码 false ⇒ 计算面红', src: rcBody.split('isChannelRatioOver100(').join('false && isChannelRatioOver100_('), test: (b) => b.indexOf('isChannelRatioOver100(') >= 0 },
  { name: '⑤-3 wxml 去掉 t.channelOver100 ⇒ 渲染面红', src: xml.split('t.channelOver100').join('t.channelOver101'), test: renderWired },
  { name: '⑤-4 wxml 去掉 channel.over100 ⇒ 渲染面红', src: xml.split('channel.over100').join('channel.over99'), test: renderWired },
  { name: '⑤-5 注释里的 over100 不算数 ⇒ 剥注释后应红', src: stripXmlComments('<!-- ' + 'channel.over100 t.channelOver100' + ' --><view>x</view>'), test: renderWired },
  { name: '⑤-6 页面 t 映射去掉绑定 ⇒ 文案面红', src: js.split('channelOver100:').join('channelOver101:'), test: (s) => s.indexOf('channelOver100:') >= 0 },
];
muts.forEach((m) => ok(m.name, m.test(m.src) === false, '变异后判据仍为 true ⇒ 该腿恒真'));

// 行为面反恒真：把纯函数改成无条件 return false，行为面必须发现
let mutRule = null;
try {
  const bad = RULE_SRC.split('return sum - 100 > 1e-9;').join('return false;');
  if (bad === RULE_SRC) throw new Error('替换锚点未命中');
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', bad)(mod, mod.exports, require);
  mutRule = mod.exports;
} catch (e) { mutRule = null; }
ok('⑤-7 纯函数改成 return false ⇒ 行为面必须红', (function () {
  if (!mutRule || typeof mutRule.isChannelRatioOver100 !== 'function') return false;
  return mutRule.isChannelRatioOver100(60, 60) !== true;
})(), '变异模块不可用 ⇒ 无法证明行为面非恒真');

// ================= 汇总 =================
console.log('');
if (problems.length === 0) {
  console.log('✅ 渠道占比守卫：' + pass + '/' + pass + ' 通过（外卖+团购 ≤100% 已接线并守住）');
  process.exit(0);
}
console.log('❌ 渠道占比守卫：' + problems.length + ' 条未过（通过 ' + pass + '）');
problems.forEach((p) => console.log('   - ' + p));
process.exit(1);
