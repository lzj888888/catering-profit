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
}

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
  chk(/beCashMonthly\s*=\s*Math\.round\(breakMonthly\s*\*\s*Number\(res\.fixed_ex_amort_fen\)\s*\/\s*Number\(res\.fixed_total_fen\)\)/.test(mtxJs),
    'matrix.js 现金保本未按「固定不含摊 ÷ 固定含摊」比例派生（R336：自己编系数会与引擎两口径对不上）');

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
