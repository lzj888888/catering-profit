/**
 * seed_data.js · 验收演示数据集（单一真相源）
 *
 * 用途：把《02_模拟测试数据集.md》的 S1~S4 验收场景，用四个计算原型的
 *      输入形状（calcMonthlyProfit / calcDishCost / calcAmortize / calcSandbox）
 *      表达为结构化对象，并携带「预期输出值」。
 *
 * 双重消费方：
 *   1) verify_seed_data.js —— 本机直接喂给四个计算原型，断言 22 项验收锚点全绿。
 *   2) seed_demo.js       —— 云函数，把同一份数据翻译成集合记录插入 dev 环境。
 * 因为两边引用同一份数据，所以「插进云库的数据」必然 == 「算出来能对上的数据」。
 *
 * 金额单位：本文件全部用【元】。云函数侧插入时按「×100 转分」(见 seed_demo.js)。
 * 预期值来源：core/02_模拟测试数据集.md（验收唯一标准），误差 ≤ 0.01 元即视为通过。
 */

// ===================== S1：基础双利润（库存关 / 摊销关）2026-07 =====================
// 验证：收入三分法汇总、毛利铁律（仅扣食材）、双利润口径一致、毛利率、费用汇总。
const S1 = {
  month: '2026-07',
  inventoryOn: false,
  amortYuan: 0,
  // 收入（元），顺序无关，sum = 64,000
  incomes: [
    { cat: 'dinein', sub: 'cash',               amountYuan: 8000 },  // 堂食-现金
    { cat: 'dinein', sub: 'wx_alipay',          amountYuan: 25000 }, // 堂食-微信支付宝
    { cat: 'dinein', sub: 'stored_consume',     amountYuan: 5000 },  // 堂食-储值消费（核销）
    { cat: 'dinein', sub: 'groupbuy_redeem',    amountYuan: 3000 },  // 堂食-团购券核销（按成交价）
    { cat: 'dinein', sub: 'credit_consume',     amountYuan: 2000 },  // 堂食-企业挂账消费
    { cat: 'takeout', sub: 'goods',             amountYuan: 18000 }, // 外卖-商品总价
    { cat: 'takeout', sub: 'packing',           amountYuan: 500 },   // 外卖-打包费
    { cat: 'takeout', sub: 'merchant_subsidy',   amountYuan: 1500 },  // 外卖-商家活动补贴
    { cat: 'other',   sub: 'scrap',              amountYuan: 200 },   // 其他-废品变卖
    { cat: 'other',   sub: 'prepared_retail',    amountYuan: 800 },   // 其他-预制菜零售
  ],
  // 费用（元），sum = 32,840（门店10,300 / 人工15,000 / 营销7,240 / 其他300）
  expenses: [
    // —— 门店运营费（10,300）——
    { cat: 'store', sub: 'rent',       amountYuan: 8000 },
    { cat: 'store', sub: 'property',   amountYuan: 500 },
    { cat: 'store', sub: 'water',      amountYuan: 200 },
    { cat: 'store', sub: 'electric',   amountYuan: 800 },
    { cat: 'store', sub: 'gas',        amountYuan: 600 },
    { cat: 'store', sub: 'trash',      amountYuan: 100 },
    { cat: 'store', sub: 'broadband',  amountYuan: 100 },
    { cat: 'store', sub: 'other',      amountYuan: 0 },
    // —— 人工总成本（15,000）——
    { cat: 'labor', sub: 'wage',       amountYuan: 12000 },
    { cat: 'labor', sub: 'social',     amountYuan: 1500 },
    { cat: 'labor', sub: 'dorm',       amountYuan: 800 },
    { cat: 'labor', sub: 'meal',       amountYuan: 500 },
    { cat: 'labor', sub: 'uniform',    amountYuan: 200 },
    { cat: 'labor', sub: 'other',      amountYuan: 0 },
    // —— 营销推广费（7,240）——
    { cat: 'market', sub: 'takeout_commission',  amountYuan: 3600 },
    { cat: 'market', sub: 'takeout_delivery',    amountYuan: 1200 },
    { cat: 'market', sub: 'takeout_subsidy',     amountYuan: 1500 },
    { cat: 'market', sub: 'takeout_delivery_sub',amountYuan: 300 },
    { cat: 'market', sub: 'takeout_promote',     amountYuan: 400 },
    { cat: 'market', sub: 'groupbuy_commission', amountYuan: 240 },
    { cat: 'market', sub: 'other',               amountYuan: 0 },
    // —— 其他支出（300）——
    { cat: 'other_exp', sub: 'bookkeeping', amountYuan: 300 },
    { cat: 'other_exp', sub: 'misc',       amountYuan: 0 },
  ],
  directCostYuan: 22000, // 当月食材耗材总消耗（老板直接填）
  expected: {
    income: 64000, expense: 32840,
    gross: 42000, grossMargin: 65.625,
    bizRef: 9160, full: 9160,
  },
};

// ===================== S2：库存 + 摊销（口径锁验证）2026-08 =====================
// 收入与费用同 S1；开启库存倒轧 + 3 条摊销并行。
const S2 = {
  month: '2026-08',
  inventoryOn: true,
  beginInvYuan: 5000, purchaseYuan: 25000, endInvYuan: 7000, // 倒轧真实消耗 = 23,000
  amortYuan: 4683.33, // 3 条资产并行（见 amortAssets）
  incomes: S1.incomes,
  expenses: S1.expenses,
  directCostYuan: 22000, // ⚠️ 口径锁：仍用直接填值，不改用倒轧 23,000
  // S2 主 3 条摊销资产（2026-08 当月摊销合计 = 4,683.33）
  amortAssets: [
    { name: '装修',  valueYuan: 120000, startMonth: '2026-01', totalMonths: 36, testGroup: 'S2' },
    { name: '加盟费', valueYuan: 30000,  startMonth: '2026-03', totalMonths: 24, testGroup: 'S2' },
    { name: '冰柜',  valueYuan: 6000,   startMonth: '2026-06', totalMonths: 60, testGroup: 'S2' },
  ],
  expected: {
    realCost: 23000, amort: 4683.33,
    bizRef: 9160, full: 3476.67, diff: 5683.33,
  },
};

// ===================== S2b：摊销边界（中途终止 + 到期停止）=====================
// 与 S2 三条独立，仅用于验收项 21/22。
const S2b = {
  assets: [
    // 中途终止：实际摊销区间 2026-01 ~ 2026-08（8 期），次月起=0，残值转处置损失
    { name: '旧空调',   valueYuan: 12000, startMonth: '2026-01', totalMonths: 36, terminateMonth: '2026-08', testGroup: '2b' },
    // 自然到期：实际摊销区间 2026-01 ~ 2026-12（12 期），2027-01 起=0
    { name: '招牌制作', valueYuan: 6000,  startMonth: '2026-01', totalMonths: 12, testGroup: '2b' },
  ],
  expected: {
    oldAC_2026_01: 333.33, oldAC_2026_08: 333.33, oldAC_2026_09: 0, oldAC_2027_01: 0,
    oldAC_residual: 9333.36,
    sign_2026_01: 500, sign_2026_12: 500, sign_2027_01: 0,
  },
};

// ===================== S3：菜品成本卡（M3）=====================
// 验证：单份成本 / 批量预制 BOM / 2 层嵌套 / 循环拦截 / 快照 / 手动刷新 / 倒推售价。
const S3 = {
  // 原料档案（先录入，11 条）
  materials: [
    { name: '鸡胸肉',   unit: '斤', priceYuan: 15, conv: 500, yield: 90 },
    { name: '花生米',   unit: '斤', priceYuan: 10, conv: 500, yield: 100 },
    { name: '干辣椒',   unit: '斤', priceYuan: 20, conv: 500, yield: 100 },
    { name: '葱姜蒜',   unit: '斤', priceYuan: 5,  conv: 500, yield: 100 },
    { name: '调料油',   unit: '斤', priceYuan: 10, conv: 500, yield: 100 },
    { name: '牛油',     unit: '斤', priceYuan: 20, conv: 500, yield: 100 },
    { name: '花椒',     unit: '斤', priceYuan: 40, conv: 500, yield: 100 },
    { name: '豆瓣酱',   unit: '斤', priceYuan: 8,  conv: 500, yield: 100 },
    { name: '香料',     unit: '斤', priceYuan: 60, conv: 500, yield: 100 },
    { name: '时蔬拼盘', unit: '斤', priceYuan: 3,  conv: 500, yield: 100 },
    { name: '肉丸',     unit: '斤', priceYuan: 20, conv: 500, yield: 100 },
  ],
  cards: {
    // 宫保鸡丁：单份，损耗 5%，辅料 0.5 元/份，售价 28
    gongbao: {
      name: '宫保鸡丁', mode: 'single', category: '热菜', lossPct: 5, auxYuan: 0.5, saleYuan: 28,
      items: [
        { name: '鸡胸肉', amount: 200, netCost: 0.0333 },  // 15/500/0.9 → netCostPerGram 4位小数=0.0333（纪律锁定，非裸浮点 0.03333…）
        { name: '花生米', amount: 50,  netCost: 0.02 },    // 10/500/1.0
        { name: '干辣椒', amount: 10,  netCost: 0.04 },    // 20/500
        { name: '葱姜蒜', amount: 30,  netCost: 0.01 },    // 5/500
        { name: '调料油', amount: 20,  netCost: 0.02 },    // 10/500
      ],
      expected: { total: 9.75, gross: 18.25, margin: 65.18, reverse60: 24.38 },
    },
    // 红油底料：批量预制，损耗 0%，辅料 2 元(整批)，产出 10 份
    hongyou: {
      name: '红油底料', mode: 'batch', category: '酱料', lossPct: 0, auxYuan: 2.0, batchShares: 10,
      items: [
        { name: '牛油',   amount: 500, netCost: 0.04 },   // 20/500
        { name: '干辣椒', amount: 200, netCost: 0.04 },   // 20/500
        { name: '花椒',   amount: 50,  netCost: 0.08 },   // 40/500
        { name: '豆瓣酱', amount: 300, netCost: 0.016 },  // 8/500
        { name: '香料',   amount: 50,  netCost: 0.12 },   // 60/500
      ],
      expected: { batchTotal: 44.80, perShare: 4.48 },
      // 保存后自动生成的虚拟原料（is_virtual=true，单位 份，单价=单份半成品成本）
      virtual: { name: '红油底料', unit: '份', priceYuan: 4.48, conv: 1 },
    },
    // 麻辣香锅：单份，损耗 3%，辅料 0.5 元/份，售价 38，引用红油底料虚拟原料(1份@4.48)
    mala: {
      name: '麻辣香锅', mode: 'single', category: '热菜', lossPct: 3, auxYuan: 0.5, saleYuan: 38,
      items: [
        { name: '红油底料', amount: 1,   netCost: 4.48 },  // 虚拟原料，单位 份
        { name: '时蔬拼盘', amount: 500, netCost: 0.006 }, // 3/500
        { name: '肉丸',     amount: 100, netCost: 0.04 },  // 20/500
      ],
      expected: { total: 12.35, gross: 25.65, margin: 67.50 },
    },
  },
  // 刷新测试（3-R）：鸡胸肉采购单价 15→20 元/斤 后，对宫保鸡丁点「同步至原料最新价格」
  refresh: {
    // 新净料每克成本 = 20 / 500 / 0.9 = 0.04444...
    gongbaoUpdatedItem: { name: '鸡胸肉', amount: 200, netCost: 0.0444 }, // 20/500/0.9 → netCostPerGram 4位小数=0.0444（纪律锁定，非裸浮点 0.04444…）
    expectedV2: 12.08,
  },
  // 循环引用测试（3.5）：半成品 A 引用 B，B 引用 A
  cycle: { A: ['B'], B: ['A'] },
};

// ===================== S4：选址盈利沙盘（M2）=====================
// 验证：保本 / 目标利润 / 日均 / 边际贡献率 / 实时重算。
const S4 = {
  schemeName: 'A 铺面选址测试',
  includeAmort: false, simAmortYuan: 0,
  rentYuan: 8000, propertyYuan: 500, laborYuan: 12000, otherYuan: 800,
  varFoodPct: 35, varMktPct: 8, varOtherPct: 2,
  targetProfitYuan: 15000,
  expected: {
    fixed: 21300, compositeVar: 45, margin: 55,
    breakEvenMonthly: 38727.27, breakEvenDaily: 1290.91,
    targetMonthly: 66000, targetDaily: 2200, redAlert: false,
  },
};

module.exports = { S1, S2, S2b, S3, S4 };
