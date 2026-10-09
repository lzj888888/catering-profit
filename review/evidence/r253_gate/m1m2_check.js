// M1/M2 复核：映射优先 + 回落等价 + 未匹配单列返回（红线 17）
// 🔴 重点 1：**不传 lookupCardCode 时，输出必须与接线前逐字相同**（存量用户不受影响）。
// 🔴 重点 2：映射命中时，即便菜名归一后**不相等**，也要能匹配上（这正是映射表存在的理由）。
const path = require('path');
const svc = require(path.join(__dirname, '..', '..', '..', 'cloudfunctions', 'getDishReview', 'service.js'));

let bad = 0;
function ck(name, cond, detail) {
  console.log((cond ? '✅ ' : '❌ ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!cond) bad++;
}

// 复刻 index.js 的单源注入（normalizeDishName 真实口径：trim + NFKC，保留括号/规格）
const normalizeDishName = (s) => (s == null ? '' : String(s).normalize('NFKC').trim());
const toMonth = (t) => (t ? String(t).slice(0, 7) : '');

const cards = [
  { card_code: 'C001', version: 1, name: '耙牛肉', total_cost: 1200, created_at: '2026-09-01T00:00:00Z' },
  { card_code: 'C001', version: 2, name: '耙牛肉', total_cost: 1350, created_at: '2026-10-01T00:00:00Z' },
  { card_code: 'C002', version: 1, name: '小面', total_cost: 300, created_at: '2026-09-05T00:00:00Z' },
];

// ---------- A. 回落等价性：不注入 lookupCardCode ----------
const salesA = [
  { dish_key: '耙牛肉', qty: 10, amount: 12000, platform: 'pos' },
  { dish_key: '小面', qty: 5, amount: 3000, platform: 'pos' },
  { dish_key: '没成本卡的菜', qty: 2, amount: 2000, platform: 'pos' },
];
const oldDeps = { normalizeDishName, toMonth };                       // 接线前形态
const newDepsNoMap = { normalizeDishName, toMonth, lookupCardCode: null };
const a1 = JSON.stringify(svc.buildDishReview(salesA, cards, oldDeps));
const a2 = JSON.stringify(svc.buildDishReview(salesA, cards, newDepsNoMap));
ck('A1 不传 lookupCardCode ⇒ 输出与接线前逐字相同（存量用户零影响）', a1 === a2,
  a1 === a2 ? 'len=' + a1.length : ('前=' + a1.slice(0, 120) + ' 后=' + a2.slice(0, 120)));

// 空映射表（返回 '' ⇒ 等价于查不到）也必须等价
const newDepsEmptyMap = { normalizeDishName, toMonth, lookupCardCode: () => '' };
const a3 = JSON.stringify(svc.buildDishReview(salesA, cards, newDepsEmptyMap));
ck('A2 映射表为空（恒返 \'\'）⇒ 输出仍与接线前逐字相同', a1 === a3, '');

// ---------- B. 映射命中：菜名对不上也能挂上卡 ----------
const salesB = [{ dish_key: '耙牛肉(小份)', qty: 3, amount: 4500, platform: 'pos' }];
// 先证：无映射时这条**匹配不上**（证明映射不是多此一举）
const b0 = svc.buildDishReview(salesB, cards, oldDeps);
ck('B1 无映射时「耙牛肉(小份)」确实匹配不上（unmatched=1）', b0.unmatched.length === 1 && b0.dine_in.length === 0,
  'unmatched=' + b0.unmatched.length + ' ranked=' + b0.dine_in.length);
const mapB = { 'pos|耙牛肉(小份)': 'C001' };
const lookupB = (k, p) => mapB[p + '|' + k] || '';
const b1 = svc.buildDishReview(salesB, cards, { normalizeDishName, toMonth, lookupCardCode: lookupB });
ck('B2 挂上映射后同一行匹配成功（走卡内锁定成本 1350 = 最新版本）',
  b1.dine_in.length === 1 && b1.dine_in[0].card_code === 'C001' && b1.dine_in[0].totalCostFen === 3 * 1350,
  JSON.stringify(b1.dine_in[0] || b1.unmatched));

// ---------- C. 映射指向不存在的卡 ⇒ 回落名称匹配（不能因脏映射把好行打掉） ----------
const salesC = [{ dish_key: '小面', qty: 5, amount: 3000, platform: 'pos' }];
const lookupDirty = (k, p) => (k === '小面' ? 'NO_SUCH_CARD' : '');
const c1 = svc.buildDishReview(salesC, cards, { normalizeDishName, toMonth, lookupCardCode: lookupDirty });
ck('C1 映射指向不存在的卡 ⇒ 回落名称匹配，小面仍匹配上 C002',
  c1.dine_in.length === 1 && c1.dine_in[0].card_code === 'C002', JSON.stringify(c1.dine_in[0] || c1.unmatched));

// ---------- D. 平台隔离：同 dish_key 跨平台不串卡 ----------
const mapD = { 'meituan|招牌面': 'C002', 'taobao|招牌面': 'C001' };
const lookupD = (k, p) => mapD[p + '|' + k] || '';
const salesD = [
  { dish_key: '招牌面', qty: 2, amount: 2000, platform: 'meituan' },
  { dish_key: '招牌面', qty: 2, amount: 2000, platform: 'taobao' },
];
const d1 = svc.rankReview(salesD.filter((s) => s.platform === 'meituan'), cards, { normalizeDishName, toMonth, lookupCardCode: lookupD });
const d2 = svc.rankReview(salesD.filter((s) => s.platform === 'taobao'), cards, { normalizeDishName, toMonth, lookupCardCode: lookupD });
ck('D1 美团行挂 C002、淘宝行挂 C001（平台隔离，不串卡）',
  d1.ranked[0] && d2.ranked[0] && d1.ranked[0].card_code === 'C002' && d2.ranked[0].card_code === 'C001',
  'mt=' + JSON.stringify((d1.ranked[0] || {}).card_code) + ' tb=' + JSON.stringify((d2.ranked[0] || {}).card_code));

// ---------- E. 红线 17：仍未匹配的必须单列返回，绝不归零 ----------
const salesE = [{ dish_key: '完全没卡的菜', qty: 7, amount: 7000, platform: 'pos' }];
const e1 = svc.buildDishReview(salesE, cards, { normalizeDishName, toMonth, lookupCardCode: lookupB });
ck('E1 未匹配仍单列返回（红线 17：不静默归零）',
  e1.unmatched.length === 1 && e1.unmatched[0].dish_key === '完全没卡的菜'
  && e1.unmatched[0].qty === 7 && e1.unmatched[0].amountFen === 7000,
  JSON.stringify(e1.unmatched));
ck('E2 未匹配不进 ranked、但仍计入 totals.qty/amountFen',
  e1.dine_in.length === 0 && e1.totals.qty === 7 && e1.totals.amountFen === 7000 && e1.totals.grossFen === 0,
  JSON.stringify(e1.totals));

console.log('\n结论：', bad === 0 ? '✅ M1/M2 全通过' : ('❌ ' + bad + ' 处不符'));
process.exit(bad === 0 ? 0 : 1);
