// R737 交叉审计 fixture —— 把「李老师的真实账」固化成可复算数据。
// 用途：让四个独立打桩的引擎副本吃**同一份**输入，逐个比数字。
// 不许改这里的数字去迁就实现：实现错了就红，红了我改实现。

// ===== 台账（shop_amortize）=====
// 金额一律「分」。装修 130,000 元 / 36 期；设备 40,000 元 / 24 期；转让费 50,000 一次性。
const ASSETS = [
  { asset_id: 'a1', name: '装修',   mode: 'amort', start_month: '2026-09', total_months: 36, total_value: 13000000 },
  { asset_id: 'a2', name: '设备',   mode: 'amort', start_month: '2026-10', total_months: 24, total_value: 4000000 },
  { asset_id: 'a3', name: '转让费', mode: 'lump',  start_month: '2026-09', total_months: 1,  total_value: 5000000 },
];

// ===== 月份序列（跨闸门前/中/后 + 跨年）=====
const MONTHS = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];

// ===== 当月账（收入/费用/直接消耗），固定不变，便于差异只来自摊销 =====
const BOOK = {
  incomeItems: [{ name: '堂食', amountFen: 10000000 }],   // 100,000 元
  expenseItems: [{ name: '房租', amountFen: 3000000 }],   // 30,000 元
  directConsumeFen: 2000000,                              // 20,000 元
  lumpSumFen: 5000000,                                    // 50,000 元（转让费，当月一次算清）
  inventorySwitchOn: false,
  inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
};

// 台账侧应摊额（独立手算，不用被测代码算，否则是自证）
//  base(装修) = round(13000000/36) = 361111；尾差在 2026-09+35 = 2031-08 那月
//  base(设备) = round(4000000/24)  = 166667；尾差在 2026-10+23 = 2028-09 那月
const EXPECT_AMORT = {
  '2026-09': 361111,
  '2026-10': 361111 + 166667,
  '2026-11': 361111 + 166667,
  '2026-12': 361111 + 166667,
  '2027-01': 361111 + 166667,
};

// 引擎侧应计入利润的摊销（v2 生效月 = 2026-11）
const EXPECT_EFFECTIVE = {
  '2026-09': (sw) => (sw ? EXPECT_AMORT['2026-09'] : 0),
  '2026-10': (sw) => (sw ? EXPECT_AMORT['2026-10'] : 0),
  '2026-11': () => EXPECT_AMORT['2026-11'],
  '2026-12': () => EXPECT_AMORT['2026-12'],
  '2027-01': () => EXPECT_AMORT['2027-01'],
};

module.exports = { ASSETS, MONTHS, BOOK, EXPECT_AMORT, EXPECT_EFFECTIVE };
