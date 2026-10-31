#!/usr/bin/env node
// tools/check_dsi1_parse.js —— DSI-1 标准导入格式解析守卫（R583）
//
// 为什么需要它：
//   `specs/dev-specs/core/店算标准导入格式_v1.md` 是对**外**承诺的契约（给 AI 看的）。
//   契约一旦发布，改列名或改口径会让所有依赖它的 AI 产出**静默失配** —— 不报错、只是数不对。
//   所以解析器必须有行为判据，且判据要能区分：
//     ① 格式对 → 认得出；② 格式不对 → 拒得掉，且**说人话 + 带行号**；
//     ③ 两个从评审里学来的硬规则（销量允许小数 / 退款允许负数）**不能被"优化"掉**。
//
// 判据（A 识别 / B 正向 / C 边界 / D 拒收 / E 反恒真）
//
// 运行：node tools/check_dsi1_parse.js

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

let D = null;
try { D = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js')); } catch (e) { D = null; }
// R585：链路对拍要用 service（detectDishShape / saleDocId）。它 require 了 xlsx，
//   而本机没装这个包 ⇒ 用**空桩**顶住（本文件只调判定与 _id 生成，不碰真实表格解析）。
let S = null;
try {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (req) {
    if (req === 'xlsx') return {};
    return origLoad.apply(this, arguments);
  };
  try { S = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js')); }
  finally { Module._load = origLoad; }
} catch (e) { S = null; }

console.log('[R583] DSI-1 标准导入格式解析守卫\n');

sec('A · 识别（精确 7 列，与现有形态 A/B/C 列名天然不重叠）');
check('A-⓪ 模块可加载且导出 parse / isDSI1 / normDate',
  !!D && typeof D.parse === 'function' && typeof D.isDSI1 === 'function' && typeof D.normDate === 'function');
if (!D) {
  console.log(`\n===== DSI-1 解析守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  process.exit(1);
}

const H = ['日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注'];
check('A-① 标准表头认得出', D.isDSI1(H) === true);
check('A-② 列名不同 ⇒ 认不出（不许模糊匹配）',
  D.isDSI1(['日期', '渠道', '菜品名称', '销量', '销售额']) === false);
check('A-③ 顺序不同 ⇒ 认不出（顺序是契约的一部分）',
  D.isDSI1(['渠道', '日期', '平台', '商品名称', '销量', '销售额', '备注']) === false);
check('A-④ 尾部多余空列可容忍（Excel 常见）',
  D.isDSI1(H.concat(['', ''])) === true);

sec('B · 正向解析（契约里的样例）');
const GOOD = [
  H,
  ['2026-09-07', '堂食', '', '重庆小面', 12, 216.00, ''],
  ['2026-09-07', '堂食', '', '卤牛肉', 1.5, 135.00, '称重'],
  ['2026-09-07', '外卖', '美团', '重庆小面', 5, 95.00, ''],
  ['2026-09-08', '堂食', '', '重庆小面', -2, -36.00, '退单'],
];
const r = D.parse(GOOD);
check('B-① 解析成功且行数 4', r.ok && r.summary.rowCount === 4, r.ok ? String(r.summary.rowCount) : r.error);
check('B-② 天数 2（09-07 / 09-08）且区间正确',
  r.ok && r.summary.dayCount === 2 && r.summary.dayFrom === '2026-09-07' && r.summary.dayTo === '2026-09-08');
check('B-③ 菜品去重数 2（重庆小面/卤牛肉，名字归一后）', r.ok && r.summary.dishCount === 2);
check('B-④ 金额：21600+13500+9500−3600 = 41000 分', r.ok && r.summary.totalAmountFen === 41000,
  r.ok ? String(r.summary.totalAmountFen) : '');
check('B-⑤ 渠道分组：堂食 3 行 / 外卖:meituan 1 行（platform 由渠道+平台列推出）',
  r.ok && r.summary.byChannel['堂食'] && r.summary.byChannel['堂食'].rows === 3
  && r.summary.byChannel['外卖:meituan'] && r.summary.byChannel['外卖:meituan'].rows === 1);
check('B-⑥ 堂食行 platform = pos（复用现有枚举，不新造值）',
  r.ok && r.rows[0].platform === 'pos');

sec('C · 两条从评审学来的硬规则（不能被"优化"掉）');
check('C-① 🔴 小数销量保留原始值 + 单列进报告（1.5 → 2，且 nonInt 有记录）',
  r.ok && r.rows[1].rawQty === 1.5 && r.rows[1].qty === 2
  && r.summary.nonInt.length === 1 && r.summary.nonInt[0].raw === 1.5,
  r.ok ? JSON.stringify(r.summary.nonInt) : '');
check('C-② 🔴 退款行（负数）不剔除、单独记账（−2 / −3600）',
  r.ok && r.summary.refunds.length === 1
  && r.summary.refunds[0].qty === -2 && r.summary.refunds[0].amountFen === -3600);
check('C-③ 尾部全空行跳过、不计入行数', (function () {
  const x = D.parse([H, ['2026-09-07', '堂食', '', '面', 1, 10, ''], ['', '', '', '', '', '', '']]);
  return x.ok && x.summary.rowCount === 1 && x.summary.skipped === 1;
})());
check('C-④ 契约声明的口径差：summary 带 noteNoPackFee（S1 不含打包费，与 S2 不可直接对账）',
  r.ok && r.summary.noteNoPackFee === true);

sec('D · 拒收：说人话 + 带行号');
const bad = [
  ['表头不对', [['日期', '渠道', '菜名']], '标准格式'],
  ['渠道写「自提」', [H, ['2026-09-07', '自提', '', '面', 1, 10, '']], '堂食'],
  ['日期写「9月7日」', [H, ['9月7日', '堂食', '', '面', 1, 10, '']], '日期'],
  ['销量写「约十份」', [H, ['2026-09-07', '堂食', '', '面', '约十份', 10, '']], '数字'],
  ['只有表头没有数据', [H], '没有数据'],
];
for (const [label, rows, kw] of bad) {
  const x = D.parse(rows);
  check(`D · ${label} ⇒ 拒收且说人话`, x.ok === false && String(x.error).indexOf(kw) >= 0,
    x.ok ? '竟然通过了' : String(x.error).slice(0, 46));
}
check('D-⑥ 错误信息带行号（老板能定位到第几行）',
  (function () {
    const x = D.parse([H, ['2026-09-07', '堂食', '', '面', 1, 10, ''], ['2026-09-08', '自提', '', '面', 1, 10, '']]);
    return x.ok === false && /第 3 行/.test(x.error);
  })());

sec('D2 · 多平台分组（落库 _id 的两个维度，最易错的一步）');
const MIX = [
  H,
  ['2026-09-07', '堂食', '', '重庆小面', 12, 216, ''],
  ['2026-09-07', '外卖', '美团', '重庆小面', 5, 95, ''],
  ['2026-09-07', '外卖', '淘宝闪购', '重庆小面', 3, 57, ''],
  ['2026-09-08', '堂食', '', '重庆小面', 10, 180, ''],
  ['2026-09-08', '外卖', '美团', '重庆小面', 2, 38, ''],
];
const pm = D.parse(MIX);
check('D2-⓪ 分组函数已导出（取不到 ⇒ 后面全假绿）', !!D && typeof D.groupByPlatformDate === 'function');
if (D && typeof D.groupByPlatformDate === 'function') {
  const gs = D.groupByPlatformDate(pm.rows);
  check('D2-① 🔴 同一天三个平台 ⇒ **3 组**（不是 1 组）',
    gs.filter((g) => g.bizDate === '2026-09-07').length === 3,
    '实得 ' + gs.filter((g) => g.bizDate === '2026-09-07').length);
  check('D2-② 两天两平台 ⇒ 共 5 组（3 + 2）', gs.length === 5, String(gs.length));
  check('D2-③ 每组都同时带 platform 与 bizDate（_id 的两个维度缺一即覆盖）',
    gs.every((g) => g.platform && g.bizDate));
  check('D2-④ 组内行数守恒（5 行分完还是 5 行）',
    gs.reduce((a, g) => a + g.rows.length, 0) === pm.rows.length);
  // 反证：按日期单维分组只有 2 组 ⇒ 平台维度会被压平（这就是"互相覆盖"的形态）
  const byDateOnly = new Set(pm.rows.map((x) => x.bizDate)).size;
  check('D2-⑤ 🔴 反证：按日期单维只有 2 组 ⇒ 平台维度被压平（证明分组不能省 platform）',
    byDateOnly === 2 && gs.length !== byDateOnly, '单维 ' + byDateOnly + ' vs 双维 ' + gs.length);
}

sec('D3 · 链路对拍（检测 → 解析 → 分组 → _id）：这一步才是"真能导进去"');
{
  const H3 = ['日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注'];
  const MIX3 = [
    H3,
    ['2026-09-07', '堂食', '', '重庆小面', 12, 216, ''],
    ['2026-09-07', '外卖', '美团', '重庆小面', 5, 95, ''],
    ['2026-09-07', '外卖', '淘宝闪购', '重庆小面', 3, 57, ''],
    ['2026-09-08', '堂食', '', '重庆小面', 10, 180, ''],
  ];
  check('D3-⓪ service 已加载（取不到 ⇒ 下面全 fail-closed，不假绿）', !!S);
  const shape = S ? S.detectDishShape(MIX3) : '';
  check('D3-① detectDishShape 把这 7 列认成 S（不是 C：C 没有渠道列）',
    shape === 'dsi1_standard', String(shape));

  const pr = D.parse(MIX3);
  const gs = D.groupByPlatformDate(pr.rows);
  const ids = [];
  for (const g of gs) {
    for (let seq = 0; seq < g.rows.length; seq++) ids.push(S.saleDocId('shop1', g.platform, g.bizDate, seq));
  }
  check('D3-② 生成的 _id **两两不重复**（重复 = 后写的把先写的覆盖掉，且不报错）',
    new Set(ids).size === ids.length, ids.length + ' 个 / 去重后 ' + new Set(ids).size);
  check('D3-③ 同一天三个平台的 _id 互不冲突（platform 进了 _id）',
    new Set(gs.filter((g) => g.bizDate === '2026-09-07')
      .map((g) => S.saleDocId('shop1', g.platform, g.bizDate, 0))).size === 3);
  // 幂等：同一份表再跑一遍，_id 集合必须逐字相同（重导是覆盖不是翻倍）
  const pr2 = D.parse(MIX3);
  const gs2 = D.groupByPlatformDate(pr2.rows);
  const ids2 = [];
  for (const g of gs2) {
    for (let seq = 0; seq < g.rows.length; seq++) ids2.push(S.saleDocId('shop1', g.platform, g.bizDate, seq));
  }
  check('D3-④ 同一份表重导 ⇒ _id 集合逐字相同（覆盖而非翻倍）',
    ids.join(',') === ids2.join(','));
  // 反证：把两行挪到别的日期 ⇒ _id 必须变（否则"改了日期还是覆盖旧数据"）
  const SHIFT = JSON.parse(JSON.stringify(MIX3));
  SHIFT[1][0] = '2026-09-09';
  const pr3 = D.parse(SHIFT);
  const g3 = D.groupByPlatformDate(pr3.rows)[0];
  check('D3-⑤ 日期变了 ⇒ _id 必须变（否则改日期会覆盖旧数据）',
    S.saleDocId('shop1', g3.platform, g3.bizDate, 0) !== S.saleDocId('shop1', 'pos', '2026-09-07', 0));
}

sec('D4 · 仓库里的样例 xlsx 必须真能被吃下（不是"看起来像"）');
{
  // 样例行的 JSON 由 review/evidence/r585_dsi_e2e/verify_examples.py 用 openpyxl 读回生成。
  // 🔴 为什么不直接读 .xlsx：门禁是 node、本机没装 xlsx 包；而这里要验的是
  //   "Excel 落盘后再读回来，值还是不是我们认的样子"（日期变 datetime、1.5 变字符串都会翻车）。
  //   所以链路是：python 读 xlsx → JSON → 本文件喂 parse。xlsx 若被人改坏，JSON 不刷新就抓不到
  //   ⇒ 判据里额外比对 xlsx 的字节数，提醒"改了表要重跑生成脚本"。
  let EX = null;
  try { EX = require(path.join(ROOT, 'review/evidence/r585_dsi_e2e/examples_rows.json')); } catch (e) { EX = null; }
  check('D4-⓪ 样例行 JSON 在场（缺 ⇒ 下面 fail-closed）', !!(EX && EX.s1 && EX.s2));
  if (EX && EX.s1) {
    check('D4-① 样例 S1 表头逐字合规', JSON.stringify(EX.s1[0]) === JSON.stringify(H));
    const r = D.parse(EX.s1);
    check('D4-② 样例 S1 解析通过', !!(r && r.ok), (r && r.error) || '');
    if (r && r.ok) {
      const s2 = r.summary;
      check('D4-③ 样例 S1 数字对得上（堂食 711 / 美团 184 含退款 / 淘宝 57 / 合计 952 元）',
        s2.byChannel['堂食'].amountFen === 71100
        && s2.byChannel['外卖:meituan'].amountFen === 18400
        && s2.byChannel['外卖:taobao'].amountFen === 5700
        && s2.totalAmountFen === 95200,
        JSON.stringify(Object.keys(s2.byChannel).map((k) => k + '=' + s2.byChannel[k].amountFen)));
      check('D4-④ 样例里的称重行(1.5)与退款行(-1)都进了各自的单列',
        s2.nonInt.length === 1 && s2.refunds.length === 1,
        'nonInt ' + s2.nonInt.length + ' / refunds ' + s2.refunds.length);
    }
  }
}

sec('D5 · S2（月渠道汇总）：认得出来、但明确不受理');
{
  // 为什么要这一段：契约里写了 S2，但它的落库目标是**月度账**（ledger），
  //   与 S1 的 external_sales_daily 是两条链路 —— v1 不做。
  //   可「不做」不等于「可以说成未识别」：老板手里的表是对的，只是选错了类型。
  //   回一句更准的理由，他会换一张表；回「未识别」，他会以为文件坏了然后放弃。
  const S2H = ['月份', '渠道', '平台', '营业额', '到手额', '订单数'];
  check('D5-① isDSI1S2 认得 S2 表头', D.isDSI1S2(S2H) === true);
  check('D5-② 🔴 isDSI1 **不认** S2（两个判据不许互相吞）', D.isDSI1(S2H) === false);
  check('D5-③ 🔴 isDSI1S2 **不认** S1（反向也不许吞）', D.isDSI1S2(H) === false);
  check('D5-④ detectDishShape 把 S2 认成 dsi1_summary（不是 null）',
    S && S.detectDishShape([S2H, ['2026-09', '堂食', '', '48600', '48600', '1620']]) === 'dsi1_summary',
    S ? String(S.detectDishShape([S2H, ['2026-09', '堂食', '', '48600', '48600', '1620']])) : 'service 未加载');
  // 静态：分发处必须给出**具体理由**，不能只 fail 一句笼统话
  const idxSrc2 = (function () {
    try { return require('fs').readFileSync(path.join(ROOT, 'cloudfunctions/importSalesBill/index.js'), 'utf8'); }
    catch (e) { return ''; }
  })();
  check('D5-⑤ 🔴 分发处有 S2 分支，且理由里点明「月渠道汇总」+「商品明细」（否则老板不知道换哪张）',
    idxSrc2.indexOf('DISH_SHAPES.S2') >= 0
    && idxSrc2.indexOf('月渠道汇总') >= 0
    && /商品明细/.test(idxSrc2));
}

sec('E · 反恒真');
check('E-① 空输入必须拒（防"恒返回成功"）', D.parse([]).ok === false);
check('E-② 把小数规则改回取整吞掉 ⇒ C-① 的判据会失效（证明它盯着 rawQty 而非 qty）',
  r.ok && r.rows[1].qty === 2 && r.rows[1].rawQty === 1.5);

console.log(`\n===== DSI-1 解析守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
