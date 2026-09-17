/**
 * 店算小程序 · 外显文案表
 *
 * 目标路径（小程序内）：miniprogram/i18n/terms.js
 * 当前位置（规范草案）：specs/dev-specs/i18n/terms.js
 *
 * 📄 唯一来源：`_parse/外显话术库与按钮文案_v1.1.md`（2026-09-10 四词拍板定稿）
 * 📐 规范依据：`06_工程治理与运维规范` §9.3 术语双轨表 / §9.3.1 四词拍板结果
 *
 * ⚠️ 写码铁律（违反即返工）：
 *   1. 代码 / 数据库 / 云函数**沿用内部术语**（选址盈利沙盘 / 月度盈利核算 / 菜品成本卡 /
 *      专业模式 / 回本周期），保证与规范一致、可检索。
 *   2. **只有页面文案层**做映射 —— 用户看到的永远是本表的"外显词"。
 *   3. **禁止硬编码**在 wxml / wxss，一律从本表取词，一处修改全局生效。
 *   4. **付费按钮必须带功能名**（如「开通真实利润」），❌ 禁裸「开通会员」「立即订阅」。
 *   5. 出现 投资回报 / 回本周期 / 收益率 / ROI / 盈利 / 赚钱 / 理财 / 订阅 / 会员费
 *      → 一律拦截改词（见本表 forbidden）。
 */

const TERMS = {
  // ===== 一、模块名与入口 =====
  modules: {
    m1: {
      internal: '月度盈利核算',
      display: '月度经营',
      subtitle: '每月到底能剩多少，一算就清楚',
      cardTitle: '月度经营',
    },
    m2: {
      internal: '选址盈利沙盘',
      display: '开店测算',
      subtitle: '先算清这家店能不能开，再掏钱',
      cardTitle: '开店测算',
    },
    m3: {
      internal: '菜品成本卡',
      display: '成本卡',
      subtitle: '一道菜成本多少、卖多少不亏，自动算',
      cardTitle: '成本卡',
      itemTitle: (dishName) => `${dishName} 成本卡`,
    },
  },

  // ===== 二、M1 双口径 tab（写码前必须做）=====
  m1Tabs: {
    free: { key: 'bizRef', internal: '经营参考利润', display: '经营参考估算' },
    paid: { key: 'full', internal: '专业模式·全要素真实利润', display: '真实利润' },
  },

  // ===== 三、按钮文案 =====
  buttons: {
    addShop: '+ 新增店铺', // M1，免费限 1 家，第 2 家触发 paywall.saveLimit
    addCostCard: '+ 新增成本卡', // M3，免费限 3 张，第 4 张触发 paywall.saveLimit
    save: '保存',
    calc: '算一算', // 不叫"计算盈利"
    export: '导出 / 打印', // 免费禁，触发 paywall.export
    unlockPro: '开通真实利润', // ⭐ 主按钮，必须带功能名
    unlockAll: '开通完整功能',
    cancel: '取消',
    thinkAgain: '再想想',
  },

  // ===== 四、付费弹窗（仅两类触发：保存超限 / 导出）=====
  paywall: {
    saveLimit: {
      title: '已达免费上限',
      content:
        '免费版可建 1 家店铺 / 3 张成本卡。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。',
      primary: '开通真实利润', // 跳套餐页
      secondary: '再想想',
    },
    export: {
      title: '导出需开通',
      content: '开通真实利润后可导出 / 打印成本卡与经营报表。',
      primary: '开通真实利润',
      secondary: '取消',
    },
    // 内部/开发读：弹窗逻辑内部叫"付费墙"，界面只说"开通/升级解锁"。
    // M2 永不弹窗。按钮必须带功能名（铁律4）。
  },

  // ===== 五、免费页防流失标注（M1 必做）=====
  freeHint:
    '当前为经营参考估算（按你直接填的消耗）。开通真实利润，可用库存倒轧算真实消耗，结果更准。',

  // ===== 六、结果页术语替换 =====
  result: {
    netMargin: '净收益占比', // 内部：净利率
    grossMargin: '毛利率', // ✅ 安全，直接用
    breakeven: '保本点', // ✅ 安全，直接用
    paybackPrefix: '按当前数据，约',
    paybackSuffix: '可收回投入', // 内部：回本周期 → 软展示"约 X 个月收回投入"
    m2Conclusion: (amount) => `按你填的数，这家店每月大概能剩 ¥${amount}`,
  },

  // ===== 七、应用信息（上架审核）=====
  app: {
    title: '开店算账',
    intro: '开店算账工具，算清每月能剩多少', // ⭐ 2026-09-10 拍板
    category: '工具 → 效率', // 禁选 金融 / 理财
  },

  // ===== 八、禁用词（供 lint / code review 对照，不参与渲染）=====
  forbidden: [
    { word: '投资回报 / ROI', reason: '金融类目红线', replace: '(不出现)' },
    { word: '回本周期', reason: '金融色彩重', replace: '收回投入期' },
    { word: '收益率 / 利润率', reason: '金融暗示', replace: '收益占比 / 净收益占比' },
    { word: '盈利 / 赚钱 / 躺赚', reason: '收益承诺', replace: '经营测算 / 能剩多少' },
    { word: '投资 / 理财 / 股', reason: '金融类目', replace: '(不出现)' },
    { word: '付费 / 订阅 / 会员费', reason: '触发虚拟支付审核', replace: '开通 / 升级解锁' },
  ],

  // ===== 九、审核规避话术（客服 / 页面）=====
  auditSafe: {
    subscribePitch: '开通真实利润后，可用库存倒轧算得更准', // ❌"订阅会员享盈利分析"
    supportScript: '开通真实利润后，可用更精细的核算方式', // ❌"付费解锁盈利功能"
    disclaimer: '本工具计算结果仅供参考，不构成任何投资、经营决策建议。请结合门店实际情况判断。',
  },

  // ===== 十、批次 4 页面通用文案（补录，避免 wxml 硬编码）=====
  ui: {
    shopName: '当前店铺',
    defaultShopName: '我的店铺',
    settings: '设置',
    loading: '加载中…',
    save: '保存',
    cancel: '取消',
    all: '全部',
    back: '返回',
    income: '收入',
    expense: '费用',
    consume: '食材消耗',
    inventory: '库存',
    amortize: '摊销资产',
    result: '结果',
    month: '月份',
    history: '历史月份',
    totalRevenue: '营业收入',
    totalExpense: '总费用',
    directConsume: '直接填消耗',
    grossProfit: '毛利',
    grossMarginRate: '毛利率',
    realConsume: '真实消耗',
    effectiveAmortize: '当月摊销',
    netRef: '经营参考利润',
    netTrue: '真实利润',
    profitDiff: '两口径差异',
    pendingArchive: '待归档',
    archivedLock: '归档月只读',
    graceArchive: '归档后 7 天内可补录（需确认）',
    conclude: '本月结果',
    confirmArchive: '确认结账并归档该月？归档后默认只读（7 天内仍可补录）。',
    currencySymbol: '¥',
    loadFailed: '加载失败',
    opFailed: '操作失败',
    noResponse: '服务无响应',
    unlockLater: '开通功能将在后续版本开放',
  },

  // ===== 十一、批次 4 页面级按钮/链接（补录）=====
  nav: {
    goInput: '录入收入·费用·消耗',
    goInventory: '录入库存（期初/采购/期末）',
    goAmortize: '管理摊销资产',
    goResult: '查看结果',
    addAsset: '新增摊销资产',
    addCard: '+ 新增成本卡',
    viewVersion: '版本历史',
    syncPrice: '同步至原料最新价',
    calcReverse: '反算售价',
    archiveNow: '结账并归档',
  },

  // ===== 十二、M1 收入/费用分类模板（MVP 固定结构；金额一律「元」界面输入 → 适配层转「分」）=====
  ledger: {
    incomeTitle: '收入',
    expenseTitle: '费用',
    income: [
      { category: 'dine_in',   label: '堂食收入' },
      { category: 'takeaway',  label: '外卖收入' },
      { category: 'other',     label: '其他收入' },
    ],
    expense: [
      { category: 'rent',      label: '房租租金' },
      { category: 'labor',     label: '人员工资' },
      { category: 'utility',   label: '水电物业' },
      { category: 'other',     label: '其他杂费' },
    ],
    subItem: '细项',
    amount: '金额（元）',
    directConsume: '食材消耗合计（元）',
    directConsumeHint: '关闭了库存核算时，直接填本月食材消耗总额。',
  },

  // ===== 十三、M2 开店测算文案 =====
  m2: {
    inputTitle: '填写开店投入',
    conclPrefix: '按你填的数，这家店每月大概能剩',
    currencySymbol: '¥',
    rent: '月房租（元）',
    property: '物业费（元）',
    labor: '固定人工合计（元）',
    other: '其他固定杂费（元）',
    includeAmort: '含模拟摊销',
    simAmort: '模拟月摊销（元）',
    varFood: '菜品变动成本率（%）',
    varMkt: '营销费用率（%）',
    varOther: '其他变动率（%）',
    targetProfit: '目标月利润（元）',
    calc: '开始测算',
    fixedTotal: '固定成本合计',
    compositeVar: '综合变动成本率',
    marginRate: '边际贡献率',
    breakEvenMonthly: '保本月营业额',
    breakEvenDaily: '保本日均',
    targetMonthly: '目标利润月营收',
    targetDaily: '目标利润日均',
    redAlert: '当前结构无法盈利',
    redAlertHint: '综合变动成本率达到或超过 100%，请调整成本结构。',
    yuanSuffix: '元/月',
    daySuffix: '元/天',
  },

  // ===== 十四、M3 成本卡页面文案 =====
  card: {
    listTitle: '成本卡',
    dishName: '菜品名称',
    category: '成本分类',
    totalCost: '单份成本',
    price: '建议售价',
    grossMargin: '毛利率',
    calcModeA: '单份',
    calcModeB: '批量预制',
    batchOutput: '本批产出份数',
    lossRate: '制作损耗率（%）',
    auxAmount: '辅料分摊（元）',
    calcMode: '核算模式',
    material: '原料',
    qty: '用量（g/份）',
    delete: '删除',
    save: '保存成本卡',
    addLine: '+ 添加明细行',
    reverseTitle: '反算售价',
    reverseHint: '输入目标毛利率，反推建议售价',
    targetMargin: '目标毛利率（%）',
    reverseResult: '建议售价',
    copyVersion: '生成新版本',
    hintAlways: '提示：理论配方成本 ≠ 真实门店毛利。',
    versionHistory: '版本历史',
    version: '版本',
    empty: '还没有成本卡，点下方新增',
    oldVersionNote: '历史版本（只读）',
    syncNote: '同步后将按原料最新价生成新版本，旧版本保留可查。',
    syncPrice2: '同步至最新价',
    versionCreatedAt: '保存时间',
    versionCostDiff: '成本变化',
    versionLines: '配方明细',
    versionReadonly: '历史版本只读，不可编辑',
    dishNamePh: '如 宫保鸡丁',
  },

  // ===== 十五、M1 库存录入页（shop_inventory）=====
  inventoryPage: {
    title: '库存盘点',
    opening: '期初库存',
    openingHint: '月初食材库存总价值（元）',
    purchase: '本月采购',
    purchaseHint: '本月采购入库总价值（元）',
    closing: '期末盘点',
    closingHint: '月末盘点剩余库存总价值（元）',
    save: '保存库存',
    hintFormula: '保存后由服务端按库存倒轧计算真实消耗。',
  },

  // ===== 十六、M1 摊销资产页（shop_amortize）=====
  amortizePage: {
    title: '摊销资产',
    monthTotal: '当月摊销合计',
    add: '新增资产',
    name: '资产名称',
    value: '原值（元）',
    startMonth: '开始月份',
    totalMonths: '总月数（月）',
    terminateMonth: '终止月份（可选）',
    monthAmount: '当月摊销',
    monthAmountShort: '月摊销',
    terminateNow: '提前报废',
    confirmTerminate: '确认提前报废该资产？未摊余额将作为处置损失计入。',
    save: '保存资产',
    edit: '编辑',
    empty: '还没有摊销资产，点下方新增',
    namePh: '如 装修、设备',
    monthUnit: '月',
    optional: '可选',
  },

  // ===== 十七、M1 结果展示页 =====
  resultPage: {
    title: '经营结果',
    monthTotal: '本月总览',
    income: '营业收入',
    expense: '费用合计',
    grossProfit: '毛利',
    grossMargin: '毛利率',
    materialCost: '食材成本',
    realConsume: '真实消耗',
    effectiveAmortize: '当月摊销',
    refProfit: '经营参考估算',
    trueProfit: '真实利润',
    profitDiff: '口径差异',
    refNote: '按直接填写的消耗估算',
    trueNote: '按库存倒轧 + 摊销核算',
    archiveLocked: '归档月只读，无法修改',
  },

  // ===== 十八、店铺设置页 =====
  settings: {
    title: '店铺设置',
    shopName: '店铺名称',
    shopNamePh: '如 老王川菜馆',
    remark: '备注',
    remarkPh: '选填，如 门店地址、主营品类',
    inventorySwitch: '库存核算',
    inventorySwitchDesc: '开启后按「期初 + 采购 − 期末」倒轧真实消耗',
    amortizeSwitch: '摊销核算',
    amortizeSwitchDesc: '开启后将摊销资产按月分摊计入费用',
    save: '保存设置',
    saved: '已保存',
  },

  // ===== 十九、M1 录入页（收入/费用/消耗）=====
  inputPage: {
    title: '月度录入',
    archiveReadonly: '归档月只读',
    graceNote: '归档后 7 天内可补录（需二次确认）',
    saveArchiveOverride: '保存（归档补录）',
    confirmGraceSave: '该月已归档，仍在 7 天宽限期内。确认按补录保存？',
    confirmLocked: '该月已归档且超过宽限期，仅可查看。',
  },

  // ===== 二十、M2 结果红警与结论 =====
  sandboxResult: {
    conclusionPrefix: '按你填的数，这家店每月大概能剩',
    conclusionSuffix: '元',
    redAlert: '当前结构无法盈利',
    redAlertHint: '综合变动成本率达到或超过 100%，请调整成本结构后重试。',
    inputs: '你的输入',
    outputs: '测算结果',
    noCalc: '填写上方参数后点击测算',
  },

  // ===== 二十二、批次 5 付费全流程文案 =====
  pay: {
    // 支付结果
    successTitle: '已开通',
    successBody: (dateStr) => `有效期至 ${dateStr}`,
    failTitle: '未完成',
    failBody: '未收到支付结果，可重试或联系客服。',
    retry: '重试',
    contactService: '联系客服开通',
    contactServiceHint: '当前为私域开通阶段，请联系客服完成开通。',
    // 订单记录页
    orderTitle: '订单记录',
    orderNo: '订单号',
    plan: '套餐',
    amount: '金额',
    channel: '支付方式',
    status: '状态',
    statusPaid: '已支付',
    statusPending: '待支付',
    statusManual: '待客服开通',
    paidAt: '支付时间',
    empty: '还没有订单',
    expireInfo: '当前有效期至',
    renew: '续费',
    // 到期提醒（双渠道：订阅消息 + 结果页常驻提示条）
    expireSoonTitle: '即将到期',
    expireSoonBody: (days) => `您的真实利润将在 ${days} 天后到期，续费后有效期自动累加。`,
    renewEntry: '去续费',
    subscribeTip: '到期提醒：授权后可接收订阅消息提醒',
    subscribeDenied: '未授权到期提醒，仍可在本页看到到期提示',
    // 权限 tab
    paidTabAvailable: '真实利润',
    freeTabHint: '当前为经营参考估算（按你直接填的消耗）。开通真实利润，可用库存倒轧算真实消耗，结果更准。',
    expiredLocked: '权限已到期，已回落到经营参考估算。历史数据仍可查看，续费后立即恢复。',
    // 弹窗动作
    goPay: '去下单',
    goOrders: '查看订单',
    goRenew: '去续费',
  },

  // ===== 二十三、批次 7 体验打磨文案 =====
  exp: {
    // 校验
    required: (label) => `${label}不能为空`,
    moneyNeg: (label) => `${label}不能为负`,
    moneyReq: (label) => `${label}必须填写`,
    monthFormat: (label) => `${label}格式应为 YYYY-MM`,
    positiveInt: (label) => `${label}必须为正整数`,
    pctMax100: (label) => `${label}不能超过 100`,
    dateFormat: (label) => `${label}格式应为 YYYY-MM-DD`,
    // loading / 防重复提交
    submitting: '提交中…',
    loading: '加载中…',
    // 店铺切换
    switchTitle: '切换店铺',
    currentShop: '当前店铺',
    noShop: '还没有店铺',
    addShop: '+ 新增店铺',
    switchHint: '切换店铺不会触发任何付费弹窗；免费版可建 1 家店铺。',
    // 导出
    exportTitle: '导出数据',
    exportIng: '正在导出…',
    exportDone: '导出完成',
    exportScopeM1: '月度报表',
    exportScopeM3: '成本卡批量',
    exportFormatExcel: 'Excel',
    exportFormatJson: 'JSON',
    exportNeedPaid: '导出需开通真实利润',
    // 隐私合规
    privacyTitle: '用户隐私保护指引',
    privacyAgree: '同意并继续',
    privacyDisagree: '暂不同意',
    privacyNeed: '使用前需同意隐私协议；不同意将无法使用完整功能。',
    privacyOpen: '查看隐私协议',
    privacyRevoke: '撤回授权',
    privacyRevoked: '已撤回授权',
    goSetting: '去设置',
    fileSaved: '文件已保存',
    viewFile: '查看文件',
    // 注销
    mineTitle: '我的',
    account: '账号与安全',
    logoutTitle: '注销账号',
    logoutConfirm: '注销后您的账号数据将被匿名化处理，且无法恢复。确定注销吗？',
    logoutDone: '已提交注销申请，我们将于 15 个工作日内完成数据处理。',
    cancelLogout: '暂不注销',
    dataCleanNote: '历史数据不硬删，优先软删恢复 + 周备份（保留 30 天）。',
    // 日志脱敏
    privacyDesc: '本工具仅收集登录所需 openid / 昵称头像等必要信息，用于账号识别与数据同步；不含手机号、支付信息等敏感数据。',
  },

  // ===== 二十四、导出按钮（付费墙触发）=====
  exportBtn: {
    m1Report: '导出月度报表',
    m3Cards: '导出成本卡',
  },

  // ===== 二十五、批次 8 UI 走查修复（2026-09-18）=====
  uiFix: {
    // 修 1：result 页空态（无账本 / 接口异常 → 中性表述，不写死"没有数据"）
    resultEmpty: '本月还没有账本，先去录入收入与费用吧',
    resultEmptyGoInput: '去录入',
    // 修 3：month/index 月份空值占位
    monthEmpty: '暂无账本',
    // 修 4：input 页「食材消耗」小节标题与字段标签拆开
    directConsumeSec: '食材消耗',
    directConsumeField: '食材消耗合计（元）',
  },
};

/**
 * 取值助手：t('buttons.save') / t('modules.m1.display')
 * @param {string} path 点分路径
 */
function t(path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), TERMS);
}

/**
 * 错误码 → 前端展示文案映射（唯一来源，禁止在 wxml/wxss 硬编码中文提示）
 *
 * ⚠️ 易错点（务必按此取值）：
 *   后端返回的是 **wire code**（如 UNAUTHORIZED / FREE_LIMIT_EXCEEDED，见 core/09 §1）；
 *   而本表键是 **i18n key**（如 ERR.UNAUTHORIZED / ERR.FREE_LIMIT，见 core/09 §3）。
 *   两者**不是同一个东西** —— 直接写 ERROR_MESSAGES[res.code] 会**永远 miss**，
 *   导致所有业务提示都被吞成「系统异常，请稍后重试」。必须先经 CODE_TO_I18N 转一次：
 *     const msg = msgOf(res.code);                                          // ✅ 推荐
 *     const msg = ERROR_MESSAGES[CODE_TO_I18N[res.code] || 'ERR.SYSTEM'];   // ✅ 等价
 *     const msg = ERROR_MESSAGES[res.code] || ERROR_MESSAGES['ERR.SYSTEM']; // ❌ 永远 miss
 *
 * 与 core/09_统一错误码表.md §3 同步锁死；双向一致性由 prototype/check_error_codes.js 机械校验。
 */
const ERROR_MESSAGES = {
  OK: '',
  'ERR.UNAUTHORIZED': '请先登录后再试',
  'ERR.USER_NOT_FOUND': '账号信息异常，请联系客服',
  'ERR.FORBIDDEN': '无权访问该数据',
  'ERR.RATE_LIMITED': '操作太频繁，请稍后再试',
  'ERR.INVALID_PARAM': '填写有误，请检查后重试',
  'ERR.RESOURCE_NOT_FOUND': '数据不存在或已被删除',
  'ERR.SOFT_DELETED': '该数据已删除',
  'ERR.ARCHIVED_LOCKED': '归档月份为只读，不可修改',
  'ERR.SNAPSHOT_IMMUTABLE': '历史快照不可修改',
  'ERR.FREE_LIMIT': '已达免费上限，开通后解锁',
  'ERR.HARD_CAP': '已达系统上限，请联系客服',
  'ERR.FEATURE_LOCKED': '该功能需开通后使用',
  'ERR.PLAN_MISMATCH': '套餐信息异常，请联系客服',
  'ERR.BOM_CYCLE': '检测到循环引用，请调整配方',
  'ERR.BOM_DEPTH': '配方嵌套层数过多',
  'ERR.M2_RED_ALERT': '当前结构下难以盈利，请调整方案',
  'ERR.PAY_FAILED': '支付失败，请重试',
  'ERR.PAY_PENDING': '支付处理中，请稍候',
  'ERR.ORDER_NOT_FOUND': '订单不存在',
  'ERR.REFUND_FAILED': '退款失败，请联系客服',
  'ERR.REFUND_NOT_ALLOWED': '当前订单不可退款',
  'ERR.ADMIN_AUTH': '管理员验证失败',
  'ERR.ADMIN_TOKEN_EXPIRED': '登录已过期，请重新登录',
  'ERR.ADMIN_LOCKED': '账号已锁定，请 30 分钟后再试',
  'ERR.ADMIN_PERM': '权限不足',
  'ERR.ADMIN_INITED': '后台已完成初始化，无需重复操作',
  'ERR.SYSTEM': '系统异常，请稍后重试',
  'ERR.NOT_IMPL': '功能暂未开放',
};

/**
 * wire code（core/09 §1 的 code 列）→ i18n key（core/09 §3 的 i18n key 列 / 本表 ERROR_MESSAGES 键）
 *
 * ⚠️ 新增错误码必须**三处同步**：core/09 §1 表 + core/09 §3 表 + 本表 ERROR_MESSAGES 键。
 *    三者由 prototype/check_error_codes.js 做双向断言，任一处漏改会直接报 fail。
 */
const CODE_TO_I18N = {
  // 1.1 基础 / 鉴权
  SUCCESS: 'OK',
  UNAUTHORIZED: 'ERR.UNAUTHORIZED',
  USER_NOT_FOUND: 'ERR.USER_NOT_FOUND',
  FORBIDDEN: 'ERR.FORBIDDEN',
  RATE_LIMITED: 'ERR.RATE_LIMITED',
  INVALID_PARAM: 'ERR.INVALID_PARAM',
  // 1.2 资源 / 业务状态
  RESOURCE_NOT_FOUND: 'ERR.RESOURCE_NOT_FOUND',
  SOFT_DELETED: 'ERR.SOFT_DELETED',
  ARCHIVED_LOCKED: 'ERR.ARCHIVED_LOCKED',
  SNAPSHOT_IMMUTABLE: 'ERR.SNAPSHOT_IMMUTABLE',
  // 1.3 配额 / 付费
  FREE_LIMIT_EXCEEDED: 'ERR.FREE_LIMIT',
  HARD_CAP_EXCEEDED: 'ERR.HARD_CAP',
  FEATURE_LOCKED: 'ERR.FEATURE_LOCKED',
  PLAN_MISMATCH: 'ERR.PLAN_MISMATCH',
  // 1.4 M2/M3 算法
  BOM_CYCLE_DETECTED: 'ERR.BOM_CYCLE',
  BOM_DEPTH_EXCEEDED: 'ERR.BOM_DEPTH',
  M2_RED_ALERT: 'ERR.M2_RED_ALERT',
  AMORT_TERMINATED: 'OK',
  // 1.5 支付 / 订单 / 退款
  PAY_FAILED: 'ERR.PAY_FAILED',
  PAY_PENDING: 'ERR.PAY_PENDING',
  ORDER_NOT_FOUND: 'ERR.ORDER_NOT_FOUND',
  ORDER_DUPLICATE: 'OK',
  REFUND_FAILED: 'ERR.REFUND_FAILED',
  REFUND_NOT_ALLOWED: 'ERR.REFUND_NOT_ALLOWED',
  // 1.6 管理端
  ADMIN_AUTH_FAILED: 'ERR.ADMIN_AUTH',
  ADMIN_TOKEN_EXPIRED: 'ERR.ADMIN_TOKEN_EXPIRED',
  ADMIN_LOCKED: 'ERR.ADMIN_LOCKED',
  ADMIN_PERMISSION_DENIED: 'ERR.ADMIN_PERM',
  ADMIN_OP_IDEMPOTENT: 'OK',
  ADMIN_ALREADY_INIT: 'ERR.ADMIN_INITED',
  // 1.7 系统
  SYSTEM_ERROR: 'ERR.SYSTEM',
  NOT_IMPLEMENTED: 'ERR.NOT_IMPL',
};

/**
 * 取值助手：wire code → 前端展示文案；未知码回落 ERR.SYSTEM。
 * 用法：const msg = msgOf(res.code);
 */
function msgOf(code) {
  const key = CODE_TO_I18N[code] || 'ERR.SYSTEM';
  return ERROR_MESSAGES[key] || ERROR_MESSAGES['ERR.SYSTEM'];
}

module.exports = { TERMS, t, ERROR_MESSAGES, CODE_TO_I18N, msgOf };
