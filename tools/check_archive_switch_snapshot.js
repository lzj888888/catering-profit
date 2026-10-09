// tools/check_archive_switch_snapshot.js —— 【R257】归档月回读必须用「落库时的开关快照」守卫
// 运行：node tools/check_archive_switch_snapshot.js
//
// 为什么需要它（缺口由「写路径 × 归档锁」穷尽对照**扫出来**，不是记忆、不是推断）：
//   `getLedger/index.js` 自述「防篡改：不信任落库存量，**回读时用明细重算**」
//   ⇒ 归档月的展示值 = 每次读都现算 ⇒ **凡参与计算的入参，改一个就漂一个**。
//   逐个核对该次重算的入参：明细（income_items / expense_items / direct_consume_fen /
//   inventory / amortize_fen / lump_sum_fen）全冻结在 acct 里不会漂；
//   **唯独 amortizeSwitchOn / inventorySwitchOn 读的是实时 shop_switch**
//   ⇒ 月归档之后，只要事后改一次开关，**已归档月份的利润就跟着变** ⇒ 「已归档=只读」在这条路径上是假的。
//   而 saveLedger 早就把快照落库了（`switch_used: result.switchUsed`），**只是从没人读**（死字段）。
//
// ⚠️ 为什么既有 161 个套件一条都抓不到：`check_amort_archive_lock`（R256）守的是「写路径有没有上锁」，
//    `check_archive_grace` 守的是「归档宽限天数」⇒ 与本守卫的「**回读重算的参数**有没有冻结」不是同一层。
//
// 判据（四段，形态照 gate-suite-checklist §0）：
//   S 扫描面（fail-closed）：四份目标文件在场、快照字段**写侧**真的落库、三份引擎副本都产出 switchUsed。
//   A 源码面：getLedger 真的调了解算函数、开关常量取自解算结果（而非实时 swGet）、
//             引擎调用块内不含 swGet、解算早于重算、isArchive 与落库同源、出参带 switch_source。
//   A2 穷尽三条腿（同 check_paywall_coverage L6-② 手法）：把「为什么其它写路径不是本锁的适用面」
//              变成机器断言 —— ① M1 归档域不含销量行 ② calcMonthlyProfit 是纯计算、读不到归档态。
//   B 行为面：真调生产纯函数 resolveArchiveSwitches，钉死三态语义 + 残缺/空入参的回落。
//   C 自失效 / 反恒真：影子样本（旧的实现 / 只看归档不看快照的假实现）必须判红。
//
// ⚠️ 诚实边界：A 段是源码形态（改措辞会转红，属"判字面"）；B 段是行为（判语义）。两条路线互补。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions', 'getLedger');
const IDX = path.join(CF, 'index.js');
const SVC = path.join(CF, 'service.js');
const SL = path.join(ROOT, 'cloudfunctions', 'saveLedger', 'index.js');
const CMP = path.join(ROOT, 'cloudfunctions', 'calcMonthlyProfit', 'index.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };

const idx = read(IDX);
const svc = read(SVC);
const slIdx = read(SL);
const cmpIdx = read(CMP);

console.log('===== S 扫描面（fail-closed：文件不在场 / 源文件为空 ⇒ 直接判红，不猜）=====');
check('S-① 四份目标文件都在场且非空',
  idx.length > 0 && svc.length > 0 && slIdx.length > 0 && cmpIdx.length > 0,
  `getLedger/index=${idx.length} service=${svc.length} saveLedger=${slIdx.length} calcMonthlyProfit=${cmpIdx.length}`);
// 🔴 加严理由（变异 M9 抓出来的自身假绿）：`switch_used: result.switchUsed` 在 saveLedger/index.js 里
//    出现**两次**（落库 doc 一次、出参 out 一次）。只判「文件里出现过」⇒ 从 doc 里删掉、只留 out，守卫仍全绿，
//    而读侧拿不到任何快照 ⇒ 整条修复是空的。⇒ 必须定位到**落库 doc 块内**。
const iDoc = slIdx.indexOf('const doc = {');
const docBlock = iDoc >= 0 ? slIdx.slice(iDoc, slIdx.indexOf('\n  };', iDoc)) : '';
check('S-② 🔴 写侧把快照落进了**库**（switch_used 出现在落库 doc 块内，不是只在出参里）',
  docBlock.length > 0 && /switch_used:\s*result\.switchUsed/.test(docBlock),
  `doc块=${docBlock.length}字 hit=${/switch_used:\s*result\.switchUsed/.test(docBlock)}`);
// 引擎三副本（saveLedger / calcMonthlyProfit / getLedger 各自内嵌一份）都必须产出 switchUsed
const engineCopies = [
  path.join(ROOT, 'cloudfunctions', 'saveLedger', 'service.js'),
  path.join(ROOT, 'cloudfunctions', 'calcMonthlyProfit', 'service.js'),
  path.join(ROOT, 'cloudfunctions', 'getLedger', 'service.js'),
];
const engineHit = engineCopies.map((p) => /switchUsed:\s*\{\s*inventorySwitchOn,\s*amortizeSwitchOn\s*\}/.test(read(p)));
check('S-③ 引擎三份副本都产出 switchUsed:{inventorySwitchOn, amortizeSwitchOn}（键名同源）',
  engineHit.every(Boolean), JSON.stringify(engineHit));
check('S-④ 读侧引入了解算函数（require 里带 resolveArchiveSwitches）',
  /const \{\s*calcMonthlyProfit,\s*resolveArchiveSwitches\s*\}\s*=\s*require\('\.\/service'\)/.test(idx),
  String(/resolveArchiveSwitches\s*\}\s*=\s*require\('\.\/service'\)/.test(idx)));
check('S-⑤ 解算函数在 service.js 里导出（读得到才谈得上用）',
  /module\.exports\s*=\s*\{[^}]*resolveArchiveSwitches/.test(svc));

console.log('\n===== A 源码面（归档月回读走快照，不走实时）=====');
check('A-① controller 真的调用 resolveArchiveSwitches({...})（不只是 import 了）',
  /const sw = resolveArchiveSwitches\(\{/.test(idx), String(/const sw = resolveArchiveSwitches\(\{/.test(idx)));
check('A-② 🔴 开关常量取自解算结果 sw.*（改回 swGet(...) = 缺口复发）',
  /const inventorySwitchOn = sw\.inventorySwitchOn;/.test(idx)
  && /const amortizeSwitchOn = sw\.amortizeSwitchOn;/.test(idx)
  && !/SwitchOn\s*=\s*swGet\(/.test(idx),
  `取sw=${/const inventorySwitchOn = sw\.inventorySwitchOn;/.test(idx)} 无实时直取=${!/SwitchOn\s*=\s*swGet\(/.test(idx)}`);
// 引擎入参是**简写多行**（amortizeSwitchOn, inventorySwitchOn,）⇒ 按调用块取，不做整行匹配
const iCall = idx.indexOf('calcMonthlyProfit({');
const callBlock = iCall >= 0 ? idx.slice(iCall, idx.indexOf('});', iCall)) : '';
check('A-③ 🔴 喂进引擎的是上面那两个常量（简写），且调用块内不含实时 swGet',
  callBlock.length > 0 && callBlock.indexOf('inventorySwitchOn') >= 0
  && callBlock.indexOf('amortizeSwitchOn') >= 0 && callBlock.indexOf('swGet(') < 0,
  `block=${callBlock.length}字 swGet=${callBlock.indexOf('swGet(')}`);
check('A-④ 🔴 解算发生在重算之前（顺序：resolveArchiveSwitches 早于 calcMonthlyProfit）',
  idx.indexOf('resolveArchiveSwitches({') > 0
  && idx.indexOf('calcMonthlyProfit({') > idx.indexOf('resolveArchiveSwitches({'),
  `resolve@${idx.indexOf('resolveArchiveSwitches({')} < calc@${idx.indexOf('calcMonthlyProfit({')}`);
check('A-⑤ isArchive 判定与落库同源（acct.is_archive，不另立开关态）',
  /const isArchiveNow = !!\(\s*acct && acct\.is_archive\s*\)/.test(idx));
check('A-⑥ 快照取自 acct.switch_used（与 saveLedger 落库字段同名同源）',
  /switchUsed:\s*acct && acct\.switch_used/.test(idx));
check('A-⑦ 出参带 switch_source（归档月数字为什么没跟开关变，留一条可查线索）',
  /switch_source:\s*sw\.source/.test(idx));
check('A-⑧ 出参 is_archive 复用同一个 isArchiveNow（不与判定分家）',
  /is_archive:\s*isArchiveNow/.test(idx));
// 🔴 补这条的理由（变异 M1 抓出来的自身假绿）：只判「调了解算函数」不够 ——
//    把 isArchive 写死成 false，解算照样被调用，但归档月永远走实时 ⇒ 缺口原样复发而守卫全绿。
check('A-⑨ 🔴 归档标记真的传进了解算（isArchive: isArchiveNow，写死 false = 缺口复发）',
  /isArchive:\s*isArchiveNow/.test(idx), String(/isArchive:\s*isArchiveNow/.test(idx)));
check('A-⑩ 🔴 实时值仍作为 live* 入参传入（否则未归档月会失去实时开关）',
  /liveInventorySwitchOn:\s*swGet\('inventory_switch'\)/.test(idx)
  && /liveAmortizeSwitchOn:\s*swGet\('amortize_switch'\)/.test(idx),
  `inv=${/liveInventorySwitchOn:\s*swGet\('inventory_switch'\)/.test(idx)} amo=${/liveAmortizeSwitchOn:\s*swGet\('amortize_switch'\)/.test(idx)}`);

console.log('\n===== A2 穷尽三条腿（把「为什么别处不是本锁的适用面」变成机器断言）=====');
// 腿①：external_sales_daily 的两个写方（importSalesBill / clearSalesBills）确实没有归档锁，
//       但它们**不在 M1 归档域内** —— M1 月账的收入是手工录入的 income_items，不从销量行取数。
//       ⇒ 若哪天 getLedger / saveLedger 开始读销量行，这条断言会转红，逼人重新评估。
check('A2-① M1 归档域不含销量行（getLedger / saveLedger 均不引用 external_sales_daily）',
  idx.indexOf('external_sales_daily') < 0 && slIdx.indexOf('external_sales_daily') < 0,
  `getLedger=${idx.indexOf('external_sales_daily')} saveLedger=${slIdx.indexOf('external_sales_daily')}`);
// 腿②：calcMonthlyProfit 是**纯计算**入口 —— 它收 month 只是透传回显，读不到 shop_monthly_account
//       ⇒ 结构上无从判定某月是否归档，不是本锁的适用面（硬加锁只能在它的调用方做）。
check('A2-② calcMonthlyProfit 读不到归档态（不读 shop_monthly_account ⇒ 结构上无法判归档）',
  cmpIdx.indexOf('shop_monthly_account') < 0, String(cmpIdx.indexOf('shop_monthly_account')));
// 腿③：getAmortSchedule 也返回实时开关，但**页面在归档态已拦住改动** ⇒ 只影响观感、不改数字
//       ⇒ 本轮不动；这里断言「它确实带 is_archive 出参」，保证前端那条拦截的前提还在。
const gas = read(path.join(ROOT, 'cloudfunctions', 'getAmortSchedule', 'index.js'));
check('A2-③ getAmortSchedule 仍带 is_archive 出参（前端归档拦截的前提未被拆掉）',
  /is_archive:\s*isArchive/.test(gas), String(/is_archive:\s*isArchive/.test(gas)));
const amortPage = read(path.join(ROOT, 'pages', 'month', 'amortize.js'));
check('A2-④ 摊销页归档态下拦住改开关（onToggleAmortize 里 isArchive 早退）',
  /onToggleAmortize/.test(amortPage) && /if \(this\.data\.isArchive\)/.test(amortPage));

console.log('\n===== B 行为面（真调生产纯函数，不看源码字面）=====');
let R = null;
let loadErr = '';
try {
  // eslint-disable-next-line global-require
  R = require(path.join(CF, 'service.js')).resolveArchiveSwitches;
} catch (e) { loadErr = String(e && e.message || e); }
check('B-⓪ 生产纯函数 resolveArchiveSwitches 可加载（加载不了 ⇒ 行为面全废，直接判红）',
  typeof R === 'function', loadErr || typeof R);

const SNAP_OFF = { inventorySwitchOn: false, amortizeSwitchOn: false };
const SNAP_ON = { inventorySwitchOn: true, amortizeSwitchOn: true };
const b1 = R({ isArchive: true, switchUsed: SNAP_OFF, liveInventorySwitchOn: true, liveAmortizeSwitchOn: true });
check('B-① 归档 + 完整快照 ⇒ 用快照（实时全开也压不住：这是本轮修掉的缺口本体）',
  b1 && b1.source === 'snapshot' && b1.inventorySwitchOn === false && b1.amortizeSwitchOn === false,
  b1 ? b1.source : 'n/a');
const b2 = R({ isArchive: true, switchUsed: SNAP_ON, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false });
check('B-② 归档 + 快照全开 ⇒ 实时全关也压不住（反向）',
  b2 && b2.source === 'snapshot' && b2.inventorySwitchOn === true && b2.amortizeSwitchOn === true,
  b2 ? b2.source : 'n/a');
const b3 = R({ isArchive: false, switchUsed: SNAP_OFF, liveInventorySwitchOn: true, liveAmortizeSwitchOn: false });
check('B-③ 未归档 ⇒ 用实时（开关是实时建模控件，改了就该立刻看到效果）',
  b3 && b3.source === 'live' && b3.inventorySwitchOn === true && b3.amortizeSwitchOn === false,
  b3 ? b3.source : 'n/a');
const b4 = R({ isArchive: true, switchUsed: null, liveInventorySwitchOn: true, liveAmortizeSwitchOn: false });
check('B-④ 归档但快照缺失 ⇒ 回落实时且标记 live_no_snapshot（唯一 fail-open，零回归）',
  b4 && b4.source === 'live_no_snapshot' && b4.inventorySwitchOn === true && b4.amortizeSwitchOn === false,
  b4 ? b4.source : 'n/a');
const b5 = R({ isArchive: true, switchUsed: { inventorySwitchOn: true }, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false });
check('B-⑤ 快照残缺（只一个布尔键）⇒ 判不完整、整份回落（不做半用半不用的拼盘）',
  b5 && b5.source === 'live_no_snapshot' && b5.inventorySwitchOn === false, b5 ? b5.source : 'n/a');
const b6 = R({ isArchive: true, switchUsed: { inventorySwitchOn: 1, amortizeSwitchOn: 0 }, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false });
check('B-⑥ 快照是 1/0 而非布尔 ⇒ 判不完整（不把真值硬当布尔，避免脏数据被"认下来"）',
  b6 && b6.source === 'live_no_snapshot', b6 ? b6.source : 'n/a');
const b7 = R();
check('B-⑦ 空入参不炸（未归档语义 ⇒ live 全关）',
  b7 && b7.source === 'live' && b7.inventorySwitchOn === false && b7.amortizeSwitchOn === false);
// 「归档月的数字不随事后改开关而变」—— 用引擎验一次真数值（不是只看 source 字符串）
const { calcMonthlyProfit } = require(path.join(CF, 'service.js'));
const BASE = {
  incomeItems: [{ amountFen: 1000000 }],
  expenseItems: [{ amountFen: 300000 }],
  directConsumeFen: 200000,
  amortizeFen: 50000,
  inventory: { openingFen: 0, purchaseFen: 100000, closingFen: 10000 },
  lumpSumFen: 0,
};
const withSnap = calcMonthlyProfit(Object.assign({}, BASE, { amortizeSwitchOn: false, inventorySwitchOn: false }));
const withLive = calcMonthlyProfit(Object.assign({}, BASE, { amortizeSwitchOn: true, inventorySwitchOn: true }));
check('B-⑧ 开关不同 ⇒ 引擎结果确实不同（否则本轮修的缺口根本不存在，判据白立）',
  withSnap.totalFactorRealProfitFen !== withLive.totalFactorRealProfitFen,
  `snap=${withSnap.totalFactorRealProfitFen} live=${withLive.totalFactorRealProfitFen}`);

console.log('\n===== C 自失效 / 反恒真（影子样本必须判红）=====');
// 影子①：R257 之前的旧形态 —— 开关直接取自实时 swGet
const OLD_SRC = 'const inventorySwitchOn = swGet(\'inventory_switch\');\n'
  + 'const amortizeSwitchOn = swGet(\'amortize_switch\');\n'
  + 'const result = calcMonthlyProfit({ incomeItems, expenseItems, inventory, amortizeSwitchOn, inventorySwitchOn });';
check('C-① 影子：旧形态（swGet 直取）在 A-② 判据上必须判红（证明有分辨力）',
  !(/const inventorySwitchOn = sw\.inventorySwitchOn;/.test(OLD_SRC)
    && /const amortizeSwitchOn = sw\.amortizeSwitchOn;/.test(OLD_SRC)),
  String(/const inventorySwitchOn = sw\.inventorySwitchOn;/.test(OLD_SRC)));
// 影子②：「只看归档、不看快照完整度」的假实现 ⇒ B-④ 那条必须失效
const fakeArchiveOnly = (inp) => (inp && inp.isArchive
  ? { inventorySwitchOn: !!(inp.switchUsed && inp.switchUsed.inventorySwitchOn), amortizeSwitchOn: !!(inp.switchUsed && inp.switchUsed.amortizeSwitchOn), source: 'snapshot' }
  : { inventorySwitchOn: !!inp.liveInventorySwitchOn, amortizeSwitchOn: !!inp.liveAmortizeSwitchOn, source: 'live' });
const f1 = fakeArchiveOnly({ isArchive: true, switchUsed: null, liveInventorySwitchOn: true, liveAmortizeSwitchOn: false });
check('C-② 影子：缺快照也硬用快照的假实现 ⇒ 与真实现在 B-④ 样本上不同（样本有分辨力）',
  f1.source !== b4.source, `假=${f1.source} 真=${b4.source}`);
check('C-③ 影子：假实现在该样本上的 inventorySwitchOn 也≠真实现（不只是 source 不同）',
  f1.inventorySwitchOn !== b4.inventorySwitchOn, `假=${f1.inventorySwitchOn} 真=${b4.inventorySwitchOn}`);
// 影子③：未归档也用快照的假实现 ⇒ B-③ 必须失效
const fakeAlwaysSnap = (inp) => ({ inventorySwitchOn: !!(inp && inp.switchUsed && inp.switchUsed.inventorySwitchOn), amortizeSwitchOn: !!(inp && inp.switchUsed && inp.switchUsed.amortizeSwitchOn), source: 'snapshot' });
const f2 = fakeAlwaysSnap({ isArchive: false, switchUsed: SNAP_OFF, liveInventorySwitchOn: true, liveAmortizeSwitchOn: false });
check('C-④ 影子：未归档也用快照的假实现 ⇒ 与真实现在 B-③ 样本上不同（未归档必须跟实时）',
  f2.inventorySwitchOn !== b3.inventorySwitchOn && f2.source !== b3.source,
  `假=${f2.source}/${f2.inventorySwitchOn} 真=${b3.source}/${b3.inventorySwitchOn}`);
check('C-⑤ 断言数下界 ≥ 20（防删段后恒绿）', (pass + failN) >= 20, `本段前累计 ${pass + failN} 条`);

console.log(`\n===== R257 归档月开关快照守卫：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
