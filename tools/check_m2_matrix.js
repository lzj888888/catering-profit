#!/usr/bin/env node
/**
 * M2 矩阵/对比改造守卫（R 批次 · 2026-10-11）
 *   ＋ M2 页面完整性（R297 第四轮「M2 整体功能审计」· 2026-10-15）
 *
 * 背景（第 1~3 节）：M2 G1 场景矩阵（calcSandbox 新增 matrix action）+ G4 免费导出（exportData m2_matrix scope）
 *   是本次改造的核心新增面。两者都不能靠"肉眼"守住（引擎 service.js 不准改、付费墙红线不准绕过），
 *   故用静态契约检查把"该有的分支都在"钉死：
 *   ① calcSandbox 必须有 matrix action，且确实循环调 calcSandbox（引擎零改、批量复用）；
 *   ② exportData 必须有 m2_matrix scope，且对免费导出**显式跳过**付费墙判定（isM2FreeExport）；
 *   ③ matrix 术语块在两份 terms 副本里都存在且关键键齐全（单源双副本一致）。
 *
 * 第 4 节（R297 第四轮新增）：把该轮审计在**页面层**抓到的真 BUG 逐条钉住，防复发：
 *   B1  `list.js` 画布必须**在交互前预热**（原 initCanvas 恒同步返回 null ⇒ 首次点导出必失败）
 *   B2  `compare.js` 必须读 `snapshot.reverse`（原只读顶层 ⇒ 反推方案两个页面两个数）
 *   B3  `index.js` 两条 payload 都必须带 `valid_days`（原主测算漏传 ⇒ 与敏感度/保存不同源）
 *   B4  `compare.js` 结论文案必须走术语单源（原硬编码中文）
 *   B5  对比表的 `wx:key` 不得用可重名的 `name`（须用唯一 id）
 *   B7  矩阵"算不出的档位"必须在表内可见（invalid 有渲染）
 *   B9/B14 页面硬编码中文走 **ratchet**（只许降不许升，且逐项登记）
 *   B10 `onPreset` 不得无条件覆盖用户手填的单桌座位数
 *   B11 【开始测算】按钮不得把事件对象当 isFirst（原致整页重绘）
 *   B12 结果区锚点 `#m2result` 必须**恰好一处**且无条件存在
 *
 * 纯静态（fs + 正则），不 require 任何云 SDK，可在普通 node 下被 verify_all 串联运行。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
let pass = 0;
const ok = () => { pass += 1; };
const fail = (m) => problems.push(m);
const chk = (cond, msg) => { if (cond) ok(); else fail(msg); };

const read = (p) => {
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp)) { fail('缺少文件：' + p); return ''; }
  return fs.readFileSync(fp, 'utf8');
};

// ⚠️ 凡是"**不得出现**某段代码"的判据，一律扫**去注释**源码 ——
//   否则守卫会被自己的注释误伤（R297 第四轮实测：B11/B12 两条判据正是被解释性注释里的
//   引文 `bindtap="onCalc"` / `id="m2result"` 判红）。判据必须与人写的注释解耦。
const CJK = /[\u4e00-\u9fa5]/;
const stripSrc = (src, ext) => {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (ext === '.wxml') s = s.replace(/<!--[\s\S]*?-->/g, '');
  return s;
};
const countCjkStrings = (src, ext) => {
  let n = 0;
  for (const ln of stripSrc(src, ext).split('\n')) {
    const re = /(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g;
    let m;
    while ((m = re.exec(ln)) !== null) if (CJK.test(m[2])) n += 1;
  }
  return n;
};

// ===== 1. calcSandbox matrix action =====
const calcIdx = read('cloudfunctions/calcSandbox/index.js');
chk(/event\.action\s*===\s*['"]matrix['"]/.test(calcIdx), 'calcSandbox 缺少 matrix action 分支');
// 🔴 R297 第二轮：原判据硬钉字面量 `arr.map((c) => calcSandbox`（实现细节）。
//   修「矩阵分支零校验 ⇒ 越界值静默产数」必须在调用引擎**之前**插逐行校验，
//   回调签名必然从 `(c)` 变成 `(c, i)` ⇒ 字面量判据把"修这个 bug"直接判红。
//   ⇒ 改为**判语义**（仍是批量 map 复用引擎，不多不少），并**加严一条**：必须逐行过 validateClean。
const mx = calcIdx.slice(calcIdx.indexOf("action === 'matrix'"));
const mxBody = mx.slice(0, mx.indexOf('const shopId') > 0 ? mx.indexOf('const shopId') : mx.length);
chk(/arr\.map\(/.test(mxBody), 'matrix 未用 arr.map 批量调用（引擎零改、批量复用）');
chk(/calcSandbox\(/.test(mxBody), 'matrix 分支未调用 calcSandbox（引擎零改、批量复用）');
chk(/validateClean\(/.test(mxBody),
  'matrix 分支未做逐行入参校验（R297：零校验 ⇒ 毛利率 150 / 负房租静默产数，方向是保本偏低）');

// ===== 2. exportData m2_matrix 免费分支 =====
const exp = read('cloudfunctions/exportData/index.js');
chk(/scope\s*===\s*'m2_matrix'/.test(exp), 'exportData 缺少 m2_matrix scope');
chk(/isM2FreeExport/.test(exp), 'exportData 缺少 M2 免费导出豁免标记 isM2FreeExport');
chk(/if\s*\(\s*!isM2FreeExport\s*\)\s*\{[\s\S]*hasFeature/.test(exp),
  'exportData 未对 m2_matrix 显式跳过付费墙判定（hasFeature 必须包在 if(!isM2FreeExport) 内）');

// ===== 3. 术语双副本一致 =====
const t1 = read('miniprogram/i18n/terms.js');
const t2 = read('specs/dev-specs/i18n/terms.js');
const needKeys = ['matrix:', 'exportXlsx', 'colBreakMonthly', 'cmpTitle', 'cmpDoCompare', 'toCompare'];
for (const k of needKeys) {
  chk(t1.includes(k), 'miniprogram/i18n/terms.js 缺「' + k + '」');
  chk(t2.includes(k), 'specs/dev-specs/i18n/terms.js 缺「' + k + '」');
}

// ============================================================
// 4. M2 页面完整性（R297 第四轮整体审计）
// ============================================================
const idxJs = read('pages/sandbox/index.js');
const idxWxml = read('pages/sandbox/index.wxml');
const listJs = read('pages/sandbox/list.js');
const listWxml = read('pages/sandbox/list.wxml');
const cmpJs = read('pages/sandbox/compare.js');
const cmpWxml = read('pages/sandbox/compare.wxml');
const mtxJs = read('pages/sandbox/matrix.js');
const mtxWxml = read('pages/sandbox/matrix.wxml');
const mtxWxss = read('pages/sandbox/matrix.wxss');
// 去注释副本（凡"不得出现"类判据一律扫它，见文件上方说明）
const idxWxmlS = stripSrc(idxWxml, '.wxml');
const cmpJsS = stripSrc(cmpJs, '.js');

// --- B1：画布必须交互前就绪 ---
chk(/onReady\s*\(\s*\)\s*\{[^}]*this\.initCanvas\(\)/.test(listJs),
  'list.js 缺 onReady 预热画布（B1：initCanvas 异步、同步恒返回 null ⇒ 首次点【导出图片】必失败）');
chk(/onReady\s*\(\s*\)\s*\{/.test(listJs), 'list.js 缺 onReady 钩子');

// --- B2：compare.js 必须读 reverse 块 ---
chk(/s\.reverse\s*&&\s*s\.reverse\.target_monthly_fen/.test(cmpJs),
  'compare.js 未读 snapshot.reverse.target_monthly_fen（B2：反推方案会显示正向口径的目标月营收，与 list.js 不一致）');

// --- B3：两条 payload 都带 valid_days ---
{
  const n = (idxJs.match(/valid_days:\s*p\.valid_days/g) || []).length;
  chk(n >= 2, 'index.js 只有 ' + n + ' 处 `valid_days: p.valid_days`（B3：主测算 payload 漏传 ⇒ 与敏感度/保存不同源，应为 2 处）');
}

// --- B4：结论文案走术语单源 ---
chk(!/保本月营收最低（/.test(cmpJsS), 'compare.js 仍含硬编码结论文案（B4）');
chk(/cmpVerdictBest/.test(t1) && /cmpVerdictBest/.test(t2),
  'terms 双副本缺 cmpVerdictBest（B4）');
chk(/this\.data\.t\.verdictBest/.test(cmpJs), 'compare.js 未使用术语 verdictBest（B4）');

// --- B5：wx:key 不得用可重名的 name ---
chk(!/wx:key\s*=\s*"name"/.test(cmpWxml), 'compare.wxml 仍用 wx:key="name"（B5：方案名可重名 ⇒ 撞键）');
chk(!/wx:key\s*=\s*"name"/.test(listWxml), 'list.wxml 仍用 wx:key="name"（B5）');
chk(/id:\s*it\.sandbox_id/.test(listJs), 'list.js 的对比列未带唯一 id（B5）');
chk(/id:\s*p\.sandbox_id/.test(cmpJs), 'compare.js 的对比行未带唯一 id（B5）');

// --- B7：矩阵"算不出的档位"表内可见 ---
//   ⚠️ 判据必须钉在**行的 class 绑定**上（而不是"文件里出现过 item.invalid"）——
//      后者会被同一行第二个绑定（首列 ⚠ 标记）满足 ⇒ 变异回灌实测抓不到（弱判据）。
chk(/class="tr [^"]*item\.invalid/.test(mtxWxml), 'matrix.wxml 的行 class 未绑定 item.invalid（B7：被拒档位在表里无从定位）');
chk(/\.tr\.invalid/.test(mtxWxss), 'matrix.wxss 缺 .tr.invalid 样式（B7）');

// --- B10：onPreset 不得无条件覆盖手填的单桌座位数 ---
{
  const guarded = /if\s*\(\s*!this\.data\.fieldTouched\.seatsPerTable\s*\)\s*\{[\s\S]{0,200}?seatsPerTableNum/.test(idxJs);
  chk(guarded, 'index.js onPreset 仍无条件覆盖 seatsPerTableNum（B10：用户手填值被业态切换静默重置）');
  chk(/seatsPerTable:\s*false/.test(idxJs), 'index.js fieldTouched 缺 seatsPerTable 键（B10）');
  chk(/'fieldTouched\.seatsPerTable':\s*true/.test(idxJs), 'index.js onSeatsPerTable 未标记手填（B10）');
}

// --- B11：【开始测算】按钮不得传事件对象当 isFirst ---
chk(!/bindtap\s*=\s*"onCalc"/.test(idxWxmlS),
  'index.wxml 仍 `bindtap="onCalc"`（B11：事件对象恒真 ⇒ 每次点按钮整页重绘、丢滚动位置）');
chk(/bindtap\s*=\s*"onCalcBtn"/.test(idxWxmlS), 'index.wxml 的【开始测算】未改走 onCalcBtn（B11）');
chk(/onCalcBtn\s*\(\s*\)\s*\{\s*return this\.onCalc\(false\)/.test(idxJs), 'index.js 缺 onCalcBtn 包装（B11）');
chk(/isFirst\s*===\s*true/.test(idxJs), 'index.js onCalc 未把 isFirst 收紧为 `=== true`（B11）');

// --- B12：结果区锚点恰好一处 ---
{
  const n = (idxWxmlS.match(/id="m2result"/g) || []).length;
  chk(n === 1, 'index.wxml 里 id="m2result" 出现 ' + n + ' 次（B12：必须恰好 1 次且无条件存在，否则吸底条点击静默失效）');
  chk(/<view id="m2result"><\/view>/.test(idxWxmlS), 'index.wxml 的结果区锚点不是无条件空锚点（B12）');
}

// --- B9/B14：页面硬编码中文 ratchet（只许降不许升） ---
//   基线 = 2026-10-15 审计当时实测值（去注释后的引号内 CJK 串计数）。
//   说明：`index.js::badParamOf` / `matrix.js::badDimOf` 的"人话"是 R297 二/三轮**刻意**加的
//   （云端 fail 的 msg 会被 utils/api.js 覆盖，R271）⇒ 本期**显式豁免**、计入基线而不下沉 terms。
//   wxml 侧同理：`元`/`%`/`天` 等**裸文本节点**不在本判据的引号扫描面内，属已登记豁免。
const CJK_BASELINE = {
  'pages/sandbox/index.js': 11,
  'pages/sandbox/index.wxml': 0,
  'pages/sandbox/matrix.js': 9,
  'pages/sandbox/matrix.wxml': 2,
  'pages/sandbox/compare.js': 1,
  'pages/sandbox/compare.wxml': 0,
  'pages/sandbox/list.js': 0,
  'pages/sandbox/list.wxml': 0,
};
let cjkTotal = 0;
for (const rel of Object.keys(CJK_BASELINE)) {
  const cur = countCjkStrings(read(rel), path.extname(rel));
  cjkTotal += cur;
  chk(cur <= CJK_BASELINE[rel],
    '硬编码中文回升：' + rel + ' 现有 ' + cur + ' 处 > 基线 ' + CJK_BASELINE[rel] + '（B9/B14：新文案请进 terms.js）');
}

// --- R322：矩阵「小白降维」—— 高级维度默认收起 ---
// 为什么守：毛利率是找店人要**问的答案**，不是他能填的输入。默认展开四维度 = 一进来就撞墙。
//   三种静默退化：① advOpen 初值改回 true（又变四维度，零报错）
//                ② 生成循环改回裸 labor/margin（行数被撑 8 倍，表变成噪声）
//                ③ 收起后不写「按毛利率 X% · 人工 N 人测算」（老板以为只按租金算 = 另一种假精确）
{
  const mjs = read('pages/sandbox/matrix.js');
  const mwxml = read('pages/sandbox/matrix.wxml');
  chk(/advOpen:\s*false/.test(mjs),
    'matrix.js 的 advOpen 初值不是 false（R322：高级维度必须默认收起）');
  chk(/for \(const m of marginUse\)/.test(mjs),
    'matrix.js 生成循环未走 marginUse（R322：收起态必须只取第 1 档，否则行数被撑 8 倍）');
  // 🔴 R335（B 方案定稿）：人数档位**必须在** —— 矩阵的价值就是扫「多请一个人会怎样」；
  //   人均由老板自己填（不是系统猜），所以两者并存不冲突。
  //   判据三条腿：data 里有档位定义 + 生成循环真的扫它 + 页面真的渲染它
  //   （只判一条会被"定义了但没扫"或"扫了但没渲染"骗过）
  chk(/labor: DEFAULT_DIMS\.labor/.test(mjs)
    && /for \(const l of laborUse\)/.test(mjs)
    && /dims\.labor/.test(mwxml),
    'matrix 缺人数档位（R335：矩阵的核心是扫档，去掉这一维就只剩单价推演）');
  chk(/onToggleAdv/.test(mwxml) && /advNote/.test(mwxml),
    'matrix.wxml 缺高级维度开关或「按毛利率 X% · 人工 N 人测算」说明（R322：收起不等于不告知）');
}

// --- R325：现金卡（钱够不够开 · 能撑几个月）---
//   这类改动的失效方式**全是静默的**：
//     不重算 ⇒ 老板换了租金档位，卡上还是上一次的数；
//     反推公式写反 ⇒ 月固定支出偏小 ⇒ 能撑月数偏大（**危险方向**，宁可说紧）；
//     未填设备却按完整算 ⇒ 把下限当完整数；
//     没填现金却报「够」⇒ 直接骗人。
{
  // ① 生成结果后必须重算（锚在 onGenerate 函数体内，不用全文匹配 —— 同文件别处也有 buildCash 的定义）
  const genBody = (mtxJs.match(/async onGenerate\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/this\.buildCash\(\)/.test(genBody),
    'matrix.js onGenerate 生成结果后未调用 buildCash（R325：现金卡会一直显示上一次的租金档位）');
  // ② 🔴 R336 改判据语义：每月净流出必须**优先用不含摊销的固定费用**（fixedExAmort）。
  //   原判据钉的是「保本营收 × 毛利率」这个反推公式 —— 而那个反推出来的正是**含摊销**口径，
  //   与「签约到开业要拿」里的装修/设备重复计算（同一笔钱扣两次 ⇒ 能撑月数被低估）。
  //   判据要守的是**语义**（用哪个口径），不是某个字面量：反推只允许作为旧数据兜底，且必须在后面。
  chk(/best\.fixedExAmort/.test(mtxJs)
    && mtxJs.indexOf('best.fixedExAmort') < mtxJs.indexOf('best.breakMonthly * best.marginPct'),
    'matrix.js 每月净流出未优先用「不含摊销」固定费用（R336：装修设备已在现金需求扣过，再用含摊销=双计）');
  // ③ 未填设备/货款必须明说「实际更多」（不许把下限当完整）
  chk(/equipMissing\s*\|\|\s*r\.stockMissing/.test(mtxJs) && /cashIncompleteNote/.test(mtxJs),
    'matrix.js 未填设备/货款时未给「实际要拿的更多」提示（R325：把下限当完整数 = 假精确）');
  // ④ 没填现金不许给结论
  chk(/if\s*\(\s*!r\.budgetFen\s*\)\s*\{[\s\S]{0,120}?cashNeedBudget/.test(mtxJs),
    'matrix.js 未填现金时仍可能给出「够/不够」（R325：没有预算就没有结论）');
  // ⑤ 页面必须 4 个输入 + 真渲染判定句
  chk((mtxWxml.match(/bindinput="onCashInput"/g) || []).length === 4,
    'matrix.wxml 现金卡输入框不是 4 个（R325：租金/现金/设备/首批货款）');
  chk(/cashRes\.levelCls/.test(mtxWxml) && /cashRes\.verdictText/.test(mtxWxml),
    'matrix.wxml 未渲染判定句（R325：算了不给结论等于没做）');
  // ⑥ 反恒真：写反的乘法顺序必须判不通过
  // ⑥ 反恒真：只有反推、没有 fixedExAmort 的样本，必须判不通过（证明 ② 不是恒真）
  const badSample = 'return Math.round(best.breakMonthly * best.marginPct / 100);';
  chk(!(badSample.indexOf('best.fixedExAmort') >= 0
    && badSample.indexOf('best.fixedExAmort') < badSample.indexOf('best.breakMonthly * best.marginPct')),
    'R336-⑥ 判据恒真：只有反推的样本也通过了 ②');

  // ⑦ 🔴「读到了 ≠ 送出去了」：buildCash 里引用的每个 T.xxx，必须在 data.t 映射里**被赋值**。
  //    只判「页面用了哪些文案」不够 —— 映射里漏一个键，拿到的是 undefined，
  //    文案变成空串或 "undefined"，而**运行时零报错**（R298Y 同族病）。
  const cashBody = (mtxJs.match(/\n  buildCash\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  const refs = Array.from(new Set((cashBody.match(/T\.[A-Za-z0-9_]+/g) || []).map((x) => x.slice(2))));
  const missingKeys = refs.filter((k) => !new RegExp('\\n\\s+' + k + ':\\s').test(mtxJs));
  chk(cashBody.length > 0 && refs.length >= 8,
    'R325-⑦ 没能定位 buildCash 或其引用的文案键过少（判据本身失效，别当成通过）');
  chk(missingKeys.length === 0,
    'buildCash 引用了未在 t 映射赋值的文案键：' + missingKeys.join(', ') + '（R325：拿到 undefined 且零报错）');

  // ⑧ 缺设备/货款时必须**先**短路，不给「够/能撑几个月」——顺序写错（放到 safe 之后）等于没做。
  const iIncomplete = mtxJs.indexOf('} else if (incomplete) {');
  const iSafe = mtxJs.indexOf("r.level === 'safe'");
  chk(iIncomplete > 0 && iSafe > iIncomplete,
    'matrix.js 缺项分支不在 safe 之前（R325：会先报「够」，把下限当完整数）');
}

// --- R327：M2 正推表（做到某营业额能赚多少）---
//   失效方式全是静默的：公式写反 ⇒ 赚亏颠倒（最危险）；档位不含 1 ⇒ 没有保本锚点；
//   红警时仍出表 ⇒ 拿不成立的参数算利润；页面渲染了但字段没映射 ⇒ 表格空白。
{
  // ① 公式方向：利润 = 营收 × 边际贡献率 − 固定费用（写反成 fixed − rev*k ⇒ 0.8 档从"亏"变"赚"）
  chk(/Math\.round\(rev\s*\*\s*k\s*-\s*fixed\)/.test(idxJs),
    'index.js 正推公式不是「营收 × 边际贡献率 − 固定费用」（R327：写反 ⇒ 赚亏颠倒）');
  // ② 必须有保本档（mult 含 1），否则四档全是"赚"或全是"亏"，失去锚点
  chk(/const mults = \[0\.8, 1, 1\.2, 1\.5\]/.test(idxJs),
    'index.js 正推档位不是以保本线为基准的 4 档（R327：缺 1 倍档 ⇒ 没有保本锚点）');
  // ③ 红警时必须短路（red_alert 时固定费用/边际贡献率不成立）
  chk(/if \(!r || r\.red_alert\) return null;/.test(idxJs),
    'index.js 正推表未在 red_alert 时短路（R327：会拿不成立的参数算利润）');
  // ④ 页面真渲染（三列：营业额 / 结果 / 正负着色）
  chk(/profitLadder/.test(idxWxmlS) && /item\.gain/.test(idxWxmlS) && /item\.loss/.test(idxWxmlS),
    'index.wxml 未渲染正推表或未区分赚/亏（R327：算了不给颜色等于要老板自己读符号）');
}

// --- R330：促销卡（做活动会怎样）---
//   失效方式全是静默的：选折扣不重算（还显示上一档的数）；结果里没算却渲染了（空白卡）；
//   页面只渲染一部分（老板以为那就是全部）。
{
  chk(/promoRes:\s*this\.promoOf\(presetResultObj\)/.test(idxJs),
    'index.js 结果出来时未算促销（R330：促销卡会一直是空的或显示旧数）');
  chk(/onPromoD[\s\S]{0,220}promoDIdx[\s\S]{0,220}promoOf\(this\.data\.result\)/.test(idxJs)
    && /onPromoW[\s\S]{0,220}promoWIdx[\s\S]{0,220}promoOf\(this\.data\.result\)/.test(idxJs),
    'index.js 切换折扣/参与率后未重算（R330：选 7 折还显示 8 折的数）');
  chk(/promoRes\.gaText/.test(idxWxmlS) && /promoRes\.beText/.test(idxWxmlS) && /promoRes\.trafficText/.test(idxWxmlS),
    'index.wxml 未把三项输出全渲染（R330：漏一项老板会以为是全部）');
  chk(/promoImpact/.test(idxJs),
    'index.js 未走 utils/promoImpact.js（R330：两套折扣公式必然漂移）');
  // --- R351：实收率「填了但越界」不许静默回落到折扣档 ---
  //   失效形态（静默错值）：老板填 150 或 0 ⇒ 旧代码 `if (real>0 && real<=100)` 不成立
  //   ⇒ 悄悄改用折扣档算，页面照常出数 ⇒ 老板以为看的是自己的数。
  const discBody = (idxJs.match(/promoDiscountOf\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/raw === ''/.test(discBody) && /return null;/.test(discBody),
    'promoDiscountOf 未区分「没填」与「填错」（R351：填错时静默回落到折扣档 = 静默错值）');
  chk(/if \(d == null\) return \{ bad: true, text: T\.promoRealBad \};/.test(idxJs),
    'promoOf 未对非法实收率给出明确文案（R351：会显示成折扣档的数或整卡片消失）');
  chk(/promoRealBad: M\.promoRealBad/.test(idxJs),
    '实收率告警文案未映射进 t（R351：会显示 undefined）');
  // --- R353：`T.xxx` 引用集 ⊆ `t` 映射赋值集 ---
  //   失效形态（页面零报错、文案是空串）：R344/R350 的补丁把
  //   `promoDropText / promoBeText / promoTrafficText` 三行映射**覆盖掉了**
  //   ⇒ 活动卡「掉了几个点 / 保本变成多少 / 打平要多来多少人」全渲染成空白。
  //   只判「terms 里有没有这个键」查不出来 —— 键在 terms 里好好的，只是没映射进页面数据。
  {
    const noCmt = idxJs.replace(/^\s*\/\/.*$/gm, '');
    const tBlock = (noCmt.match(/\n    t: \{([\s\S]*?)\n    \},/) || [])[1] || '';
    const mapped = new Set();
    for (const m of tBlock.matchAll(/^\s+([A-Za-z_][\w]*):\s*M\./gm)) mapped.add(m[1]);
    const refs = new Set();
    for (const m of noCmt.matchAll(/\bT\.([A-Za-z_][\w]*)/g)) refs.add(m[1]);
    const missing = [];
    refs.forEach((k) => { if (!mapped.has(k)) missing.push(k); });
    chk(mapped.size > 20, 't 映射解析失败：只解析到 ' + mapped.size + ' 个键（R353 判据前提不成立）');
    chk(missing.length === 0,
      'index.js 引用了 t.xxx 却没映射进 t（R353：文案渲染成空串、页面零报错）：' + missing.join(','));
  }
}

// --- R337（M2-A1）：促销卡 W 口径 —— 文案问「几成客人」，公式算「营业额占比」 ---
//   为什么必须钉：两者在「活动单金额 ≠ 非活动单金额」时**不等价**，而界面上没有任何报错——
//   老板按人头估 3 成、系统按营业额算 3 成，差额全落在毛利率与保本线上（静默错数）。
//   修法是改文案 + 明示近似条件，**公式不动**（公式本身没错，错的是没交代口径）。
(function () {
  const one = read('utils/promoImpact.js');
  // ① 页面问的必须是「订单/单数」口径
  const labelOf = (src) => (/promoWeightLabel:\s*'([^']*)'/.exec(src) || [])[1] || '';
  const L1 = labelOf(t1);
  const L2 = labelOf(t2);
  chk(/订单|单数/.test(L1),
    '促销参与率标签不是「订单/单数」口径（R337：问"几成客人"而公式按营业额占比 ⇒ 老板按人头估，数对不上）');
  chk(L1 !== '' && L1 === L2,
    '促销参与率标签双副本不一致或缺失（R337：miniprogram 与 specs 两份 terms 必须同值）');
  // ② 近似条件必须真的出现在界面上（只改标签不说条件 = 仍是静默近似）
  const note = (/promoApproxNote:\s*'([^']*)'/.exec(t1) || [])[1] || '';
  chk(/单数|订单/.test(note) && /客单价|单价/.test(note),
    'promoApproxNote 未写清「按单数近似 + 客单价前提」（R337：老板仍不知道这是估计）');
  chk(/\{\{t\.promoApproxNote\}\}/.test(idxWxmlS),
    'index.wxml 结果区未渲染 promoApproxNote（R337：算了不说口径 ⇒ 近似被当成精确）');
  // ③ JSDoc 与页面同口径，且写明前提（文档与界面各说一套 = 下一个人必然改错）
  const wi = one.indexOf('@param {number} p.weightPct');
  const wDoc = wi >= 0 ? one.slice(wi, wi + 400) : '';
  chk(/订单/.test(wDoc) && /客单价/.test(wDoc),
    'utils/promoImpact.js 的 weightPct 注释未写「订单占比 + 客单价前提」（R337）');
  // ④ 反恒真：拿**旧文案**喂给同一套判据，必须判不通过（证明 ① 不是恒真）
  chk(!/订单|单数/.test(labelOf("promoWeightLabel: '几成客人会用',")),
    'R337-④ 判据恒真：老文案「几成客人会用」也能通过 ①');
}());

// --- R331：矩阵页「人工总额 / 毛利率跟业态 / 固定费用构成」---
//   三处都是「看起来对、数字错」的静默失效：
//   ① 只传人数 ⇒ 工资永远是参数包估值，老板改不了（他以为在控成本）
//   ② 毛利率档位写死 45% 且切业态不变 ⇒ 与 index 页同店差最多 49%
//   ③ 构成拆项不与引擎对账 ⇒ 拆错也不报错
{
  chk(/laborTotalYuan:\s*ltYuan\s*>\s*0\s*\?\s*ltYuan/.test(mtxJs),
    'matrix.js buildClean 未把人工总额传给装配（R331：老板填了也不生效，仍按人数×均值估）');
  chk(/grossMarginPct[\s\S]{0,120}?dims\.margin\[0\]/.test(mtxJs),
    'matrix.js 切业态时未用业态预设更新毛利率第一档（R331：与 index 页最多差 49%）');
  chk(/!this\.data\.fieldTouched\.margin/.test(mtxJs),
    'matrix.js 切业态时未保护老板手改过的毛利率（R331：会把手填值冲掉）');
  chk(/dim === 'margin'[\s\S]{0,120}?fieldTouched\.margin': true/.test(mtxJs),
    'matrix.js onDimInput 未标记手改毛利率（R331：上面那条保护等于永远成立）');
  chk(/Math\.abs\(sumFen\s*\/\s*100\s*-\s*engineYuan\)\s*>\s*1/.test(mtxJs),
    'matrix.js 固定费用构成未与引擎对账（R331：拆错了也照显示）');
  chk(/fixed-break"[^>]*wx:if="\{\{fixedBreak\}\}"/.test(mtxWxml),
    'matrix.wxml 固定费用构成没有 fail-closed 条件（R331：对不上账时会渲染空卡）');
}

// --- R332：结论筛选必须能从"写死的 pivotFix"退回"结果里实际存在的档位" ---
//   原 bug：pivotFix 写死 margin=55/labor=2，而生成的行是 dims 第一档（茶饮 67%）
//   ⇒ 永远筛不到 ⇒ 任何组合都显示"当前筛选无可行组合"（必现，与有没有可行组合无关）。
chk(/if \(pool\.indexOf\(fixVal\) < 0\) fixVal = pool\[0\]/.test(mtxJs),
  'matrix.js 结论筛选未从 pivotFix 退回实际档位（R332：会必现「当前筛选无可行组合」）');

// --- R336：开店投入拆 4 项 + 转让费默认不摊 + 双保本口径 ---
//   为什么必须钉：这是**口径级**错，且完全静默——
//     · 原来「一个总额 + 一个年限」把 5 年摊的设备压成 3 年摊 ⇒ 月摊销虚高 11~20% ⇒ 保本线连锁虚高；
//     · 转让费（买位置）被当成可摊资产 ⇒ 两口径差额再被拉大。
//   静态腿：结构在不在；行为腿：数字对不对（同一笔钱摊/不摊的差必须精确等于 转让费÷年限÷12）。
(function () {
  // ① buildItems 必须 4 项齐全
  const keys = ['decor', 'equip', 'franchise', 'transfer'];
  const missing = keys.filter((k) => !new RegExp("add\\('" + k + "'").test(mtxJs));
  chk(!missing.length, 'matrix.js buildItems 未拆出全部 4 项投入（R336：缺 ' + missing.join('/') + '）');

  // ② 转让费不摊时必须是字面 0，不能落到 buildYearsOf（那个兜底成 3 年 ⇒ 白勾了）
  chk(/buildTransferAmort\s*\?\s*undefined\s*:\s*0/.test(mtxJs)
    && /forceYears\s*===\s*0/.test(mtxJs),
    'matrix.js 转让费「不摊」未走 years:0（R336：buildYearsOf 会兜底成 3 年，勾选框等于没做）');

  // ③ 现金保本必须由「不含摊销 / 含摊销」比例派生（不能自己编一个固定折扣率）
  // 🔴 R343 改判据语义：不再钉算式字面量，改为「必须调唯一函数 cashBreakeven」——
  //   因为 index 页也要算同一个数，两边各写一套算式必然漂移（漂移的表现是两个页面给出两个保本数）。
  chk(/cashBreakeven\(\s*breakMonthly\s*,\s*res\.fixed_ex_amort_fen\s*,\s*res\.fixed_total_fen\s*\)/.test(mtxJs)
    && !/Math\.round\(\s*breakMonthly\s*\*/.test(mtxJs),
    'matrix.js 现金保本未走 utils/bizPreset.js::cashBreakeven（R343：两页各写一套算式必然漂移）');

  // ④ 页面必须真渲染这一列（算了不显示 = 没做）
  chk(/item\.beCashMonthly/.test(mtxWxml) && /colBreakCash/.test(mtxWxml),
    'matrix.wxml 未渲染「现金保本」列（R336：双保本是老板判断"这店撑不撑得住"的唯一口径）');

  // ④b 🔴 切业态不得清空老板已填的人工（R336 实测 bug：syncBuildDefault 原用字面量整体替换 global，
  //    只带 area/buildTotal/buildYears 三键 ⇒ 人工总额、人均工资被静默清空）。
  //    判据判**语义**（"不许整体替换"），不钉某种合并写法 —— {..spread} 和 Object.assign 都该过。
  const syncBody = (mtxJs.match(/syncBuildDefault\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(syncBody.length > 0 && !/global:\s*\{/.test(syncBody),
    'syncBuildDefault 用字面量整体替换 global（R336：切业态会清空老板填的人工总额/人均工资，且零报错）');

  // ⑤ 行为腿：真跑引擎，对拍同一笔钱摊 / 不摊
  let engine = null;
  try { engine = require('../cloudfunctions/calcSandbox/service.js').calcSandbox; } catch (e) { engine = null; }
  if (!engine) {
    chk(false, '无法加载 calcSandbox/service.js（R336：口径行为腿跑不了，不能算通过）');
    return;
  }
  const base = {
    cityTier: 'tier23', bizType: 'fastfood',
    fixedItems: [{ key: 'rent', fen: 500000 }, { key: 'labor', fen: 900000 }],
    varItems: [], grossMarginPct: 55, targetProfitFen: 2000000, expectedRevenueFen: 0,
  };
  const itemsOff = [
    { key: 'decor', fen: 15000000, years: 3 },
    { key: 'equip', fen: 8000000, years: 5 },
    { key: 'franchise', fen: 5000000, years: 3 },
    { key: 'transfer', fen: 10000000, years: 0 },
  ];
  const itemsOn = itemsOff.map((x) => (x.key === 'transfer' ? Object.assign({}, x, { years: 3 }) : x));
  const off = engine(Object.assign({}, base, { buildItems: itemsOff }));
  const on = engine(Object.assign({}, base, { buildItems: itemsOn }));

  chk(off.build_total_fen === 38000000 && on.build_total_fen === 38000000,
    '转让费不摊时投入总额被漏计（R336：years:0 只该跳过摊销，总额仍要算，否则回本月数错）');
  chk(Math.abs((on.build_amort_monthly_fen - off.build_amort_monthly_fen) - Math.round(10000000 / 36)) <= 100,
    '转让费摊/不摊的月摊销差额 ≠ 转让费÷36（R336：说明 years:0 没有真的跳过摊销）');

  // ⑥ 设备按 3 年摊必须比 5 年高（证明"一个年限"确实会算错，这条是反恒真腿）
  const e3 = engine(Object.assign({}, base, {
    buildItems: itemsOff.map((x) => (x.key === 'equip' ? Object.assign({}, x, { years: 3 }) : x)),
  }));
  chk(e3.build_amort_monthly_fen > off.build_amort_monthly_fen,
    '设备按 3 年摊未高于 5 年摊（R336：反恒真腿失败，说明这条判据抓不到"年限被压短"）');

  // ⑦ 双保本必须现金 < 账面，且差额恰为 摊销÷边际贡献率
  const beCash = Math.round(off.break_even_monthly_fen * off.fixed_ex_amort_fen / off.fixed_total_fen);
  const rate = off.fixed_total_fen / off.break_even_monthly_fen;
  chk(beCash < off.break_even_monthly_fen,
    '现金保本未低于账面保本（R336：去掉摊销只会更低，反了就是公式写错）');
  const gap = off.break_even_monthly_fen - beCash;
  const expect = off.build_amort_monthly_fen / rate;
  chk(Math.abs(gap - expect) / expect < 0.02,
    '两口径差额 ≠ 摊销÷边际贡献率（R336：差额只能来自摊销，差额对上才说明没混入别的成本）');
}());

// --- R338：已有店铺的「安全垫」（M1 有，M2 原先没有）---
//   为什么守：同一个老板在 M1 看到「营收再掉 12.3% 就亏」，在 M2 看不到这一句 ——
//   两个模块像两套软件。三个静默退化点：① 换了分母（除以保本而不是营收）② 目标=保本时显示 0%
//   ③ 另写一句话（文案分叉，以后改口径漏一处）。
{
  chk(/cushion_pct:\s*_cushion/.test(idxJs)
    && /Math\.round\(\(\(_tgFen\s*-\s*_beFen\)\s*\*\s*1000\)\s*\/\s*_tgFen\)\s*\/\s*10/.test(idxJs),
    'index.js 安全垫未按「(目标 − 保本) ÷ 目标」一位小数派生（R338：换分母会把缓冲算大，属危险方向）');

  // 目标利润=0 ⇒ 目标营收 = 保本营收 ⇒ 安全垫恒 0。必须显示「保本线」，不能显示 0%。
  // 判语义（两种等价写法都算过），不钉某个字面量。
  chk(/(Math\.abs\(_cushion\)\s*<[^)]*|_cushion\s*===\s*0)[\s\S]{0,220}cushionBreakEven/.test(idxJs),
    'index.js 安全垫缺「目标=保本 ⇒ 显示保本线」分支（R338：显示 0% 会让老板以为系统坏了）');

  chk(/result\.cushion_text/.test(idxWxmlS),
    'index.wxml 未渲染安全垫（R338：算了不显示等于没做）');

  // 文案必须复用 M1 的 TERMS.card.beMarginDrop，不许在 M2 里另写一句
  chk(/TERMS\.card\.beMarginDrop/.test(idxJs) && /TERMS\.card\.beMargin\b/.test(idxJs),
    'index.js 安全垫文案未复用 M1（R338：两模块各写一句话，改口径必漏一处）');
}

// --- R340：目标利润没填时，目标月营收 = 保本营收（两行同一个数）---
//   老板看到「保本月营收 12.3 万 / 目标月营收 12.3 万」会以为系统算错了。
//   四个静默退化点：① 判据用 target_monthly > 0（恒真，等于没判）② 只藏目标行却仍显示回本
//   ③ 空态不给引导（老板不知道下一步）④ 编一个目标值（比显示同一个数更坏）
{
  // ① 判据字段必须是「目标利润」，不能是「目标月营收」——后者只要固定费用 > 0 就恒真
  const mHas = idxJs.match(/const _hasTarget\s*=\s*([^;]+);/);
  chk(mHas && /targetYuan/.test(mHas[1]) && !/target_monthly/.test(mHas[1]),
    'index.js has_target 判据用错字段（R340：必须看目标利润 targetYuan，不能看 target_monthly —— 后者恒真）');

  // ② 目标两行必须在 has_target 分支内（只藏一行会让老板以为另一半是真实数）
  const iIf = idxWxmlS.indexOf('wx:if="{{result.has_target}}"');
  const iTgt = idxWxmlS.indexOf('resTargetMonthly');
  const iPay = idxWxmlS.indexOf('resPayback');
  chk(iIf >= 0 && iTgt > iIf && iPay > iIf,
    'index.wxml 目标月营收/回本没有一起放进 has_target 分支（R340：只藏一行反而更迷惑）');

  // ③ 空态必须有引导句（不许什么都不显示，也不许编一个目标值）
  chk(/targetEmptyHint/.test(idxWxmlS),
    'index.wxml 目标未填时没有引导句（R340：老板不知道"填个目标就能看到要卖多少"）');

  // ④ 行为腿：证明「目标为空 ⇒ 两数相等」客观存在，不是假想问题
  let engine = null;
  try { engine = require('../cloudfunctions/calcSandbox/service.js').calcSandbox; } catch (e) { engine = null; }
  if (engine) {
    const base = {
      cityTier: 'tier23', bizType: 'fastfood',
      fixedItems: [{ key: 'rent', fen: 500000 }, { key: 'labor', fen: 900000 }],
      varItems: [], grossMarginPct: 55, expectedRevenueFen: 0, buildItems: [],
    };
    const noTarget = engine(Object.assign({}, base, { targetProfitFen: 0 }));
    const hasTarget = engine(Object.assign({}, base, { targetProfitFen: 2000000 }));
    chk(noTarget.target_monthly_fen === noTarget.break_even_monthly_fen,
      'R340-④ 目标为 0 时目标月营收 ≠ 保本营收（引擎口径变了？本判据的前提失效，需重看）');
    chk(hasTarget.target_monthly_fen > hasTarget.break_even_monthly_fen,
      'R340-⑤ 填了目标利润后目标月营收未高于保本（反恒真腿：说明 ④ 不是恒真）');
  }
}

// --- R342：index 页（已有店铺）固定费用拆项 ---
//   老板看到「固定费用合计 4.5 万」却不知道"这 2.16 万人工怎么来的"——尤其是人工被
//   「人数 × 人均」估出来的时候。这是信任问题，不是美观问题。
//   四个静默退化点：① 自己另算一套（两套公式必漂移）② 没有对账（拆错了也照显示）
//   ③ 对账恒失败（拆项永远不显示，等于没做）④ 页面没有 fail-closed 条件
{
  chk(/fixedBreakOf\s*\(/.test(idxJs) && /this\.fixedBreakOf\(p\.fixed_items,\s*d\.fixed_ex_amort_fen\)/.test(idxJs),
    'index.js 固定费用拆项未用「装配出的 p.fixed_items + 引擎 fixed_ex_amort_fen」同源对账（R342）');

  const fbBody = (idxJs.match(/\n  fixedBreakOf\([^)]*\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  // 🔴 R353：判据从「钉字面量 sumFen/100」改为「判单位一致」——
  //   旧实现把引擎的**分**当**元**比，差 100 倍 ⇒ 永远 return null（拆项从未显示过）。
  //   ① 必须有对账且 fail-closed；② 两侧必须同为分（容差 100 分 = 1 元）
  chk(fbBody.length > 0 && /Math\.abs\(sumFen\s*-\s*engFen\)\s*>\s*100/.test(fbBody)
    && /return null/.test(fbBody),
    'index.js 固定费用拆项没有「分对分、差 >100 分就不显示」的对账（R342/R353）');
  chk(!/sumFen\s*\/\s*100\s*-\s*eng/.test(fbBody),
    '固定费用对账又把「元」和「分」混比了（R353 实际事故：差 100 倍 ⇒ 拆项永远不显示）');

  // 判「有元素带 wx:if=\"{{fixedBreak}}\"」——不钉 class 名（本轮第一版钉了 class="fixedBreak"，
  // 而实际元素是 class="card2"，判据当场假红）。
  chk(/<view[^>]*wx:if="\{\{fixedBreak\}\}"/.test(idxWxmlS),
    'index.wxml 固定费用构成没有 fail-closed 条件（R342：对不上账时会渲染空卡）');

  // 行为腿：证明对账口径本身能通过（否则拆项永远不显示，且无人察觉）
  let asmItems = null;
  let engine = null;
  try {
    const bp = require('../utils/bizPreset.js');
    asmItems = bp;
    engine = require('../cloudfunctions/calcSandbox/service.js').calcSandbox;
  } catch (e) { /* 下面统一判红 */ }
  if (asmItems && engine) {
    const pst = asmItems.findPreset('fastfood_noodle');
    const asm = asmItems.assembleItems(pst, {
      area: 60, headcount: 3, rentYuan: 5000, fixedYuan: { rent: 5000 }, buildItems: [],
    }, asmItems.CITY_COEF.tier23);
    const sum = asm.fixedItems.reduce((a, b) => a + (Number(b.fen) || 0), 0);
    const d = engine({
      cityTier: 'tier23', bizType: 'fastfood', fixedItems: asm.fixedItems, varItems: asm.varItems,
      grossMarginPct: 60, targetProfitFen: 0, expectedRevenueFen: 0, buildItems: [],
    });
    chk(Math.abs(sum - d.fixed_ex_amort_fen) <= 100,
      'R342-④ 装配合计与引擎 fixed_ex_amort 对不上（' + (sum / 100) + ' vs ' + (d.fixed_ex_amort_fen / 100)
      + '）⇒ 拆项会永远不显示，需重看口径');
  } else {
    chk(false, '无法加载 bizPreset/calcSandbox（R342：对账行为腿跑不了，不能算通过）');
  }
}

// --- R343：双保本在两个页面必须同源（矩阵 + 已有店铺）---
//   这是本仓反复踩的同族病：同一个数在两处各算一遍 ⇒ 漂移 ⇒ 老板看到两个保本点。
//   判据只认「两边都调 cashBreakeven」，不认各自算式长什么样。
{
  chk(/cashBreakeven\(/.test(idxJs) && /cashBreakeven\(/.test(mtxJs),
    'index.js / matrix.js 没有同时调用 cashBreakeven（R343：双保本必须两页同源）');

  chk(!/Math\.round\(\s*[A-Za-z_.]*break[A-Za-z_]*\s*\*\s*[A-Za-z_.]*fixed_ex_amort/.test(idxJs),
    'index.js 自己又写了一套现金保本算式（R343：必须调 cashBreakeven，不许另起一套）');

  chk(/beCashLabel2/.test(idxWxmlS) && /result\.break_even_cash/.test(idxWxmlS),
    'index.wxml 未渲染现金保本（R343：算了不显示等于没做）');

  // 行为腿：无摊销时必须返回 null（两个数相同，显示两行会让老板以为哪里不一样）
  let bp = null;
  try { bp = require('../utils/bizPreset.js'); } catch (e) { bp = null; }
  if (bp && typeof bp.cashBreakeven === 'function') {
    chk(bp.cashBreakeven(40000, 1400000, 1400000) === null,
      'cashBreakeven 在「无摊销」时未返回 null（R343：两口径相同就不该显示两行）');
    chk(bp.cashBreakeven(42343, 1400000, 2088900) === 28379,
      'cashBreakeven 数额不对（42343 × 140/208.89 应为 28370，实测 '
      + bp.cashBreakeven(42343, 1400000, 2088900) + '）');
  } else {
    chk(false, '无法加载 cashBreakeven（R343：行为腿跑不了，不能算通过）');
  }
}

// --- R344：活动卡接到正推表（同一营业额，做活动前后各赚多少）---
//   「打平要多来 X% 客人」说的是**门槛**，这里说的是**代价** —— 两句互补，缺一个老板都判断不了。
//   三个静默退化点：① 参照营收与正推表不同基准（两张表对不上，老板会以为算错）
//   ② 只算"少赚"不分盈亏（做活动做到亏，却显示成"少赚"）
//   ③ 不写"客流不变"前提（老板会以为活动一定亏，或者反以为一定赚）
{
  chk(/sameRevText\s*:/.test(idxJs) && /promoSameRevWin/.test(idxJs) && /promoSameRevLoss/.test(idxJs),
    'index.js 活动卡没接正推表（R344：缺「同样做到 R 少赚 D」这一句，老板只能自己心算）');

  chk(/out\.beBeforeYuan\s*\*\s*1\.2/.test(idxJs),
    'index.js 参照营收未取「日常保本 × 1.2」（R344：必须与正推表第 3 档同基准，否则两张表对不上）');

  chk(/promoSameRevNote/.test(idxWxmlS),
    'index.wxml 缺少「按客流不变算」的口径注（R344：不写前提，老板会以为活动一定亏/一定赚）');

  // 页面必须真的渲染这一行（算了不显示等于没做）
  chk(/promoRes\.sameRevText/.test(idxWxmlS),
    'index.wxml 未渲染 sameRevText（R344）');

  // 行为腿：用真实引擎口径验证「少赚」= R × (g0 − ga)，且方向恒为正
  let promo = null;
  try { promo = require('../utils/promoImpact.js').promoImpact; } catch (e) { promo = null; }
  if (promo) {
    const o = promo({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 30 });
    if (o && o.ok) {
      const R = Math.round(o.beBeforeYuan * 1.2);
      const no = R * (55 / 100) - 30000;
      const yes = R * (o.gaPct / 100) - 30000;
      chk(Math.abs((no - yes) - R * (55 / 100 - o.gaPct / 100)) <= 2,
        'R344-⑤ 「少赚」不等于 R × (毛利率差)（' + Math.round(no - yes) + ' vs '
        + Math.round(R * (55 / 100 - o.gaPct / 100)) + '）⇒ 口径写错了');
      chk(no > yes, 'R344-⑥ 做活动后的利润未低于不做（反恒真腿：说明 ⑤ 恒成立是假的）');
    } else {
      chk(false, 'R344 promoImpact 基线算例失败（' + (o && o.reason) + '）');
    }
  } else {
    chk(false, '无法加载 promoImpact（R344：行为腿跑不了，不能算通过）');
  }
}

// --- R345：矩阵租金档位必须随城市走 ---
//   原来县城和一线共用 3000~10000：县城老板扫到的全是"不可能租得起"的档，
//   一线老板扫到的全是"根本租不到"的档 —— 两端都失真，而矩阵的价值全在"扫档"。
//   四个静默退化点：① 三套其实一模一样（复制粘贴）② 档位不递增（透视会给出错的"最高可行租金"）
//   ③ 切城市不换档 ④ 换档覆盖老板手改的档（保护是空修复）
{
  const mBlock = mtxJs.match(/const RENT_DIMS\s*=\s*\{([\s\S]*?)\n\};/);
  const dims = {};
  if (mBlock) {
    const re = /(\w+):\s*\[([^\]]+)\]/g;
    let x;
    while ((x = re.exec(mBlock[1]))) {
      dims[x[1]] = x[2].split(',').map((v) => Number(v.trim())).filter((v) => isFinite(v));
    }
  }
  const keys = ['tier1', 'tier23', 'county'];
  chk(keys.every((k) => Array.isArray(dims[k]) && dims[k].length > 0),
    'matrix.js 缺 RENT_DIMS 三套城市租金档位（R345：县城/一线不能共用一套）');

  if (keys.every((k) => dims[k])) {
    const lens = keys.map((k) => dims[k].length);
    chk(lens.every((n) => n === lens[0]),
      'R345-② 三套租金档位数量不一致（' + lens.join('/') + '）⇒ 切城市会改变矩阵行数');

    const mono = keys.filter((k) => {
      const a = dims[k];
      for (let i = 1; i < a.length; i++) if (!(a[i] > a[i - 1])) return true;
      return false;
    });
    chk(mono.length === 0,
      'R345-③ 档位不是严格递增（' + mono.join('/') + '）⇒ 透视的「最高可行租金」会算错');

    // 三套的首档必须不同 —— 否则就是复制粘贴
    chk(new Set(keys.map((k) => dims[k][0])).size === 3,
      'R345-④ 三套档位首档相同（' + keys.map((k) => dims[k][0]).join('/') + '）⇒ 等于没分城市');
  }

  const cityBody = (mtxJs.match(/onCityChange\(e\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/dims\.rent\s*=\s*\(RENT_DIMS\[/.test(cityBody),
    'matrix.js onCityChange 未换租金档位（R345：切城市档位不动 = 没做）');
  chk(/fieldTouched\.rent/.test(cityBody),
    'matrix.js onCityChange 未保护手改档位（R345：会覆盖老板自己敲的租金）');

  const dimBody = (mtxJs.match(/onDimInput\(e\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/fieldTouched\.rent/.test(dimBody),
    'matrix.js onDimInput 未标记 fieldTouched.rent（R345：没有标记 ⇒ 上面的保护是空修复）');
  // --- R351：fieldTouched「读标记必须有对应写标记」 ---
  //   失效形态（保护恒为真）：`onPresetChange` 里写 `!this.data.fieldTouched.unit` 做保护，
  //   但**全文件从未把它置 true** ⇒ 条件永远是 false 的取反 ⇒ 老板手填人均 7000，
  //   一切业态就被预设（5000/5500）静默换掉，页面不提示任何变化。
  //   这类"空修复"只守「有没有保护语句」是查不出来的，必须比对读集与写集。
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const touchReads = (src) => {
    const set = new Set();
    for (const m of stripC(src).matchAll(/fieldTouched\.([A-Za-z_][\w]*)/g)) set.add(m[1]);
    return set;
  };
  const touchWrites = (src) => {
    const set = new Set();
    for (const m of stripC(src).matchAll(/'fieldTouched\.([A-Za-z_][\w]*)'\s*:\s*true/g)) set.add(m[1]);
    // 三种写法都算（R299 教训：只认一种写法 ⇒ 漏抓生产者，判据假绿）：
    //   ① setData 的 'fieldTouched.x': true
    //   ② patch['fieldTouched.x'] = true
    //   ③ fieldTouched.x = true
    for (const m of stripC(src).matchAll(/\[\s*['"]fieldTouched\.([A-Za-z_][\w]*)['"]\s*\]\s*=\s*true/g)) set.add(m[1]);
    for (const m of stripC(src).matchAll(/fieldTouched\.([A-Za-z_][\w]*)\s*=\s*true/g)) set.add(m[1]);
    return set;
  };
  // 白名单必须写清理由：该字段**没有 UI 入口**，读它做保护无害（值只来自预设）。
  // index.js 的 labor：laborUnitYuan 自 R296 起降级为内部兜底、无输入框。
  const NO_UI_FLAGS = { 'index.js': ['labor'], 'matrix.js': [] };
  for (const pair of [['index.js', idxJs], ['matrix.js', mtxJs]]) {
    const name = pair[0];
    const reads = touchReads(pair[1]);
    const writes = touchWrites(pair[1]);
    const allow = NO_UI_FLAGS[name] || [];
    const missing = [];
    reads.forEach((k) => { if (!writes.has(k) && allow.indexOf(k) < 0) missing.push(k); });
    chk(missing.length === 0,
      name + ' 的 fieldTouched 读标记找不到对应写标记（R351：保护恒为真 = 空修复）：' + missing.join(','));
  }
}

// --- R346：矩阵面积随业态（原来固定 60㎡）---
//   60㎡ 开火锅和开面馆都不对：面积直接影响装修估算、坪效分母，也影响老板对"这个铺子够不够"的判断。
//   三个静默退化点：① 五类建议值全一样（等于没分）② 切业态不换 ③ 换的时候覆盖老板手改的值
{
  const mArea = mtxJs.match(/const AREA_DEFAULT\s*=\s*\{([\s\S]*?)\n\};/);
  const area = {};
  if (mArea) {
    const re = /(\w+):\s*(\d+)/g;
    let x;
    while ((x = re.exec(mArea[1]))) area[x[1]] = Number(x[2]);
  }
  const keys = ['fastfood', 'hotpot', 'dining', 'cafe', 'other'];
  chk(keys.every((k) => area[k] > 0),
    'matrix.js 缺 AREA_DEFAULT 业态建议面积（R346）: ' + keys.filter((k) => !(area[k] > 0)).join('/'));

  const vals = keys.map((k) => area[k]).filter((v) => v > 0);
  chk(new Set(vals).size >= 4,
    'R346-② 建议面积区分度不足（' + vals.join('/') + '）⇒ 至少四类要不同，否则等于没分业态');

  const syncBody = (mtxJs.match(/syncBuildDefault\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/g\.area\s*=\s*AREA_DEFAULT\[/.test(syncBody),
    'matrix.js syncBuildDefault 未按业态设面积（R346：切业态后面积还是 60）');
  chk(/fieldTouched\.area/.test(syncBody),
    'matrix.js syncBuildDefault 未保护手改面积（R346：会覆盖老板量过的铺子）');

  const gBody = (mtxJs.match(/onGlobalInput\(e\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/fieldTouched\.area/.test(gBody),
    'matrix.js onGlobalInput 未标记 fieldTouched.area（R346：没有标记 ⇒ 上面的保护是空修复）');

  // 行为腿：所有业态的 bizKey 都必须在表里（否则那个业态会静默回落到 other 的 60㎡）
  let bp = null;
  try { bp = require('../utils/bizPreset.js'); } catch (e) { bp = null; }
  if (bp) {
    const miss = bp.BIZ_PRESETS.filter((x) => !(area[x.bizKey] > 0)).map((x) => x.presetKey);
    chk(miss.length === 0,
      'R346-⑤ 有业态没有建议面积（' + miss.join('/') + '）⇒ 会静默回落到 other 的 60㎡');
  } else {
    chk(false, '无法加载 bizPreset（R346：覆盖性行为腿跑不了，不能算通过）');
  }
}

// --- R347：清理 laborHintOf 的死逻辑 ---
//   背景：R333 为「人工 = 固定额」的业态写了提示（"本业态人工按固定 X 元/月"），
//   但 R335 把火锅的 `fixed 25000` 改成 `labor_total` 后，**13 个业态已全部是 labor_total**
//   ⇒ 那段分支永远走不到。死代码的害处不是占地方，是**后来的人以为它还在生效**。
//   判据守两头：
//   ① 不许再把 laborFixedHint 加回来（真要支持固定额业态，应该重新设计而不是复活死代码）
//   ② 那条**有效**的提示（填了人工总额 ⇒ 人数只影响人效）必须还在 —— 别把孩子和洗澡水一起倒掉
{
  const body = (mtxJs.match(/laborHintOf\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(body.length > 0 && !/laborFixedHint/.test(body),
    'matrix.js laborHintOf 又出现了 laborFixedHint（R347：13 个业态全 labor_total，那段永远走不到）');

  chk(/laborTotalHint/.test(body),
    'matrix.js laborHintOf 丢了「填了人工总额 ⇒ 人数只影响人效」这条有效提示（R347：清理不许误删）');

  chk(!/laborFixedHint/.test(t1) && !/laborFixedHint/.test(t2),
    'terms 里还留着 laborFixedHint 死键（R347：引用方已删，键留着只会误导后来人）');

  chk(!/laborFixedHint/.test(mtxWxml),
    'matrix.wxml 还引用着 laborFixedHint（R347）');
}

// --- R349：导出列必须与页面表头逐列对齐 ---
//   踩到的真漏洞：页面 14 列，导出只有 12 列 —— 少了「人工/月」(R332) 和「现金保本/月」(R336)。
//   老板在页面看到两列，导出 Excel 却没有，且**不报任何错**。
//   这类漏洞每加一列就会复发一次，所以钉「列数相等」而不是钉某两列的名字。
{
  const thBody = (mtxWxml.match(/<view class="tr th">([\s\S]*?)<\/view>/) || [])[1] || '';
  const pageCols = (thBody.match(/t\.\w+/g) || []).length;

  const hm = mtxJs.match(/const header = \[([\s\S]*?)\];/);
  const expCols = hm ? hm[1].split(',').map((x) => x.trim()).filter(Boolean).length : 0;

  chk(pageCols > 0 && expCols > 0,
    'matrix 表头/导出表头解析失败（R349：判据前提不成立，需重看解析锚点）');
  chk(expCols === pageCols,
    '导出列数 ' + expCols + ' ≠ 页面列数 ' + pageCols
    + '（R349：页面加了列但导出没跟 ⇒ 导出件比老板看到的少信息，且不报错）');

  // 新列的数据也必须真的送出去（表头加了、body 没加 = 整列空值）
  chk(/r\.beCashMonthly/.test(mtxJs) && /r\.laborYuan/.test(mtxJs),
    '导出 body 缺「人工/月」或「现金保本/月」的取值（R349：表头有列、数据是空的）');
  // 🔴 R352：页面给「算不出来的档位」标了 ⚠，导出必须同样标。
  //   不标的话，Excel 里那行是「5000 | — | — …」，老板读成"这档不划算"，
  //   实际是"这档没算出来" —— 同一份数据两个含义，属于静默误导。
  chk(/item\.invalid\s*\?\s*'\s*⚠'/.test(mtxWxml)
    && /const body = rows\.map\(\(r\) => \[\s*markInvalid\(r\)/.test(mtxJs),
    '导出的失败行没有 ⚠ 标记（R352：页面有、Excel 没有 ⇒ 老板会把"没算出来"读成"不划算"）');
}

// --- R350：活动形态不止折扣（实收率入口）---
//   满减 / 代金券 / 团购 / 第二份半价 全都能折成"每 100 元实收多少"，而每种都做选择器
//   会让界面翻倍、老板还得学每种的参数。所以只留**一个**实收率入口。
//   四个静默退化点：① 实收率不优先（填了没用）② 不限制范围（填 120 ⇒ 卡片直接消失）
//   ③ 点折扣不清空实收率（两个来源打架，显示与高亮不一致）④ 页面没渲染
{
  const body = (idxJs.match(/promoDiscountOf\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/promoRealPct/.test(body) && /return\s+real\s*\/\s*100/.test(body),
    'index.js 实收率没有优先于折扣档（R350：填了却没生效）');
  chk(/real\s*<=\s*100/.test(body) && /real\s*>\s*0/.test(body),
    'index.js 实收率未限制 1–100（R350：填 120 ⇒ d>1 ⇒ promoImpact 返回 badDiscount ⇒ 整张卡静默消失）');

  const dBody = (idxJs.match(/onPromoD\(e\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  chk(/promoRealPct:\s*''/.test(dBody),
    'index.js 点折扣档时未清空实收率（R350：两个来源打架，chip 高亮与实际算的数不一致）');

  chk(/promoRealPct/.test(idxWxmlS) && /onPromoRealInput/.test(idxWxmlS),
    'index.wxml 未渲染实收率输入（R350：只算了不给入口）');

  // 行为腿：实收率 82 必须落在 8 折与 9 折之间（证明 d 真的被当成实收率用了）
  let promo = null;
  try { promo = require('../utils/promoImpact.js').promoImpact; } catch (e) { promo = null; }
  if (promo) {
    const mk = (d) => promo({ fixedYuan: 30000, marginPct: 55, discount: d, weightPct: 30 });
    const g82 = mk(0.82), g80 = mk(0.8), g90 = mk(0.9);
    chk(g82 && g82.ok && g82.gaPct > g80.gaPct && g82.gaPct < g90.gaPct,
      'R350-⑤ 实收率 82 的毛利率未落在 8 折与 9 折之间（'
      + (g80 && g80.gaPct) + '/' + (g82 && g82.gaPct) + '/' + (g90 && g90.gaPct) + '）');
    const g120 = mk(1.2);
    chk(g120 && g120.ok === false,
      'R350-⑥ 实收率 >100 未被 promoImpact 拒绝（反恒真腿：说明范围校验不能省）');
  } else {
    chk(false, '无法加载 promoImpact（R350：行为腿跑不了，不能算通过）');
  }
}

if (problems.length) {
  console.log('❌ M2 矩阵/对比 + 页面完整性守卫失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('M2 矩阵/对比 + 页面完整性守卫结果：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ M2 矩阵/对比改造守卫通过（matrix action 批量复用引擎 + m2_matrix 免费导出豁免 + 术语双副本一致）');
console.log('✅ M2 页面完整性守卫通过（B1 画布预热 / B2 反推口径 / B3 valid_days 同源 / B4 术语单源 / B5 wx:key /'
  + ' B7 invalid 可见 / B10 手填不覆盖 / B11 按钮不重绘 / B12 锚点唯一 / B9+B14 硬编码中文 ' + cjkTotal + ' 处 ≤ 基线）');
console.log('M2 矩阵/对比 + 页面完整性守卫结果：' + pass + ' 通过 / 0 失败');
