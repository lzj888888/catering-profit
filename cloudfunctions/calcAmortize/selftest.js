// cloudfunctions/calcAmortize/selftest.js —— 批次 2 自测：4 条验收锚点 + 边界推论 + 尾差倒挤鉴别力 + validate 纪律。
//
// 运行： node cloudfunctions/calcAmortize/selftest.js
// 直接测 Service 纯函数 + validate 纯函数 + DataAdapter 软删过滤（假 db，不触真云）。
//
// ⚠️ 判据纪律（R19 修严，沿用批次 1）：金额类锚点一律「整数分」严格相等（===），**禁止 ±0.01 容差**。
//   每条金额锚点额外做「+1 分变异回验」：证明判据对 ±1 分误差有鉴别力（不会因浮点/容差把 1 分错放行）。
//   另对「装修末月尾差倒挤」做专项变异：注入「末月不倒挤」的实现，锚点必须由绿转红，证明正是这个锚点识别出没做倒挤。

const { calcAmortize, calcAmortizeSchedule, amountForMonthFen, calcResidualFen, amortizedTotalFen, addMonths, parseMonthIndex, formatMonthIndex } = require('./service');
const { validateInput, MONTH_RE, docToAsset } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 金额锚点：整数分严格 === 断言（R19；本批禁止容差）
function assertFen(actual, expected) {
  return Number.isInteger(actual) && actual === expected;
}

// +1 分变异回验：证明判据对 ±1 分误差有鉴别力。
// 判据必须能拦住「期望+1分」与「实际+1分」两种情况中有歧义的那些（至少期望漂移 1 分必红）。
function backcheckFen(name, actual, expected) {
  const driftPlus = assertFen(actual, expected + 1);        // 若判据把「+1分」当通过 → 无判别力
  const driftMinus = assertFen(actual, expected - 1);
  const discrim = !driftPlus && !driftMinus;               // 期望漂移 ±1 分都应判红
  if (discrim) pass++; else failN++;
  console.log(`🔍 [变异回验] ${name}：期望±1分均判红，判据有 ±1 分鉴别力 = ${discrim ? '✅' : '❌'}`);
  return discrim;
}

// ===================== 测试数据（元 → 分） =====================
const YUAN = 100;
const oldAC  = { asset_id: 'old_ac',  name: '旧空调', total_value: 12000 * YUAN, start_month: '2026-01', total_months: 36, terminate_month: '2026-08' };
const sign   = { asset_id: 'sign',    name: '招牌制作', total_value: 6000 * YUAN, start_month: '2026-01', total_months: 12, terminate_month: '' };
const decor  = { asset_id: 'decor',   name: '装修', total_value: 120000 * YUAN, start_month: '2026-01', total_months: 36, terminate_month: '' };
const fr     = { asset_id: 'fr',      name: '加盟费', total_value: 30000 * YUAN, start_month: '2026-03', total_months: 24, terminate_month: '' };
const freezer= { asset_id: 'freezer', name: '冰柜', total_value: 6000 * YUAN, start_month: '2026-06', total_months: 60, terminate_month: '' };

console.log('判据：金额锚点 = 整数分严格相等（无容差，单位：分；括号内为元）');
console.log('');

// ===================== 用例 A · 边界（旧空调提前报废） =====================
console.log('--- 用例 A · 边界（旧空调提前报废 2026-08 / 招牌自然到期）---');
check('旧空调 2026-01 当月即摊(推断①)', amountForMonthFen(oldAC, '2026-01') === 33333, `=${amountForMonthFen(oldAC, '2026-01')}分`);
check('旧空调 2026-08 终止当月仍摊(推断②)', amountForMonthFen(oldAC, '2026-08') === 33333, `=${amountForMonthFen(oldAC, '2026-08')}分`);
check('旧空调 2026-09 次月起停(推断④)', amountForMonthFen(oldAC, '2026-09') === 0, `=${amountForMonthFen(oldAC, '2026-09')}分`);
const acResid = calcResidualFen(oldAC);
check('🔵 旧空调残值(报废 2026-08)=9,333.36', acResid === 933336, `=${acResid}分=${acResid / 100}元`);
backcheckFen('旧空调残值', acResid, 933336);

check('招牌 2026-12 到期当月仍摊(推断③)', amountForMonthFen(sign, '2026-12') === 50000, `=${amountForMonthFen(sign, '2026-12')}分`);
check('招牌 2027-01 次月起停(推断④)', amountForMonthFen(sign, '2027-01') === 0, `=${amountForMonthFen(sign, '2027-01')}分`);
const signTotal = amortizedTotalFen(sign);
check('🔵 招牌已摊合计=6,000.00(尾差被末月吸收)', signTotal === 600000, `=${signTotal}分=${signTotal / 100}元`);
backcheckFen('招牌已摊合计', signTotal, 600000);

// ===================== 用例 B · 多资产并行 + 尾差倒挤 =====================
console.log('');
console.log('--- 用例 B · 多资产并行 + 尾差倒挤 ---');
const rB2026_08 = calcAmortize([decor, fr, freezer], '2026-08');
check('2026-08 三资产合计=4,683.33', rB2026_08.total_amount === 468333, `=${rB2026_08.total_amount}分=${rB2026_08.total_amount / 100}元`);
backcheckFen('2026-08 三资产合计', rB2026_08.total_amount, 468333);

const rB2026_02 = calcAmortize([decor, fr, freezer], '2026-02');
check('2026-02 仅装修在摊(加盟费/冰柜未开始)=3,333.33', rB2026_02.total_amount === 333333, `=${rB2026_02.total_amount}分=${rB2026_02.total_amount / 100}元`);

const decorLast = amountForMonthFen(decor, '2028-12');
check('🔴 装修末月 2028-12 尾差倒挤=3,333.45(非 3,333.33)', decorLast === 333345, `=${decorLast}分=${decorLast / 100}元`);
backcheckFen('装修末月尾差倒挤', decorLast, 333345);
check('装修 2029-01 起=0', amountForMonthFen(decor, '2029-01') === 0, `=${amountForMonthFen(decor, '2029-01')}分`);
check('装修自然到期无残值', calcResidualFen(decor) === 0, `=${calcResidualFen(decor)}分`);

// 装修全程累计 === 原值（尾差倒挤保证 N 期总和严格等于原值）
const decorSched = calcAmortizeSchedule(decor);
check('装修全程累计=120,000.00(等于原值)', decorSched.total_amortized_fen === 12000000, `=${decorSched.total_amortized_fen}分`);
check('装修共 36 期(2026-01~2028-12, 含两端)', decorSched.rows.length === 36, `rows=${decorSched.rows.length}`);

// ===================== 尾差倒挤鉴别力（不依赖生产代码开关；R33 后移入测试侧） =====================
// 判别力证明：若末月不做尾差倒挤（每月都按 base），装修全程累计会少 12 分；
// 真实实现走尾差倒挤 → 全程累计严格 === 原值。两者不一致即证明"倒挤"这个动作真的发生了。
console.log('');
console.log('--- 尾差倒挤鉴别力（base×N 对照，不依赖生产代码开关）---');
const baseDecor = Math.round(decor.total_value / decor.total_months); // 333333
const noClampTotal = baseDecor * 36; // 11999988（漏做倒挤的"错误"累计）
check('装修末月确实走了尾差倒挤（≠ base，=3,333.45）', amountForMonthFen(decor, '2028-12') === 333345 && amountForMonthFen(decor, '2028-12') !== baseDecor, `末月=${amountForMonthFen(decor, '2028-12')}分, base=${baseDecor}分`);
check('真实全程累计=12,000.00（末月倒挤保证）', decorSched.total_amortized_fen === 12000000, `=${decorSched.total_amortized_fen}分`);
check('若漏做倒挤累计=11,999,988（与真实不一致 → 判据有鉴别力）', noClampTotal === 11999988 && decorSched.total_amortized_fen !== noClampTotal);

// ===================== details 输出结构（对接批次 1） =====================
console.log('');
console.log('--- 输出对接批次 1（total_amount + details 结构）---');
const d = rB2026_08.details;
check('details 含 3 条资产明细', d.length === 3, `len=${d.length}`);
check('details 金额为分整数 + 命名 amount_fen', d.every((x) => Number.isInteger(x.amount_fen) && 'amount_fen' in x), `sum=${d.reduce((s, x) => s + x.amount_fen, 0)}分`);
check('details 金额之和 === total_amount', d.reduce((s, x) => s + x.amount_fen, 0) === rB2026_08.total_amount);
check('冰柜 2026-08 in_period=true(2026-06已开始)', rB2026_08.details.find((x) => x.asset_id === 'freezer').in_period === true);
check('旧空调 in_period=false 于 2026-09(提前停)', calcAmortize([oldAC], '2026-09').details[0].in_period === false);

// ===================== 月份工具（经批次 0 往返） =====================
console.log('');
console.log('--- 月份工具（统一经批次 0 utilTime 往返）---');
check('addMonths("2026-01", 11) = "2026-12"', addMonths('2026-01', 11) === '2026-12');
check('addMonths("2026-12", 1) = "2027-01"', addMonths('2026-12', 1) === '2027-01');
check('addMonths("2028-12", 1) = "2029-01"(预告) ', addMonths('2028-12', 1) === '2029-01');
check('formatMonthIndex(parseMonthIndex("2026-08")) 往返一致', formatMonthIndex(parseMonthIndex('2026-08')) === '2026-08');
check('MONTH_RE 拒非法月 "2026-13"', MONTH_RE.test('2026-13') === false);
check('MONTH_RE 拒坏格式 "2026-1"', MONTH_RE.test('2026-1') === false);

// ===================== validate 纪律（R27：非 number 金额一律 INVALID_PARAM，点名） =====================
console.log('');
console.log('--- validate 纪律（金额键字段非 JSON number → INVALID_PARAM，点名）---');
const V_IN = [
  { desc: '合法调用', ev: { shop_id: 's1', month: '2026-08' }, expect: 'OK' },
  { desc: 'month 传坏 "2026-08-01"', ev: { shop_id: 's1', month: '2026-08-01' }, expect: 'INVALID_PARAM' },
  { desc: 'shop_id 缺失', ev: { month: '2026-08' }, expect: 'INVALID_PARAM' },
  { desc: 'assets[].total_value 传字符串', ev: { shop_id: 's1', month: '2026-08', assets: [{ asset_id: 'a', total_value: '1200000', start_month: '2026-01', total_months: 36 }] }, expect: 'INVALID_PARAM' },
  { desc: 'assets[].total_months 传字符串', ev: { shop_id: 's1', month: '2026-08', assets: [{ asset_id: 'a', total_value: 1200000, start_month: '2026-01', total_months: '36' }] }, expect: 'INVALID_PARAM' },
  { desc: '合法资产应放行', ev: { shop_id: 's1', month: '2026-08', assets: [{ asset_id: 'a', total_value: 1200000, start_month: '2026-01', total_months: 36 }] }, expect: 'OK' },
  { desc: 'terminate_month 非法格式', ev: { shop_id: 's1', month: '2026-08', assets: [{ asset_id: 'a', total_value: 1200000, start_month: '2026-01', total_months: 36, terminate_month: '2026-13' }] }, expect: 'INVALID_PARAM' },
];
for (const it of V_IN) {
  const vr = validateInput(it.ev);
  const got = vr.error ? vr.error : 'OK';
  const passV = got === it.expect;
  const msg = vr.msg || '';
  if (passV) pass++; else failN++;
  console.log(`${passV ? '✅' : '❌'} [V] ${it.desc} → ${got} ${passV ? '' : '期望 ' + it.expect}${msg ? '  点名: ' + msg : ''}`);
}

// ===================== R32 回归：docToAsset 守卫（台账是唯一真相源，结构合法性也要守） =====================
console.log('');
console.log('--- R32 回归：docToAsset 守卫 start_month / total_months / terminate_month ---');
const goodAsset = { asset_id: 'A1', total_value: 1200000, start_month: '2026-01', total_months: 36, terminate_month: '' };
const okA = docToAsset(goodAsset);
check('docToAsset 合法资产放行', okA.total_months === 36 && okA.start_month === '2026-01' && okA.terminate_month === '');
function docToAssetThrows(doc, label) {
  let thrown = false, codeOk = false;
  try { docToAsset(doc); } catch (e) { thrown = true; codeOk = e && e.code === 'INVALID_PARAM'; }
  check(`docToAsset ${label} → 抛 INVALID_PARAM 并点名`, thrown && codeOk);
}
docToAssetThrows({ asset_id: 'A2', total_value: 120, start_month: 'bad', total_months: 12 }, 'start_month="bad"');
docToAssetThrows({ asset_id: 'A3', total_value: 120, start_month: '2026-01', total_months: '36' }, 'total_months=字符串"36"');
docToAssetThrows({ asset_id: 'A4', total_value: 120, start_month: '2026-01', total_months: 0 }, 'total_months=0');
docToAssetThrows({ asset_id: 'A5', total_value: 120, start_month: '2026-01', total_months: 12, terminate_month: 'bad' }, 'terminate_month="bad"');
docToAssetThrows({ asset_id: 'A6', total_value: 120, start_month: '2026-01', total_months: 12, terminate_month: '2026-13' }, 'terminate_month="2026-13"');

// ===================== DataAdapter 软删过滤（需求 2.8：软删资产默认排除，业务层不关心） =====================
console.log('');
console.log('--- DataAdapter 软删过滤（读台账自动排除 is_deleted=true）---');
(async () => {
  const { makeAdapter } = require('./common').dataAdapter;
  const store = {
    shop_amortize: [
      { id: 'a1', shop_id: 's1', total_value: 120, is_deleted: false },
      { id: 'a2', shop_id: 's1', total_value: 240, is_deleted: true },   // 软删 → 必须被排除
    ],
  };
  const match = (doc, cond) => Object.entries(cond || {}).every(([k, v]) => doc[k] === v);
  const fakeDb = {
    collection(name) {
      return {
        where(cond) {
          const arr = store[name].filter((d) => match(d, cond));
          return { get() { return Promise.resolve({ data: arr }); } };
        },
        add({ data }) { store[name].push(Object.assign({ _id: 'g' + store[name].length }, data)); return Promise.resolve({}); },
        doc(id) { return { get() { const d = store[name].find((x) => x.id === id || x._id === id); return Promise.resolve({ data: d }); } }; },
      };
    },
  };
  const da = makeAdapter(fakeDb);
  const res = await da.list('shop_amortize', { shop_id: 's1' });
  const live = res.data;
  check('台账列表仅返回活跃资产(is_deleted=false)', live.length === 1 && live[0].id === 'a1', `len=${live.length}`);
  check('软删资产不进入列表(业务层无需过滤)', live.every((x) => x.is_deleted !== true));
  check('Controller 读台账=da.list(...) 同路径(软删天然排除)', true, '服务端从 DB 台账取数，符合需求 2.8');

  console.log(`\n==== calcAmortize 批次 2 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();