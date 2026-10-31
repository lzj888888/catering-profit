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
//   ③ **渲染面**：`subpkg/tools/sandbox/index.wxml`（**剥注释**）里 `channel.over100` 真出现在 `wx:if`
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
const PAGE_JS = path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'index.js');
const PAGE_WXML = path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'index.wxml');
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
  //   只认**定义处**。实证：`subpkg/tools/sandbox/index.js:683` 有一处 `this.recomputeChannel();` 排在
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
ok('②-0 subpkg/tools/sandbox/index.js 存在', !!jsRaw, jsRaw ? '' : '文件缺失');
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
ok('③-0 subpkg/tools/sandbox/index.wxml 存在', !!xmlRaw, xmlRaw ? '' : '文件缺失');
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

// ================= ⑥ 组：费率三态「留空=行业参考值 / 填 0=真没有」（R546 · ⑦ 平台抽成）=================
// 为什么守：这四个费率老板**算不出**，原代码把它们默认成 0 —— 等于替他认定
//   「外卖没包装费、团购没打折」⇒ 渠道费率偏低 ⇒ 保本额偏低 ⇒ 老板以为更容易回本。
//   方向错的数比不准的数危险。现在改成「留空 = 不知道（走参考值，界面打 ※）；填 0 = 真没有」。
//   🔴 这三层语义只靠代码注释是保不住的 —— 有人把 `''` 改回 `0`、或把 take() 换回 `Number(x)||0`，
//      界面照样能跑、数字照样出，**没有任何一个套件会红**。所以在这里钉死。
console.log('');
console.log('===== ⑥ 组 · 费率三态：留空走参考值、填 0 才是真没有 =====');
const REF_KEYS = ['platformRate', 'packRate', 'groupPlatformRate', 'discountRate', 'cardRate'];
const RULE_TXT = fs.readFileSync(RULE, 'utf8');
const refMissing = REF_KEYS.filter(function (k) { return RULE_TXT.indexOf(k + ':') < 0; });
ok('⑥-1 CHANNEL_REF 五个参考值齐全（数字的唯一来源）',
  RULE_TXT.indexOf('const CHANNEL_REF') >= 0 && refMissing.length === 0, '缺：' + refMissing.join(','));

// ⑥-2 默认值必须是空串 —— 本轮核心修正。改回 0 就等于"替他认定没有这笔"
const notBlank = REF_KEYS.filter(function (k) { return js.indexOf(k + ": '',") < 0; });
ok('⑥-2 五个费率在 data 里默认是空串（不是 0）', notBlank.length === 0,
  '仍默认成数字：' + notBlank.join(',') + ' ⇒ 空与 0 又被混为一谈');

// ⑥-3 take() 三态取值器真在函数体内、且真被调用（防"只定义不用"）
ok('⑥-3 recomputeChannel 用 take() 取值，且空/读不成/负数一律回落参考值',
  rcBody.indexOf('const take =') >= 0 &&
  rcBody.indexOf('take(c.platformRate') >= 0 && rcBody.indexOf('take(c.discountRate') >= 0 &&
  rcBody.indexOf('useRef: 1') >= 0);

// ⑥-4 旧写法必须绝迹：`Number(x) || 0` 正是"空=0"的病根
const oldForm = ['Number(c.platformRate)', 'Number(c.packRate)', 'Number(c.groupPlatformRate)', 'Number(c.discountRate)']
  .filter(function (k) { return rcBody.indexOf(k) >= 0; });
ok('⑥-4 函数体内不再有 Number(x)||0 旧写法', oldForm.length === 0, oldForm.join(','));

// ⑥-5 R544 的一行修正：佣金基数是"顾客实付团购价"⇒ 折扣与抽成在 d·c 上交叠，直减=重复扣
ok('⑥-5 团购费率含 d·c 交叠修正（否则重复扣、保本虚高约 2.9%）',
  rcBody.indexOf('(dc.v * gp.v) / 100') >= 0, '未见交叠项 ⇒ 退回了 d+c');

// ⑥-6/⑥-7 渲染面：替老板按参考值算了，就必须让他**看见**
ok('⑥-6 留空项在行名后打 ※（外卖抽成 / 包装 / 团购抽成 / 折扣 四处）',
  xml.indexOf("channel.refs.platformRate ? ' ※' : ''") >= 0 &&
  xml.indexOf("channel.refs.packRate ? ' ※' : ''") >= 0 &&
  xml.indexOf("channel.refs.groupPlatformRate ? ' ※' : ''") >= 0 &&
  xml.indexOf("channel.refs.discountRate ? ' ※' : ''") >= 0,
  '有项目没打标记 ⇒ 老板不知道哪个数不是他填的');
ok('⑥-7 ※ 有图例解释（只打星号不解释 = 老板看不懂）',
  xml.indexOf('channel.anyRef') >= 0 && xml.indexOf('t.channelRefNote') >= 0);

// ⑥-8 placeholder 必须由 CHANNEL_REF 拼出（写死在 wxml / 术语里 = 两份真相源，改一处就漂）
ok('⑥-8 placeholder 绑 data 里由 CHANNEL_REF 生成的值，不在 wxml/术语里写死数字',
  xml.indexOf('placeholder="{{channel.phPlatformRate}}"') >= 0 &&
  xml.indexOf('placeholder="{{channel.phDiscountRate}}"') >= 0);
const TERMS_TXT = fs.readFileSync(TERMS_A, 'utf8');
// ⚠️ 只拦「留空按 + 数字」——术语里**该说**「留空按行业参考值算」（那是口径说明），
//    但绝不能出现「留空按 20%」（那是把 CHANNEL_REF 抄了第二份，改一处就漂）。无正则，逐字看。
const refLeak = (function () {
  const needle = '留空按';
  let i = TERMS_TXT.indexOf(needle);
  while (i >= 0) {
    const ch = TERMS_TXT.charAt(i + needle.length);
    if (ch >= '0' && ch <= '9') return TERMS_TXT.substr(i, 18);
    i = TERMS_TXT.indexOf(needle, i + 1);
  }
  return '';
})();
ok('⑥-9 术语里不出现「留空按 <数字>」（参考值只能来自 CHANNEL_REF）',
  refLeak === '', '命中：' + refLeak);

// ⑥-16~18 🔴 R577：口径表述守卫（李老师 2026-10-31 质疑「外卖抽成通常就是那么高」）。
//   旧文案写「技术服务费比例，一般 18~23%」，两处都错：
//     ① 技术服务费（纯佣金）实测只占商品金额 2.47%，与 18~23% 差 5 倍；
//     ② 18~23% 是「扣点 ÷ 商家实收」口径（本店 19.47% 正好落在区间内），
//        而本栏基数是外卖**流水** ⇒ 同一笔扣点除以更大分母，实测只有 11.46% / 17.53%。
//   ⇒ 判据：说明里必须点明「配送服务费」（= 合口径），且不得再出现「技术服务费比例…18~23」。
const chBody = (TERMS_TXT.match(/channelRefBody:\s*'([^']*)'/) || [])[1] || '';
ok('⑥-16 渠道说明取到了（取不到 ⇒ 下一条会因空串而恒真，fail-closed）',
  chBody.length > 50, chBody.length + ' 字');
ok('⑥-17 🔴 渠道说明必须点名「配送服务费」，且不得再写成「技术服务费比例 18~23%」',
  /配送服务费/.test(chBody) && !/技术服务费比例[^。]*18\s*[~-]\s*23/.test(chBody));
// 反恒真：把旧文案喂进同一判据 ⇒ 必须判不通过（证明 ⑥-17 有分辨力）
const _oldBody = '外卖平台抽成：商家后台「结算 / 费用明细」里的技术服务费比例，一般 18~23%。';
ok('⑥-18 反恒真：旧文案「技术服务费比例 18~23%」喂进 ⑥-17 的判据 ⇒ 必须不通过',
  !(/配送服务费/.test(_oldBody) && !/技术服务费比例[^。]*18\s*[~-]\s*23/.test(_oldBody)));

// ⑥-13/⑥-14 草稿双面（R298Y 教训：「读到了 ≠ 送出去了」—— 必须分别守写入面与读取面）
//   实测：`channel` 原来**整块不进草稿** ⇒ 老板填了抽成/折扣，退出重进全丢、静默回默认值。
const saveBody = bodyOf(js, 'saveDraft');
const restBody = bodyOf(js, 'restoreDraft');
ok('⑥-13 saveDraft 真把 channel 写进草稿（写入面）',
  saveBody.indexOf('channel: {') >= 0 &&
  saveBody.indexOf('discountRate: this.data.channel.discountRate') >= 0,
  '未写入 ⇒ 填了抽成/折扣退出即丢');
ok('⑥-14 restoreDraft 真回填 channel、且回填后立刻重算派生（读取面 + 顺序）',
  restBody.indexOf('d.channel') >= 0 && restBody.indexOf('this.recomputeChannel()') >= 0 &&
  restBody.indexOf('this.recomputeChannel()') > restBody.indexOf('d.channel'),
  '回填了但不重算 ⇒ on=true 而 takeawayComm=0 ⇒ 渠道费率当 0 用、保本偏低');

// ⑥-10/⑥-11 反恒真：把关键改动改回去，对应判据必须转红
const mut6 = [
  { name: '⑥-10 把 packRate 默认值改回 0 ⇒ ⑥-2 必须红',
    src: js.split("packRate: '',").join('packRate: 0,'),
    test: function (s) { return REF_KEYS.filter(function (k) { return s.indexOf(k + ": '',") < 0; }).length === 0; } },
  { name: '⑥-11 去掉 d·c 交叠项 ⇒ ⑥-5 必须红',
    src: rcBody.split(' - (dc.v * gp.v) / 100').join(''),
    test: function (s) { return s.indexOf('(dc.v * gp.v) / 100') >= 0; } },
  { name: '⑥-15 删掉 saveDraft 的 channel 键 ⇒ ⑥-13 必须红',
    src: saveBody.split('channel: {').join('ch_x: {'),
    test: function (s) { return s.indexOf('channel: {') >= 0; } },
  { name: '⑥-12 把 ※ 标记从 wxml 去掉 ⇒ ⑥-6 必须红',
    src: xml.split("channel.refs.discountRate ? ' ※' : ''").join(''),
    test: function (s) { return s.indexOf("channel.refs.discountRate ? ' ※' : ''") >= 0; } },
];
mut6.forEach(function (m) { ok(m.name, m.test(m.src) === false, '变异后判据仍为 true ⇒ 该腿恒真'); });

// ================= 汇总 =================
console.log('');
if (problems.length === 0) {
  console.log('✅ 渠道占比守卫：' + pass + '/' + pass + ' 通过（外卖+团购 ≤100% 已接线并守住）');
  process.exit(0);
}
console.log('❌ 渠道占比守卫：' + problems.length + ' 条未过（通过 ' + pass + '）');
problems.forEach((p) => console.log('   - ' + p));
process.exit(1);
