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
// 🔴 R591：判「列名与顺序对不对」，**不判分隔符长什么样**。
//   起因：指令里自然语言写的是「日期、渠道（堂食或外卖）、平台…」（顿号 + 括注），
//   而旧判据找的是「日期,渠道,平台…」这串逗号字面量 ⇒ **把正确实现判红**（反向伤害二型）。
//   现在的判法：7 个列名必须**按顺序**逐个出现（允许中间夹括注）。
//   分辨力仍在：漏一个 ⇒ 找不到；顺序颠倒 ⇒ 后面的 pos 越过了它，也找不到。
const hasHeaders = (prompt, headers) => {
  if (!headers || !headers.length || !prompt) return false;
  let pos = 0;
  for (const h of headers) {
    const i = prompt.indexOf(h, pos);
    if (i < 0) return false;
    pos = i + h.length;
  }
  return true;
};

const saysDontGuess = (prompt) =>
  !!(/看不(出|到)[^。\n]*[问别]/.test(prompt || '') || /不要自己猜/.test(prompt || ''));

const saysDeleteTotalRow = (prompt) => /删掉?[^。\n]*合计行/.test(prompt || '');

// ⚠️ R591：原来还有 saysDontGuess / saysDontFabricate 两条判据，
//   实测发现 AI 面对缺明细/缺渠道时**本身就不编**（两家都拒答），且「不许编」那句
//   在 148 字版里已删除、行为不变 ⇒ 判据随之删除。**判据要跟着事实走，不能留着占位。**

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
// 🔴 R591 重写：旧版 11 条规则里**大半被实测判定可省**（512 字 → 148 字，砍 71%）。
//   实验证据（review/evidence/r591_simplify/，逐版喂解析器）：
//     · 84 字（漏「备注」）      ⇒ 表头 6 列，豆包 + DeepSeek 都被拒收
//     · 137 字（漏「这张表是__的」）⇒ 两家都留空渠道，被拒收
//     · 148 字（补上这两处）     ⇒ 两家 **100% 正确**（10 行 / 1265.00 / 销量 60 / 4 商品）
//     · 148 字 + 无明细诱饵      ⇒ 两家**都拒答不编**（AI 自己有底线，不靠我们叮嘱）
//   ⇒ 本节只守「实测必需」的几条。**不要凭直觉往里加规则**——加一条就多一分说明书味。
sec('A · 指令正文：只守实测必需的那几条');

check('A-⓪ 指令正文可取到（取不到 ⇒ 后面全 fail-closed，不假绿）',
  PROMPT.length > 30, PROMPT.length + ' 字');

// A-① 列名与解析器逐字一致 —— 实测：漏「备注」⇒ 表头 6 列 ⇒ 两家全被拒收
check('A-① 🔴 列名与 dsi1.HEADERS **逐字且同序**一致（含「备注」，漏了必被拒）',
  hasHeaders(PROMPT, SVC_HEADERS), SVC_HEADERS.join(',') || 'dsi1 未加载');

// A-② 年份写死（R589 实测：缺年份时豆包编 2024、DeepSeek 编 2025，两家还互不相同）
check('A-② 🔴 写死年份（缺年份 AI 会自己编，且不同 AI 编得不一样）',
  PROMPT.indexOf(YEAR) >= 0, PROMPT.indexOf(YEAR) >= 0 ? '含 ' + YEAR : '未含年份');

// A-③ 渠道占位 —— 实测：不指定时两家一个留空、一个瞎猜，**两种都不可接受**
check('A-③ 🔴 有「这张表是【___】的」让老板填渠道（缺这句 ⇒ 留空或瞎猜，两条都是错账）',
  /这张表是【[^】]*】的/.test(PROMPT));

// A-④ 删合计行（实测原料带「合计」行；不删会被当商品入库）
check('A-④ 要求删掉合计行', saysDeleteTotalRow(PROMPT));

// A-⑤ 纯数字（实测原料带「元」「斤」，解析器会当字符串拒收）
check('A-⑤ 要求金额纯数字、不带「元」；并按斤的填小数',
  /只写数字/.test(PROMPT) && /元/.test(PROMPT) && /小数/.test(PROMPT));

// A-⑥ 只输出 CSV —— 实测：没这句时**豆包会吐 Markdown 表格**（DeepSeek 不会），一眼看不出的坑
check('A-⑥ 🔴 要求直接给 CSV、不要表格样式/解释（没这句豆包会吐 Markdown）',
  /CSV/.test(PROMPT) && /不要表格样式/.test(PROMPT));

// A-⑦ 🔴 长度上限：把「简单」变成制度，而不是这次记得、下次膨胀
//   512 字那版就是一路「再补一条规则」堆出来的。上限 200 字 = 当前 148 的 1.35 倍余量。
check('A-⑦ 🔴 正文 ≤ 200 字（防规则一路堆回去 —— 512 字那版就是这么胖起来的）',
  PROMPT.length <= 200, PROMPT.length + ' 字 / 上限 200');

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

check('D-① 去掉「这张表是【___】的」⇒ A-③ 判据必须为 false',
  (function () {
    const broken = PROMPT.replace(/这张表是【[^】]*】的。?/g, '');
    return broken !== PROMPT && !/这张表是【[^】]*】的/.test(broken);
  })());

check('D-② 去掉「删掉合计行」⇒ saysDeleteTotalRow 必须为 false',
  (function () {
    const broken = PROMPT.replace(/删掉合计行/g, '');
    return broken !== PROMPT && saysDeleteTotalRow(broken) === false;
  })());

check('D-③ 列名改一个字（销量→数量）⇒ hasHeaders 必须为 false（证明是逐字比，不是"含几个词"）',
  (function () {
    if (!SVC_HEADERS.length) return false;
    const bad = SVC_HEADERS.slice();
    bad[4] = '数量';
    return bad.join(',') !== SVC_HEADERS.join(',') && hasHeaders(PROMPT, bad) === false;
  })());

check('D-④ 页面列名副本少一列 ⇒ pageHeadersMatch 必须为 false（证明它真在比，不是恒真）',
  (function () {
    if (!PAGE_HEADERS || !SVC_HEADERS.length) return false;
    return pageHeadersMatch(PAGE_HEADERS.slice(0, -1), SVC_HEADERS) === false;
  })());

// D-⑤ 长度上限必须有分辨力：塞回旧版 512 字的内容必须判红
check('D-⑤ 把 512 字旧版塞回去 ⇒ A-⑦ 判据必须为 false（证明上限不是摆设）',
  (function () {
    const fat = PROMPT + '\n' + '规则：' + new Array(60).join('某条冗长规则说明；');
    return fat.length > 200;
  })());

console.log('\n' + (failN ? '❌ ' : '✅ ') + pass + ' 通过 / ' + failN + ' 失败');
process.exit(failN ? 1 : 0);
