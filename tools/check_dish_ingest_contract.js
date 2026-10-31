#!/usr/bin/env node
// tools/check_dish_ingest_contract.js —— 菜品明细采集契约守卫（R574 · 第 222 套件）
//
// 为什么必须机器守（写在前面，避免将来有人把它当"又一个 grep 套件"删掉）：
//   `external_sales_daily` 这张表只有**一个** `biz_date`，没有字段表达「这一行代表 1 天还是 7 天」。
//   实测（review/evidence/r574_dish_ingest/probe_granularity.js 可复算）：
//     堂食《菜品销售统计》表头写明「营业日期：【2026/09/07 至 2026/09/13】」—— 7 天汇总，
//     入库却把 36 行全写 biz_date=2026-09-13（区间末日）；同一家店同一区间的外卖是逐日 7 行。
//     ⇒ 下游 countDataDays 按 biz_date 去重 ⇒ 这份堂食算 **1 天** ⇒ 该日堂食收入 = 真实日均的 **7 倍**。
//   🔴 全程零报错。这就是本仓最典型的那类病：**能力写文档里、年月日的东西记是记了，
//     但"能采到什么颗粒度"没有一处可查 ⇒ 新写的诊断模块一律默认"一行=一天" ⇒ 静默算错**。
//
// 因此本守卫盯的是「契约 ≡ 实现 ≡ 元数据」三面不漂移：
//   ① **行为面**：真 require `utils/dishIngestContract.js`，喂真 ()
//      platform/shape 看返回值 —— 防「契约写反方向」（把 pos 写成 daily 是最危险的一种，
//      因为它正好迎合了"看起来一行就是一天"的直觉，也让本守卫存在的意义清零）。
//   ② **实现面**：能力表声明 `status:'ready' + hasDishDetail:true` 的 shape，
//      必须能在 `cloudfunctions/importSalesBill/service.js` 找到对应解析函数的**导出**。
//      防「能力表说我很行 ⇒ 上层照着做 ⇒ 实际那条形态根本没人解析」。
//   ③ **元数据面**：`external_sales_daily` schema 的 platform 枚举（utils/gradeGate.js）
//      每个值都必须在能力表里**有归宿**（至少要有确良id 登记那条通道），
//      防「加了新平台却没人知道它是什么粒度 ⇒ 下游默认按日处理 ⇒ 又一轮 7 倍」。
//   ④ **反恒真**：把上面每条腿对应的东西改坏，判据必须转 false。
//
// ⚠️ 本机纪律：不用正则（Git Bash 落盘会把反斜杠改写 ⇒ 语法错），一律 indexOf + 切片。
//
// 运行：node tools/check_dish_ingest_contract.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = path.join(ROOT, 'utils', 'dishIngestContract.js');
const SVC = path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js');
const GRADE = path.join(ROOT, 'utils', 'gradeGate.js');

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}
function readOr(p, dflt) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return dflt; } }

// ⚠️ 首行**不可**写成 `===== x =====` 段标题形态：R66 会把它当一段，而其后紧接的 `--- ① ---`
//    才是第一个真有 ✅ 的段 ⇒ 首段「零断言」⇒ 判红（本套件首跑就红在这里）。
console.log('[R574] 菜品明细采集契约守卫 —— utils/dishIngestContract.js\n');

const C = (() => { try { return require(CONTRACT); } catch (e) { return null; } })();
const svcSrc = readOr(SVC, '');
const gradeSrc = readOr(GRADE, '');

// ---------- ① 行为面 ----------
console.log('--- ① 行为面（真 require，喂真入参看返回值）---');
ok('契约模块可被 require', !!C);
if (C) {
  ok('①-1 堂食 pos/dish_sales 判为 interval（不是 daily）',
    C.inferGranularity('pos', 'dish_sales') === 'interval',
    '实际=' + C.inferGranularity('pos', 'dish_sales'));

  ok('①-2 外卖 waimai_goods 判为 daily',
    C.inferGranularity('', 'waimai_goods') === 'daily',
    '实际=' + C.inferGranularity('', 'waimai_goods'));

  ok('①-3 京东订单导出 jd_order_export 判为 daily',
    C.inferGranularity('jd_order', 'jd_order_export') === 'daily',
    '实际=' + C.inferGranularity('jd_order', 'jd_order_export'));

  ok('①-4 🔴 fail-closed：未登记组合判 unknown，**绝不猜 daily**',
    C.inferGranularity('some_unknown_platform', 'no_such_shape') === 'unknown',
    '实际=' + C.inferGranularity('some_unknown_platform', 'no_such_shape'));

  ok('①-5 🔴 京东 SKU 对账单不得被当成菜品明细（应有/保持 unknown 或 channel 标 blocked）', (() => {
    const ch = C.DISH_CHANNELS.filter((x) => x.platform === 'jd_sku');
    return ch.length > 0 && ch.every((x) => x.hasDishDetail === false);
  })());

  const rowIn = { platform: 'pos', shape: 'dish_sales', biz_date: '2026-09-13', qty: 2540.5, amount: 2259140, period_from: '2026-09-07', period_to: '2026-09-13' };
  const rowDaily = { platform: 'taobao', shape: 'waimai_goods', biz_date: '2026-09-13', qty: 3, amount: 4500 };

  const cmp = C.assertComparable(rowIn, rowDaily);
  ok('①-6 区间 vs 逐日 ⇒ 判定不可比（今日无此闸门，直接就比了）', cmp.comparable === false, JSON.stringify(cmp));

  const cmpSame = C.assertComparable(rowDaily, Object.assign({}, rowDaily, { platform: 'eleme' }));
  ok('①-7 同为 daily 同口径 ⇒ 判定可比（不能一刀切拒）', cmpSame.comparable === true, JSON.stringify(cmpSame));

  ok('①-8 口径不同（LIST_PRICE vs ACTUAL_INCOME）⇒ 不可比', (() => {
    const posRow = { platform: 'pos', shape: 'dish_sales', period_from: '2026-09-07', period_to: '2026-09-13', qty: 1, amount: 100 };
    const twRow = { platform: 'taobao', shape: 'waimai_goods', qty: 1, amount: 100 };
    // 两边粒度不同会先被粒度腿拦；这里单独构造同源 daily、不同 caliber 的组合
    const a = { platform: 'jd_order', shape: 'jd_order_export', qty: 1, amount: 100 };
    const b = { platform: 'pos', shape: 'dish_sales', granularity: 'daily', qty: 1, amount: 100 };
    const r = C.assertComparable(a, b);
    return r.comparable === false && r.reason.indexOf('口径') >= 0;
  })(), '应命中「金额口径不一致」而非被别的腿拦');

  ok('①-9 跨度未知 ⇒ toDailyAverage 返回 ok=false 且值为 null（绝不摊出假日均）', (() => {
    const r = C.toDailyAverage({ platform: 'pos', shape: 'dish_sales', qty: 100, amount: 10000 });
    return r.ok === false && r.qty === null && r.amount === null;
  })());

  ok('①-10 区间七天真能摊出日均（qty/7 且 amount/7）', (() => {
    const r = C.toDailyAverage(rowIn);
    return r.ok === true && Math.abs(r.qty - 2540.5 / 7) < 1 && Math.abs(r.amount - Math.round(2259140 / 7)) <= 1;
  })(), JSON.stringify(C.toDailyAverage(rowIn)));

  ok('①-11 hasDishDetailSource：堂食/外卖有、团购**尚无**（防有人按团购做菜单诊断）',
    C.hasDishDetailSource('dine_in') === true
    && C.hasDishDetailSource('takeaway') === true
    && C.hasDishDetailSource('groupon') === false);

  ok('①-12 日期工具：7 天区间算 7 天（含首尾）', C.dayDiffInclusive('2026-09-07', '2026-09-13') === 7);
  ok('①-13 日期工具：对非法日期返回 null 而非 NaN 传播', C.dayDiffInclusive('2026/09/07', '2026-09-13') === null);
}

// ---------- ② 实现面：契约 ≡ 解析实现 ----------
console.log('\n--- ② 实现面（声明「已有明细」的 shape ⇒ 必须真有解析函数导出）---');
const SHAPE_TO_EXPORT = {
  dish_sales: 'parseDishSales',
  waimai_goods: 'parseDishSalesC',
  jd_order_export: 'parseDishSalesD',
};
if (C && svcSrc) {
  const need = C.DISH_CHANNELS.filter((x) => x.status === 'ready' && x.hasDishDetail && x.shape);
  ok('②-0 存在待校验的 ready+明细 通道', need.length > 0, 'count=' + need.length);
  for (const ch of need) {
    const exp = SHAPE_TO_EXPORT[ch.shape];
    if (!exp) { ok('②-？ 未登记该 shape 的解析函数名映射', false, ch.shape); continue; }
    ok('②-' + ch.shape + ' ⇒ ' + exp + ' 在 service.js 真导出',
      svcSrc.indexOf('  ' + exp + ',') >= 0 || svcSrc.indexOf(exp + ',') >= 0 || svcSrc.indexOf('\t' + exp + ',') >= 0,
      '未找到 exports.' + exp);
  }
  ok('②-反 combo_detail 未被误标为可入库明细（它应当 hasDishDetail=false）', (() => {
    return C.DISH_CHANNELS.filter((x) => x.shape === 'combo_detail').every((x) => x.hasDishDetail === false);
  })());
}

// ---------- ③ 元数据面：platform 枚举 ⇒ 能力表有归宿 ----------
console.log('\n--- ③ 元数据面（schema 的 platform 枚举必须在能力表有归宿）---');
if (C && gradeSrc) {
  // 从 gradeGate 里切出 enum: ['taobao', 'meituan', ...]
  const at = gradeSrc.indexOf("platform: { type: 'string', required: true, enum: [");
  ok('③-0 找到 gradeGate 的 platform enum 定义', at >= 0);
  const seg = at >= 0 ? gradeSrc.slice(at, at + 400) : '';
  const bStart = seg.indexOf('[');
  const bEnd = seg.indexOf(']', bStart);
  const listStr = bStart >= 0 && bEnd > bStart ? seg.slice(bStart + 1, bEnd) : '';
  const enums = listStr.split(',').map((s) => s.trim().replace(/'/g, '').replace(/"/g, '')).filter(Boolean);
  ok('③-1 platform 枚举非空', enums.length > 0, enums.join('/'));
  const known = {};
  for (const ch of C.DISH_CHANNELS) { for (const p of C.platformsOf(ch)) known[p] = true; }
  for (const e of enums) {
    // 允许 ''（动态平台，如形态 C 的 taobao/meituan/eleme 由 dish_channels 里的空 platform 项承载）
    ok('③-2 枚举值 ' + e + ' 在能力表有归宿', known[e] === true || e === 'other', '该 platform 尚无通道登记 ⇒ 下游会按未知粒度处理');
  }
}

// ---------- ④ 反恒真 ----------
console.log('\n--- ④ 反恒真（把关键实现改坏，判据必须转 false）---');
if (C) {
  const backupC = readOr(CONTRACT, '');
  // 变异 A：把能力表里 pos 的 grain 改成 daily ⇒ ①-1 必须转红
  const mutA = backupC.replace("grain: GRANULARITY.INTERVAL,", "grain: GRANULARITY.DAILY,");
  ok('④-A 变异：pos 粒度改成 daily ⇒源文件确实被改动', mutA !== backupC);
  fs.writeFileSync(CONTRACT, mutA, 'utf8');
  let redA = false;
  try {
    delete require.cache[require.resolve(CONTRACT)];
    const C2 = require(CONTRACT);
    redA = C2.inferGranularity('pos', 'dish_sales') !== 'interval';
  } catch (e) { redA = true; }
  fs.writeFileSync(CONTRACT, backupC, 'utf8');
  delete require.cache[require.resolve(CONTRACT)];
  ok('④-A 变异后判据①-1 转红', redA);

  // 变异 B：给 assertComparable 注入**早返回**（一律可比）⇒ ①-6 必须失去拦截能力。
  //   🔴 为什么必须做这条：如果本文件把判定写死成「永远 comparable=false」，编译和①-6 都会全绿，
  //      但那是个假的守卫（拒绝一切 = 等于没守卫）。真注入早返回后**拦截能力必须消失**，
  //      才反证①-6 走的是真实旁路逻辑而不是巧合。
  const mutRowA = { platform: 'pos', shape: 'dish_sales', biz_date: '2026-09-13', qty: 2540.5, amount: 2259140, period_from: '2026-09-07', period_to: '2026-09-13' };
  const mutRowB = { platform: 'taobao', shape: 'waimai_goods', biz_date: '2026-09-13', qty: 3, amount: 4500 };
  const ANCHOR = 'function assertComparable(rowA, rowB) {';
  const atB = backupC.indexOf(ANCHOR);
  ok('④-B 找到注入锚点', atB >= 0);
  ok('④-B 注入前：正常态确为不可比（否则就没得变）', C.assertComparable(mutRowA, mutRowB).comparable === false);
  let redB = null;
  if (atB >= 0) {
    // 只插一行早返回（其余代码原封不动 ⇒ 语法结构与正常态一致，排除「改坏了所以报错」的假红）
    const injected = backupC.slice(0, atB + ANCHOR.length)
      + '\n  return { comparable: true, reason: "", fix: "" };   // BUG 注入：变异测试用早返回'
      + backupC.slice(atB + ANCHOR.length);
    ok('④-B 注入前后内容确有差异', injected !== backupC && injected.length > backupC.length);
    fs.writeFileSync(CONTRACT, injected, 'utf8');
    delete require.cache[require.resolve(CONTRACT)];
    try {
      const C3 = require(CONTRACT);
      redB = C3.assertComparable(mutRowA, mutRowB).comparable;
    } catch (e) { redB = 'ERR:' + String(e.message).split('\n')[0]; }
    fs.writeFileSync(CONTRACT, backupC, 'utf8');
    delete require.cache[require.resolve(CONTRACT)];
  }
  // 正常态应 false；注入后必须变成 true ⇒ 证明①-6 的 false 是算出来的，不是写死的
  ok('④-B 注入早返回后①-6转为「可比」⇒ 该腿非恒真', redB === true, '变异后 comparable=' + redB);
  ok('④-B 还原后①-6恢复不可比', C.assertComparable(mutRowA, mutRowB).comparable === false);

  // 变异 C：删掉 groupon 的 absent 登记 ⇒ ①-11「团购无明细」应失效（防别人豪 Stan 把团购当已支持）
  const mutC = backupC.replace("status: 'absent',", "status: 'ready',");
  ok('④-C 变异：团购通道改 ready ⇒源文件确实被改动', mutC !== backupC);
  fs.writeFileSync(CONTRACT, mutC, 'utf8');
  delete require.cache[require.resolve(CONTRACT)];
  let matches = 0;
  try {
    const C4 = require(CONTRACT);
    matches = C4.listChannels({ channel: 'groupon', status: 'ready' }).length;
  } catch (e) { matches = -1; }
  fs.writeFileSync(CONTRACT, backupC, 'utf8');
  delete require.cache[require.resolve(CONTRACT)];
  ok('④-C 团购 ready 通道数被改动 ⇒ 判据可感知', matches !== 0, 'matches=' + matches);
  ok('④-还原 契约文件与原始逐字一致', readOr(CONTRACT, '') === backupC);
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
if (problems.length) { for (const p of problems) console.log('  ❌ ' + p); process.exit(1); }
process.exit(0);
