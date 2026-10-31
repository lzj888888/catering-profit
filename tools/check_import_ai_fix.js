#!/usr/bin/env node
// tools/check_import_ai_fix.js —— R590（第 227 套件）
// 「让 AI 帮你转格式」逃生口：那段指令**教 AI 产什么表**，写错了我们抓不住。
//
// 为什么它必须被守卫（不是"写完就算"）：
//   指令是给 AI 看的规格，它和我们的解析器是**两套独立的东西**。一旦不一致：
//     · 列名改了但指令没改 ⇒ 教 AI 产一个我们已经不认的表 ⇒ 老板试一次就失败；
//     · 少了「看不出就问」⇒ AI 自己编渠道 ⇒ 整批进错榜，而且我们**发现不了**（R589 实测）；
//     · 少了「删合计行」⇒ 合计被当菜品入库 ⇒ 毛利榜凭空多一条、金额翻倍。
//   这些都不会报错，只会让老板算出错账，或者试一次就不再用。
//
// 🔴 判据取材于 R589 的真实实验，不是凭想象列的：
//   把契约 + 乱格式原料发给豆包 / DeepSeek，两家都能产对格式，
//   但**都自己编了年份**（豆包 2024、DeepSeek 2025，正确 2026，两家还互不相同），
//   **都自己填了渠道**（原料没有渠道列）。这两条直接决定了指令里必须写死什么。
//
// 运行：node tools/check_import_ai_fix.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, failN = 0;
const check = (id, cond, detail) => {
  const tail = (detail === undefined || detail === null || detail === '') ? '' : ' —— ' + detail;
  if (cond) { pass++; console.log('  ✅ ' + id + tail); }
  else { failN++; console.log('  ❌ ' + id + tail); }
};
const sec = (t) => console.log('\n===== ' + t + ' =====');

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}
// 剥注释：本仓反复踩过「注释里写一句就喂成恒真」和它的镜像病（注释喂成恒红），两边都要防
const strip = (src) => String(src || '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------- 被测对象 ----------
let TERMS = null, D = null;
try { TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS; } catch (e) { TERMS = null; }
try { D = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js')); } catch (e) { D = null; }

const TK = (TERMS && TERMS.ledger && TERMS.ledger.takeaway) || {};
const YEAR = '2026';
const SVC_HEADERS = (D && D.HEADERS) || [];
let PROMPT = '';
try {
  PROMPT = (typeof TK.importAiPrompt === 'function') ? TK.importAiPrompt(SVC_HEADERS.join(','), YEAR) : '';
} catch (e) { PROMPT = ''; }

const pageStripped = strip(read('subpkg/biz/takeaway/index.js'));
const wxmlSrc = read('subpkg/biz/takeaway/index.wxml') || '';
const wxssSrc = read('subpkg/biz/takeaway/index.wxss') || '';

// ---------- 判据抽成纯函数：既给正例用，也给反证用 ----------
// 同一份判据跑两遍（真值 / 篡改值），才能证明它不是恒真（R299 纪律）
const hasHeaders = (prompt, headers) =>
  !!(headers && headers.length && prompt && prompt.indexOf(headers.join(',')) >= 0);

const saysDontGuess = (prompt) =>
  !!(/看不(出|到)[^。\n]*[问别]/.test(prompt || '') || /不要自己猜/.test(prompt || ''));

const saysDeleteTotalRow = (prompt) => /删掉?[^。\n]*合计行/.test(prompt || '');

// 防「编数据」：这条比格式约束更要紧 —— 编出来的表格式全对、解析器全过，会静默入库
const saysDontFabricate = (prompt) =>
  /不要编[^。\n]*商品/.test(prompt || '') && /告诉我缺什么/.test(prompt || '');

const pageHeadersMatch = (pageHeaders, svcHeaders) =>
  !!(pageHeaders && pageHeaders.length && svcHeaders && svcHeaders.length
     && pageHeaders.join(',') === svcHeaders.join(','));

// 页面里的列名副本（静态提取：`const DSI_HEADERS = [...]`）
function extractPageHeaders() {
  const m = pageStripped.match(/const\s+DSI_HEADERS\s*=\s*\[([^\]]*)\]/);
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}
const PAGE_HEADERS = extractPageHeaders();

console.log('[R590] 「让 AI 帮你转格式」逃生口守卫\n');

// ================= A · 指令正文（它决定 AI 产什么表） =================
sec('A · 指令正文：AI 照着它产表，所以每一条都是硬约束');

check('A-⓪ 指令正文可取到（取不到 ⇒ 后面全 fail-closed，不假绿）',
  PROMPT.length > 50, PROMPT.length + ' 字');

// A-① 列名与解析器逐字一致 —— 最重要的一条：不一致就是"教 AI 产我们不认的表"
check('A-① 🔴 指令里的列名与 dsi1.HEADERS 逐字且同序一致',
  hasHeaders(PROMPT, SVC_HEADERS), SVC_HEADERS.join(',') || 'dsi1 未加载');

// A-② 年份必须写死（R589：两家 AI 都自己编了年份，且互不相同）
check('A-② 🔴 指令写死年份并明说不要改（AI 会把缺年份的 9/7 编成 2024/2025）',
  PROMPT.indexOf(YEAR) >= 0 && /不要改|别改|不要修改/.test(PROMPT),
  PROMPT.indexOf(YEAR) >= 0 ? '含 ' + YEAR : '未含年份');

// A-③ 渠道不许猜（R589：原料没渠道列时两家都自己填「堂食」）
check('A-③ 🔴 指令要求「看不出就别猜、先问我」', saysDontGuess(PROMPT));

// A-④ 合计行 / 两级表头必须删（最常见的"导不进来"成因）
check('A-④ 指令要求删掉合计行', saysDeleteTotalRow(PROMPT));
check('A-⑤ 指令要求删掉两级表头 / 合并单元格',
  /两级表头/.test(PROMPT) && /合并单元格/.test(PROMPT));

// A-⑥ 纯数字（实测原料带「元」「¥」「斤」，解析器会当字符串拒收）
check('A-⑥ 指令要求纯数字、不带「元/¥/斤」等单位',
  /纯数字/.test(PROMPT) && /元/.test(PROMPT) && /斤/.test(PROMPT));

// A-⑦ 小数与负数（豆包评审指出的称重类、DeepSeek 指出的退款）
check('A-⑦ 指令允许称重小数（1.5 不要写成 2）',
  /1\.5/.test(PROMPT) && /不(要|能)写成 ?2/.test(PROMPT));
check('A-⑧ 指令要求退款填负数、不许删行或转正',
  /退款填负数/.test(PROMPT) && /不要删除?行|不要删行/.test(PROMPT));

// A-⑨ 输出形态：只给 CSV、不要解释（否则产物里混说明文字，解析器认不出表头）
check('A-⑨ 指令要求只输出 CSV、不要解释/代码块标记',
  /CSV/.test(PROMPT) && /不要解释/.test(PROMPT) && /代码块/.test(PROMPT));

// A-⑩ 🔴 最要紧的一条：**允许 AI 交白卷**。
//   没有它，AI 为了让"任务完成"会在源表缺明细时**编商品名和销量** ——
//   而编出来的表格式全对、解析器全过 ⇒ 静默入库 ⇒ 毛利榜出现他根本没卖过的菜。
//   ⇒ 这比"导不进来"严重得多：导不进来他会重试，编错了账他看不出来。
check('A-⑩ 🔴 指令明确要求「没有明细就不许编，直接说缺什么」',
  saysDontFabricate(PROMPT));

// ================= B · 接线（算出来不显示 = 没做） =================
sec('B · 接线：按钮真的接上了吗、只在失败态出现吗');

check('B-① wxml 里有复制按钮，且 bindtap 指向**真实存在**的方法',
  /bindtap="onCopyAiFix"/.test(wxmlSrc) && /^  onCopyAiFix\(\)/m.test(pageStripped));

check('B-② 🔴 方法真调 wx.setClipboardData（不是只弹个 toast 骗人）',
  /onCopyAiFix\(\)[\s\S]{0,700}?wx\.setClipboardData\(/.test(pageStripped));

check('B-③ 剪贴板内容来自 terms 的 importAiPrompt（不在这里现拼一份，否则两处会分叉）',
  /onCopyAiFix\(\)[\s\S]{0,700}?TK\.importAiPrompt\(/.test(pageStripped));

check('B-④ 🔴 复制失败时把正文摊开（只报「失败了」= 老板卡死在这一步）',
  /importAiFixText/.test(wxmlSrc) && /user-select="true"/.test(wxmlSrc)
  && /fail:[\s\S]{0,300}?importAiFixText: text/.test(pageStripped));

// B-⑤ 逃生口只在诊断块内：诊断块从 `wx:if="{{importDiagText}}"` 起到下一个 card2 之前
check('B-⑤ 逃生口**只在诊断态**里，不会在预览/成功态冒出来',
  (function () {
    const iDiag = wxmlSrc.indexOf('wx:if="{{importDiagText}}"');
    const iBtn = wxmlSrc.indexOf('bindtap="onCopyAiFix"');
    if (iDiag < 0 || iBtn < 0 || iBtn < iDiag) return false;
    const iNext = wxmlSrc.indexOf('<view class="card2"', iDiag + 10);
    return iNext < 0 ? false : iBtn < iNext;
  })());

check('B-⑥ 两个新样式类都有定义（没定义 = 提示文字裸奔，且不报错）',
  /\.copied-hint\s*\{/.test(wxssSrc) && /\.ai-fix-text\s*\{/.test(wxssSrc));

// ================= C · 前端列名副本不能漏改 =================
sec('C · 前端列名副本（小程序包不能 require 云函数，只能抄一份 ⇒ 必须对拍）');

check('C-⓪ 页面 DSI_HEADERS 可解析（解析不到 ⇒ 下面 fail-closed）',
  !!(PAGE_HEADERS && PAGE_HEADERS.length), (PAGE_HEADERS || []).join(','));

check('C-① 🔴 页面 DSI_HEADERS 与 dsi1.HEADERS 逐字且同序一致',
  pageHeadersMatch(PAGE_HEADERS, SVC_HEADERS),
  (PAGE_HEADERS || []).join(',') + '  vs  ' + SVC_HEADERS.join(','));

// ================= D · 反恒真（同一份判据跑篡改值，必须翻红） =================
sec('D · 反恒真：把约束去掉 / 改一个字，同一判据必须翻红');

check('D-① 去掉「别猜」那句 ⇒ saysDontGuess 必须为 false',
  (function () {
    const broken = PROMPT.replace(/表里看不出来就先问我，不要自己猜。?/g, '');
    return broken !== PROMPT && saysDontGuess(broken) === false;
  })());

check('D-② 去掉「删掉合计行」那句 ⇒ saysDeleteTotalRow 必须为 false',
  (function () {
    const broken = PROMPT.replace(/^6\. 删掉合计行[^\n]*$/m, '');
    return broken !== PROMPT && saysDeleteTotalRow(broken) === false;
  })());

check('D-③ 列名改一个字（销量→数量）⇒ hasHeaders 必须为 false（证明是逐字比，不是"含几个词"）',
  (function () {
    if (!SVC_HEADERS.length) return false;
    const bad = SVC_HEADERS.slice();
    bad[4] = '数量';
    return bad.join(',') !== SVC_HEADERS.join(',') && hasHeaders(PROMPT, bad) === false;
  })());

check('D-⑤ 去掉「不许编」那条 ⇒ saysDontFabricate 必须为 false',
  (function () {
    const broken = PROMPT.replace(/^★ 最重要：[^\n]*$/m, '');
    return broken !== PROMPT && saysDontFabricate(broken) === false;
  })());

check('D-④ 页面副本少一列 ⇒ pageHeadersMatch 必须为 false（证明它真在比，不是恒真）',
  (function () {
    if (!PAGE_HEADERS || !SVC_HEADERS.length) return false;
    return pageHeadersMatch(PAGE_HEADERS.slice(0, -1), SVC_HEADERS) === false;
  })());

console.log('\n' + (failN ? '❌ ' : '✅ ') + pass + ' 通过 / ' + failN + ' 失败');
process.exit(failN ? 1 : 0);
