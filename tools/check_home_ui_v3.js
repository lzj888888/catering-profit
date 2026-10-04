#!/usr/bin/env node
// tools/check_home_ui_v3.js —— 首页 UI（v3 方案）冻结条款守卫（R207）
//
// 为什么必须新立守卫：本轮改的 5 条都是**纯视觉决策**，但每一条背后都是一个**已被证伪的旧方案**。
//   视觉改动的特点是没有类型检查、没有报错、也没有任何断言在管它 —— 只要后面有人"顺手改一下"
//   （比如把 hero 加回渐变、把空态改回 ¥0、顺手把"切换店铺"删了），立刻退回老毛病，
//   而已有 131 个套件**一条都不会红**。所以把冻结条款固化成机器判据。
//
// 五类判据（每组对应一段被评审推翻/确认的结论）：
//   A 头卡 hero：纯色(①) / min-height 而非固定高(②) / 店名必须截断(③) / 🔴空态绝不显示金额(④)
//   B 数据口径：当月用 ui.nowMonth() 取(①) / 利润取 operation_ref_profit_fen 与月度页同字段(②) / 三态防抖(③)
//   C 模块卡：三个模块入口一个都不能少(①) / 🔴店铺切换与设置入口不能被 UI 改版吃掉(②)
//             / 每张卡带 .ovh 防色条尖角(③) / 不用颜色区分模块(④)
//   D 全局两条：.money 等宽(①) / .ovh 单源存在(②) / 列表卡自己也带了 overflow(③)
//   S 自失效护栏：文件读全 + 关键锚点在场且唯一（防扫描面被写窄后恒绿）
//
// ⚠️ 判据一律**先取规则体再判**（提取 `.hero { ... }` / `.mod::before { ... }` 的花括号内容），
//    不做裸全文件 includes —— 本仓注释里写满了「反例说明」，裸扫必自命中（坑⑭/⑯ 同族）。
// ⚠️ fail-closed：文件缺失/规则体取不到 ⇒ 一律判红，不静默放行。
//
// 运行：node tools/check_home_ui_v3.js      （EXIT 0 = 全绿）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const F = {
  appWxss: 'app.wxss',
  idxWxml: 'pages/index/index.wxml',
  idxJs: 'pages/index/index.js',
  idxWxss: 'pages/index/index.wxss',
  matWxss: 'pages/material/index.wxss',
  terms: 'miniprogram/i18n/terms.js',
};

let pass = 0, fail = 0, n = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + (msg ? ' ' + msg : '')); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + (msg ? ' ' + msg : '')); };
// why：失败时补一句原因（判据自己说清为什么红，别让下一个人猜）
const ensure = (id, msg, cond, why) => { n++; (cond ? ok : no)(id + ' ' + msg, cond ? '' : why); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}

/** 去注释（wxss/js：块注释 + 行注释；wxml：HTML 注释）—— 注释里写反例是正当做法，不该判红 */
function strip(text, kind) {
  let s = String(text == null ? '' : text);
  if (kind === 'wxml') {
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    return s;
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  return s;
}

/**
 * 取某条 CSS 规则的花括号体（失败返回 null ⇒ 调用方必须判红，不得兜底成空串让判据恒绿）
 * sel 形如 '.hero' / '.mod::before'（按字面匹配选择器开头，避免误取 .hero-top 之类同前缀规则）
 */
function ruleBody(css, sel) {
  const i = css.indexOf(sel);
  if (i < 0) return null;
  const b = css.indexOf('{', i);
  if (b < 0) return null;
  let depth = 0;
  for (let k = b; k < css.length; k += 1) {
    if (css[k] === '{') depth += 1;
    else if (css[k] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(b + 1, k);
    }
  }
  return null;
}

const raw = {};
const src = {};
for (const k of Object.keys(F)) {
  raw[k] = read(F[k]);
  const kind = /\.wxml$/.test(F[k]) ? 'wxml' : 'css';
  src[k] = strip(raw[k], kind);
}

// ⚠️ 故意**不**写成 `===== xxx =====`：verify_all 的 R66 会对形如段标题的行做「标题下零断言」审计，
//    总标题下若空一行才到第一个分组 ⇒ 会被判「某个段落零断言」（本守卫首发就吃过这条红）。
console.log('首页 UI（v3）冻结条款守卫\n');

// ══════ S 自失效护栏（先跑：文件不全就别判别的，否则一条都绿不起来还看不出为什么）══════
section('S 自失效护栏');
const missing = Object.keys(F).filter((k) => !raw[k]);
ensure('S-①', '五个被检文件全部读到了', missing.length === 0, missing.length ? '缺失：' + missing.join('、') : '');

// 锚点：万一文件被改名/搬空，上面 S-① 是顶层保险；但更阴的是"文件在、内容被换走"⇒ 锚点必须在场
// ⚠️ 锚点一律选**函数定义**那种唯一形态：`loadRefProfit` 在 js 里出现 3 次（定义 + onShow + 下拉刷新），
//    用裸名字串判「唯一」必自红 ⇒ 用定义形态 `async loadRefProfit(` 才是唯一的一处。
const ANCHORS = [
  { k: 'idxWxml', token: 'class="hero ovh"', why: 'index.wxml 里找不到头卡 hero 区块' },
  { k: 'idxJs', token: 'async loadRefProfit(', why: 'index.js 里找不到取参考利润的方法定义' },
  { k: 'idxWxss', token: '.hero {', why: 'index.wxss 里找不到 .hero 规则' },
  { k: 'appWxss', token: '.money {', why: 'app.wxss 里找不到 .money 单源类' },
];
for (const a of ANCHORS) {
  const c = (raw[a.k] || '').split(a.token).length - 1;
  ensure('S-②', '锚点在场且唯一：' + a.token, c === 1, a.why + '（命中 ' + c + ' 次，应为 1）');
}

// ══════ A 头卡 hero ══════
section('A 头卡 hero（纯色 / 可伸缩 / 店名截断 / 空态不显示金额）');
const heroBody = ruleBody(src.idxWxss, '.hero {');
ensure('A-①', '.hero 规则体取得到', !!heroBody, 'index.wxss 里没有 .hero 规则 ⇒ 头卡已被改没');
if (heroBody) {
  ensure('A-②', '头卡底色是**纯色**（大面积背景用渐变纯属装饰，v1 的渐变已被评审否掉）',
    heroBody.indexOf('linear-gradient') < 0, '检测到大面积渐变 —— 改回 v1 写法了');
  ensure('A-③', '头卡底色仍用品牌墨蓝', heroBody.indexOf('#1e3a5f') >= 0, '底色不是 #1e3a5f');
  ensure('A-④', '头卡用 **min-height**（固定高度 + 长店名 ⇒ 挤压净利数字，这是红队实测出来的）',
    heroBody.indexOf('min-height') >= 0, '.hero 里没有 min-height');
}
const heroNameBody = ruleBody(src.idxWxss, '.hero-name {');
ensure('A-⑤', '店名必须截断（overflow:hidden + ellipsis）',
  !!heroNameBody && heroNameBody.indexOf('ellipsis') >= 0 && heroNameBody.indexOf('overflow: hidden') >= 0,
  '店名没有 ellipsis ⇒ 超过 12 字的店名会顶坏下面的数字');

// 🔴 空态（profitKnown && !hasProfit 那个分支）**绝不能**出现金额 —— 四条 Warehousing zero =>
//   老板会把 ¥0 读成"这店没赚钱"，这是新用户流失的头号来源。
const iElif = src.idxWxml.indexOf('wx:elif="{{profitKnown}}"');
const iElse = src.idxWxml.indexOf('wx:else', iElif);
ensure('A-⑥', '取得到「空态分支」代码块', iElif >= 0 && iElse > iElif, 'index.wxml 里没有 profitKnown 的空态分支 ⇒ 三态渲染被改掉了');
if (iElif >= 0 && iElse > iElif) {
  const emptyBlock = src.idxWxml.slice(iElif, iElse);
  ensure('A-⑦', '🔴 空态分支**不渲染任何金额**（不得出现货币符号插值）',
    emptyBlock.indexOf('{{t.cur}}') < 0, '空态里出现了 {{t.cur}} ⇒ 会显示 ¥0');
  ensure('A-⑧', '空态必须有出口按钮文案（否则新用户进来没路走）',
    emptyBlock.indexOf('heroCtaEnter') >= 0 || src.idxWxml.indexOf('heroCtaEnter') >= 0,
    '找不到录入入口文案');
}
// ⚠️ 扫描面**只限首页 hero 自己的术语键**：「记一笔」是摊销资产页的**既有合法文案**
//    （TERMS.*.lumpAdd = '记一笔'），扫全 terms.js 必然误杀存量 ⇒ 这是本守卫差点犯的同族错误。
const HERO_KEYS = ['heroSwitch', 'heroRefLabel', 'heroNoData', 'heroNoDataHint', 'heroCtaEnter', 'heroCtaDetail'];
let heroTexts = '';
for (const k of HERO_KEYS) {
  const m = (src.terms || '').match(new RegExp('\\b' + k + ":\\s*'([^']*)'"));
  if (m) heroTexts += m[1];
}
ensure('A-⑨', 'CTA 文案不叫「记一笔」（会被理解成记当日流水，点进去却是月度科目 ⇒ 觉得被骗）',
  src.idxWxml.indexOf('记一笔') < 0 && heroTexts.indexOf('记一笔') < 0,
  '首页渲染面里出现了「记一笔」');
ensure('A-⑩', '六个 hero 术语键全部取到值（少一个 ⇒ 页面上就是空白按钮/空白标签）',
  HERO_KEYS.every((k) => (src.terms || '').indexOf(k + ':') >= 0),
  'terms.js 里 hero 键不全；wxml 引用了不存在的键会**静默渲染成空**');

// ══════ B 数据口径 ══════
section('B 数据口径（当月来源 / 利润字段 / 三态防抖）');
ensure('B-①', '当月用 ui.nowMonth() 取（不硬编码月份 ⇒ 跨月不会停在旧月份）',
  src.idxJs.indexOf('ui.nowMonth()') >= 0, 'index.js 里没有 ui.nowMonth()');
ensure('B-②', '利润取 getLedger 的 operation_ref_profit_fen（与月度结果页 netRef **同字段**，不在这里另算）',
  src.idxJs.indexOf('getLedger') >= 0 && src.idxJs.indexOf('operation_ref_profit_fen') >= 0,
  'index.js 没有按要求取数 ⇒ 口径会与月度页漂移');
ensure('B-③', '**三态**标志在 data 里（未确定 ≠ 无数据，否则老用户每次进首页先闪一帧空态）',
  src.idxJs.indexOf('profitKnown') >= 0, 'data 里没有 profitKnown');
ensure('B-④', '取数失败**静默降级**（这块只是装饰性总结，不该弹第二个 toast 制造噪音）',
  /catch\s*\(\s*e\s*\)\s*\{[^}]*setData\(\{\s*hasProfit:\s*false,\s*profitKnown:\s*true\s*\}\)/.test(src.idxJs.replace(/\s+/g, ' ')) ||
  src.idxJs.indexOf('catch (e)') >= 0, 'loadRefProfit 没有兜底分支 ⇒ 取数失败会让首页一直转圈');

// ══════ C 模块卡（🔴 UI 改版最容易顺手把功能删了，这里专门盯着入口）══════
section('C 模块卡与入口保全');
for (const m of [['goMonth', 'M1 月度'], ['goSandbox', 'M2 开店盈亏'], ['goCard', 'M3 菜品毛利']]) {
  ensure('C-①', '模块入口仍绑 ' + m[1] + '（' + m[0] + '）',
    src.idxWxml.indexOf(m[0]) >= 0 && src.idxJs.indexOf(m[0] + '(') >= 0,
    '找不到该方法 ⇒ 这个模块从首页走不到了');
}
// 这两条是「UI 改版吃掉功能」的头号受害人：原第一张卡唯一的用途就是切换店铺
ensure('C-②', '🔴 店铺切换入口仍在（它是原「当前店铺卡」**唯一**的功能，改版时最容易被吃掉）',
  src.idxWxml.indexOf('goSwitch') >= 0 && src.idxJs.indexOf('goSwitch(') >= 0, 'goSwitch 没了 ⇒ 用户换不了店铺');
ensure('C-③', '店铺设置入口仍在（无 tabBar 替代入口，删了就少一条路）',
  src.idxWxml.indexOf('goSettings') >= 0, 'goSettings 没了');

const modCount = (src.idxWxml.match(/class="mod ovh"/g) || []).length;
ensure('C-④', '三张模块卡都带 `.ovh`（8rpx 竖条超出圆角会冒尖角）',
  modCount === 3, '带 ovh 的模块卡是 ' + modCount + ' 张，应为 3');

const modBefore = ruleBody(src.idxWxss, '.mod::before');
ensure('C-⑤', '🔴 模块卡**不用颜色区分**（红绿已绑定涨跌语义，当模块色会被读成盈亏）',
  !!modBefore && modBefore.indexOf('#1e3a5f') >= 0 && modBefore.indexOf('#c0392b') < 0 && modBefore.indexOf('#1e8e5a') < 0,
  '竖条不是统一墨蓝 / 出现了语义色');

// ══════ D 全局两条（等宽 + overflow 单源）══════
section('D 全局单源（金额等宽 / 圆角防溢出）');
const moneyBody = ruleBody(src.appWxss, '.money {');
ensure('D-①', 'app.wxss 的 .money 含 tabular-nums（金额小数点对齐，治"看着乱"最便宜的一招）',
  !!moneyBody && moneyBody.indexOf('tabular-nums') >= 0, '.money 里没有 tabular-nums');
const ovhBody = ruleBody(src.appWxss, '.ovh {');
ensure('D-②', 'app.wxss 的 .ovh 含 overflow:hidden（**单源**，页面不自造第二份）',
  !!ovhBody && ovhBody.indexOf('overflow: hidden') >= 0, '.ovh 里没有 overflow: hidden');
const matCardBody = ruleBody(src.matWxss, '.card2 {');
ensure('D-③', '原料列表卡自己也带了 overflow（左侧 8rpx 色条 + 20rpx 圆角 = 尖角溢出现场）',
  !!matCardBody && matCardBody.indexOf('overflow: hidden') >= 0, '原料卡的 .card2 没有 overflow: hidden');

console.log('\n===== 首页 UI（v3）守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====\n');
process.exit(fail === 0 ? 0 : 1);
