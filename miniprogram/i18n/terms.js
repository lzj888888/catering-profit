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
    // 📌 2026-09-20 用户拍板改名（真机走查后）：外显词改长名，internal 术语不动（术语双轨）。
    //    navTitle = 导航栏短版（微信导航栏约 10 字即截断，长名只用于首页卡片/列表）。
    m1: {
      internal: '月度盈利核算',
      display: '月度盈利核算',
      navTitle: '月度盈利核算',
      subtitle: '每月到底能剩多少，一算就清楚',
      cardTitle: '月度盈利核算',
    },
    m2: {
      internal: '选址盈利沙盘',
      display: '开店盈亏平衡点测算',
      navTitle: '开店盈亏平衡测算',
      subtitle: '先算清这家店能不能开，再掏钱',
      cardTitle: '开店盈亏平衡点测算',
    },
    m3: {
      internal: '菜品成本卡',
      display: '菜品成本毛利核算',
      navTitle: '菜品成本毛利核算',
      subtitle: '一道菜成本多少、卖多少不亏，自动算',
      cardTitle: '菜品成本毛利核算',
      itemTitle: (dishName) => `${dishName} 成本毛利`,
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
    addCostCard: '+ 新增菜品', // M3，免费张数由配置下发（plan_free.limits），超限触发 paywall.saveLimit
    save: '保存',
    calc: '算一算', // 不叫"计算盈利"
    export: '导出 / 打印', // 免费禁，触发 paywall.export
    unlockPro: '开通真实利润', // ⭐ 主按钮，必须带功能名
    cancel: '取消',
    thinkAgain: '再想想',
    gotIt: '知道了', // R45：iOS 拦截提示的唯一按钮（不给"去开通"动作）
  },

  // ===== 四、付费弹窗（仅两类触发：保存超限 / 导出）=====
  paywall: {
    saveLimit: {
      title: '已达免费上限',
      content:
        '免费版可建 1 家店铺、菜品数量有限。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。',
      primary: '开通真实利润', // 跳套餐页
      secondary: '再想想',
    },
    export: {
      title: '导出需开通',
      content: '开通真实利润后可导出 / 打印菜品成本与经营报表。',
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
    grossMargin: '毛利率', // ✅ 安全，直接用
    paybackSuffix: '可收回投入', // 内部：回本周期 → 软展示"约 X 个月收回投入"
    m2Conclusion: (amount) => `按你填的数，这家店每月大概能剩 ¥${amount}`,
  },

  // ===== 七、应用信息（上架审核）=====
  app: {
    title: '开店算账',
    category: '工具 → 效率', // 禁选 金融 / 理财
  },

  // ===== 八、禁用词（供 lint / code review 对照，不参与渲染）=====
  forbidden: [
    { word: '投资回报 / ROI', reason: '金融类目红线', replace: '(不出现)' },
    { word: '回本周期', reason: '金融色彩重', replace: '收回投入期' },
    { word: '收益率 / 利润率', reason: '金融暗示', replace: '收益占比 / 净收益占比' },
    // ⚠️ 2026-09-20 用户拍板豁免：「月度盈利核算」作为**模块名**为唯一例外（首页卡片 + 导航栏）。
    //    除该模块名外，其余页面文案仍不得出现「盈利 / 赚钱」（理由：收益承诺，易被判收益暗示）。
    { word: '盈利 / 赚钱 / 躺赚', reason: '收益承诺', replace: '经营测算 / 能剩多少',
      exception: '模块名「月度盈利核算」（用户 2026-09-20 拍板，不含其他任何位置）' },
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
    totalExpense: '费用合计',
    directConsume: '直接填消耗',
    grossProfit: '毛利',
    realConsume: '真实消耗',
    effectiveAmortize: '当月摊销',
    netRef: '经营参考利润',
    netTrue: '真实利润',
    profitDiff: '两口径差异',
    pendingArchive: '待归档',
    archivedLock: '归档月只读',
    graceArchive: '归档后 7 天内可补录（需确认）',
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
    addCard: '+ 新增菜品',
    viewVersion: '版本历史',
    syncPrice: '同步至原料最新价',
    archiveNow: '结账并归档',
  },

  // ===== 十二、M1 收入/费用分类模板（MVP 固定结构；金额一律「元」界面输入 → 适配层转「分」）=====
  ledger: {
    incomeTitle: '收入',
    expenseTitle: '费用',
    // A1/A2（批次 8）：收入/费用为「大类 → 二级细项」两级结构。
    //   收入三大类（S1：堂食43,000 / 外卖20,000 / 其他1,000）；
    //   费用四大类 = 运营 / 人工 / 营销 / 其他（S1：门店10,300 / 人工15,000 / 营销7,240 / 其他300 / 合计32,840）。
    //   营销类细项**团购与外卖佣金分列**（04 核对清单 阶段 2：不合并）。
    income: [
      {
        category: 'dine_in', label: '堂食',
        items: ['现金收款', '微信扫码收款', '支付宝收款', '银行卡/POS刷卡', '储值卡消费', '个人/单位挂账消费', '团购/代金券核销'],
      },
      {
        category: 'takeaway', label: '外卖',
        // 2026-09-20 李老师要求按平台分，方便逐平台对账；每个平台填「商品总价+打包费+商家活动补贴」合计，
        // 仍走总额法（不扣佣金），与 A.2「佣金记营销费用」配套，口径见 incomeScope.takeaway。
        items: ['美团外卖', '淘宝闪购', '京东外卖', '其他外卖'],
      },
      {
        category: 'other', label: '其他业务收入',
        items: ['废品变卖', '预制菜零售'],
      },
    ],
    expense: [
      {
        category: 'operation', label: '运营费用',
        items: ['房租', '物业费', '水费', '电费', '燃气费', '垃圾清运费', '宽带网费'],
      },
      {
        category: 'labor', label: '人工费用',
        items: ['工资绩效', '社保', '员工宿舍', '员工餐', '工装福利'],
      },
      {
        category: 'marketing', label: '营销费用',
        items: ['外卖平台佣金', '外卖配送服务费', '外卖活动补贴', '外卖配送补贴', '外卖推广费', '团购平台佣金', '线上广告推广', '宣传物料印刷', '其他营销费'],
      },
      {
        category: 'other', label: '其他费用',
        items: ['代账费', '其他杂项'],
      },
    ],
    subItem: '细项',
    subItemPh: '细项名称（选填）',
    // 2026-09-21 李老师真机反馈：「堂食下面那些如何填写」文字太长、占地方
    //   ⇒ 每类口径句收进折叠块，默认只留一行引导语，点开看完整口径、再点收回。
    scopeShow: '怎么填？点开看口径',
    scopeHide: '收起口径',
    addSubItem: '+ 添加细项',
    // T4b（round97）：点「+ 添加细项」先弹**该类尚未添加**的预设项清单，避免手打项名；
    //   末位「自定义细项」保留原空白行行为（用户仍可自己起名）。
    presetPickTitle: '加哪一项？',
    presetPickCustom: '自定义细项（自己填名字）',
    presetPickEmpty: '本类预设项都已用上，可加自定义细项',
    // round102（2026-09-22）：展开态底部的「还没加的有：…」只读提示 —— 补上「添加」这条腿的可发现性。
    //   ⚠️ 前缀与顿号分隔符都放这里（单源）；js 只做 join 拼串，页面零硬编码文案。
    presetHintPrefix: '还没加的有：',
    presetHintSep: '、',
    delSubItem: '×',   // 2026-09-20 李老师真机反馈："删除"两字太占地 → 改图标，宽度让给细项名与金额
    amount: '金额（元）',
    classTotalSuffix: '合计', // 折叠时只显示首行 = 整类总额，标签写「XX合计」防误当成某一细项

    // ===== 堂食收入录入模式（2026-09-21 李老师拍板 · 方案 A 严格互斥）=====
    // ⚠️ 方案 A 语义：选「分项」时总额由各渠道相加**自动得出、不可手填** ⇒ 单一数据源，
    //    天然一致，压根不需要「分项之和==总额」的校验（互斥单选下两模式不并存，本就无两值可比）。
    // ⚠️ 模式只存本地（wx.setStorageSync），不动后端契约；换设备/清缓存回默认「快速录入」，
    //    默认值由数据推断（细项行 >1 ⇒ 分项）。
    dineMode: {
      secTitle: '堂食收入怎么填',
      fast: '快速录入',
      fastDesc: '只填一个总数',
      detail: '分项渠道录入',
      detailDesc: '按收款渠道分开填',
      fastField: '堂食总收入',
      fastHint: '当月堂食全部消费营收，店内折扣、会员价按折后成交额填。含现金、微信、支付宝、刷卡、储值买单、挂账消费、团购核销。',
      detailHint: '按收款渠道分开填，下面合计自动算出来。',
      sumLabel: '合计',
      sumAutoHint: '由各渠道相加自动算出，不用手填',
      amtPh: '填金额（元）', // 渠道行改两行后，金额框独占一行、用 placeholder 代替重复的「金额（元）」标签
      addChannel: '+ 添加渠道',
      splitNotice: '总额已暂放在第一行，请按实际拆分到各渠道',
      channelPh: '渠道名称',
    },
    // 渠道口径标注（挂在细项下方小字；由 input.js 预计算挂到 row.note，WXML 直接取）
    channelNotes: {
      '储值卡消费': '储值充值不算收入，只有顾客用余额买单才算',
      '团购/代金券核销': '钱结算在美团/抖音平台、不是当日到账，但按核销当月计入',
    },
    // 渠道别名表（口语叫法 → 正式预设渠道）
    // 🔴 为什么要有（2026-09-21 李老师真机反馈「美团和现金后面有红色X、和上面重复了」）：
    //    老板自己用「+ 添加渠道」加过「美团」「现金」这类口语名 ⇒ 装配时被当成「自定义渠道」
    //    另立两行，于是就出现「上面已经有现金收款/团购核销，下面又冒出美团/现金」的重复行，
    //    同一笔钱看着像两笔。有了别名表，装配时直接并进对应预设行，页面不再重复、金额不丢。
    //    ⚠️ 值必须是上面 dine_in items 里真实存在的渠道名（G11c 守）；不设别名不会被合并。
    channelAliases: {
      '现金': '现金收款',
      '现钞': '现金收款',
      '微信': '微信扫码收款',
      '微信支付': '微信扫码收款',
      '支付宝': '支付宝收款',
      '银行卡': '银行卡/POS刷卡',
      'POS': '银行卡/POS刷卡',
      '刷卡': '银行卡/POS刷卡',
      '储值卡': '储值卡消费',
      '会员卡': '储值卡消费',
      '挂账': '个人/单位挂账消费',
      '签单': '个人/单位挂账消费',
      '团购': '团购/代金券核销',
      '团购券': '团购/代金券核销',
      '美团': '团购/代金券核销',
      '抖音': '团购/代金券核销',
      '代金券': '团购/代金券核销',
    },
    directConsume: '食材消耗合计（元）',
    directConsumeHint: '关闭了库存核算时，直接填本月食材消耗总额。',

    // ===== R85 · 外卖段取数与录入（规范 §A.11，2026-09-22 锁定 · 不改口径）=====
    // 平台名与顺序**只**来自 ledger.income[takeaway].items（页面禁止写死）；营销项名来自
    // collections.js::SEED_EXPENSE_ITEMS(marketing) 单源（terms 此段仅引用展示名，不另立清单）。
    // ⚠️ 配平校验只做软提示：不阻断保存、不参与利润、不写入金额（A.11.7 V1-V3 未验证）。
    takeawayMode: {
      secTitle: '外卖收入怎么填',
      fast: '快速录入',
      fastDesc: '每平台填一个总数',
      detail: '分项录入',
      detailDesc: '商品总价 / 打包费 / 活动补贴分开填',
      fastHint: '每平台填「商品总价 + 打包费 + 商家活动补贴」三项之和这一个数。',
      detailHint: '每个平台填 3 个数，小计自动算出、不用手填。',
      sumLabel: '小计',
      sumAutoHint: '由三项相加自动算出',
      // R119：快速录入汇总 —— 各平台填完后在下方给「合计 + 已填平台数」。合计只回显、不写入金额。
      totalLabel: '各平台合计',
      totalAutoHint: '各平台金额自动相加 = 当月外卖收入；快速录入不做账单核对（拆不出活动补贴），要核对请切「分项录入」。',
      filledTpl: '已填 {n} / {m} 个平台',
      fastPh: '商品总价+打包费+活动补贴（元）',
      // round109：外卖分组折叠态的**空态占位**。
      //   背景：外卖分组原本**不受展开状态控制**（标题行有 ▾/▸ 但内容块不读 expanded，
      //   点了只翻符号、内容纹丝不动 —— 李老师真机「外卖一直是全部显示的状态」）。
      //   接上真折叠后，折叠态只显示「各平台已填金额 + 合计」；一行都没填时给这句占位。
      foldEmpty: '还没填，点标题展开填写',
      goodsField: '商品总价',
      packField: '打包费',
      subsidyField: '商家活动补贴',
      goodsPh: '商品总价（元）',
      packPh: '打包费（元）',
      subsidyPh: '活动补贴（元）',
      pasteBtn: '粘贴',
      pasteAreaTitle: '粘贴账单金额',
      pasteAreaPh: '从平台账单 Excel 复制一列（含表头也行），粘到这里，系统只提数字并求和。',
      pasteExtract: '提取并填入',
      pasteCancel: '取消',
      pasteConfirmTitle: '发现合计行',
      pasteConfirmBody: '粘贴内容里含「合计 / 总计」行，已按明细行求和、合计行本身不计入。要继续吗？',
      pasteDone: '已提取并填入',
      pasteFromTotal: '已按合计行填入，请核对是否与明细重复',
      pasteEmpty: '未提取到数字',
      pasteRawKept: '原始粘贴内容已保存在本地草稿，可回溯。',
      // 平台口径句（挂在分项/快速下方；文案走 i18n，页面不写死平台名）
      scopeGuide: '这"一个数" = 商品总价 + 打包费 + 商家活动补贴；不是顾客实付、不是到账、不是商家应收款。佣金与配送费不要在这里扣（扣了就成净额，费用侧会无事可填）。',
      // 配平（软提示，不阻断）
      reconcileTitle: '账单核对',
      recField: '账单商家应收款',
      recPh: '从平台账单抄一个数（选填）',
      recCalcHint: '系统按「外卖收入 − 活动补贴 − 佣金 − 配送服务费 − 配送补贴」估算应有应收款，与您填的比对。',
      recPass: '两侧一致（差额 ≤ 50 元），说明收入与费用都填全了。',
      recMiss: '差 {diff} 元，可能漏填了某项扣款。常见漏项：推广费 / 商家配送补贴 / 违规扣款。',
      recPack: '差额与打包费金额相等，请核对账单「商品总价」是否已含打包费（避免打包费被重复计入收入）。',
      recDeliv: '差额与您填的配送费相近，可能是"用户支付配送费"已计入商家应收款（商家自配送常见），并非填错。',
      recNoInput: '填了"账单商家应收款"才会做核对；不填则跳过。',
      // 费用侧带出与取数路径
      autoCarryLabel: '自动带出',
      autoCarryHint: '分项录入的「商家活动补贴」合计已自动带到费用 · 营销 · 外卖活动补贴（同一笔钱只填一次，用于配平相抵）；可手动修改。',
      promoPathLabel: '取数路径：推广中心 · 消费明细',
      // 配平校验用到的营销项**角色 → 显示名**映射（单源：值必须 ∈ ledger.expense[marketing].items；由自测守）。
      // ⚠️ 页面只按角色取用，不写死中文项名 —— 否则改名即静默读到 0、配平恒偏。
      // T3′（round97）：快速模式的轻量自查 —— **零依赖判据**。
      //   为什么不用 runReconcile：A.11.4 等式需要 `subsidy`，而快速模式下用户只填「每平台一个总额」，
      //   压根没有补贴数据源（subsidy 只能来自分项快照）⇒ 硬套等式会**稳定误报**「可能漏填」。
      //   故只判一条：外卖收入 > 0 且营销段「佣金 / 配送服务费 / 配送补贴」**全空** ⇒ 提示别漏记。
      //   ⚠️ 纯提示：不阻断保存、不入库、不参与利润。
      selfCheckMiss: '外卖收入已填，营销费用里的佣金与配送费还是空的 —— 这两项记得按账单记上，不然利润会偏高。',
      // T1（round97）：营销段的「分平台佣金小计」——按各平台账单逐行填佣金，系统自动把合计
      //   **汇成**营销段的佣金总额那一行（该行随即转只读，避免「分平台」与「手填总额」两个来源打架）；
      //   一行都不填则**完全不碰**那一行（第一红线：否则每次进页都会把库里已存的佣金清零）。
      //   ⚠️ 只回显、不入库（只进本地草稿）；提示句里的占位符由 js 用 reconcileRoles.commission 替换，
      //     不在文案里写死项名 —— 项名一改就漂。
      mkPlatTitle: '分平台佣金小计',
      mkPlatHintTpl: '按各平台账单各填一行，系统自动把合计写进上面的「{name}」；一行都不填，就自己填那一行。',
      mkPlatPh: '该平台佣金',
      mkPlatSumLabel: '分平台合计',
      mkPlatClear: '清空分平台',
      reconcileRoles: {
        commission: '外卖平台佣金',
        deliveryFee: '外卖配送服务费',
        deliverySubsidy: '外卖配送补贴',
      },
      // 推广费项名（用于高亮「独立取数路径」；单源，自测守）。
      promoItem: '外卖推广费',
      promoPathHint: '外卖推广费不在订单结算单里，钱从推广账户余额单独扣。只对结算账单核对一定会漏，利润会虚高。',
    },
    // 费用侧营销项「取数路径」标注（⚠️ 按营销项**显示名**（与 collections.js item_name 一致）挂，随 terms 双副本走）
    expenseItemNotes: {
      '外卖平台佣金': '账单「技术服务费」列求和',
      '外卖配送服务费': '账单「履约服务费」列求和',
      '外卖活动补贴': '收入侧「商家活动补贴」自动带出（可手改）',
      '外卖配送补贴': '账单中商家承担的固定配送费 / 距离加价',
      '外卖推广费': '推广中心 · 消费明细（⚠️ 不在结算单内）',
      '团购平台佣金': '美团到店 / 抖音来客（与外卖佣金分列，不合并）',
    },
    // E1：收入/费用引导文案（总口径）
    // 口径以 specs/core/开发规范v1.0_ModuleA_收入费用核算.md A.0-1 为准：**权责发生制**
    //   （收入按业务发生日确认：外卖=订单日 / 团购=核销日；现金看到账日，二者可跨月）。
    //   2026-09-20 修正：此前写成「按实际到账金额填」= 收付实现制，与 A.0-1 冲突，
    //   且与 A.2「佣金记营销费用」自相矛盾（收入已扣佣、费用再记一次 = 佣金扣两次）。
    incomeHint: '收入按当月实际发生的营业额填：出了餐就算，不管钱有没有到账。平台还没结算的照记，不要挪到下月。',
    expenseHint: '费用只填本月实际发生的支出；不含食材采购（走库存倒轧）、不含往月欠账、不含押金等可退款项。',
    // ===== E2（批次 8c）：每一类的「包括 / 不包括」口径 —— 说清填什么，防重填漏填 =====
    incomeScope: {
      dine_in: '包括店内扫码点单、现金、微信支付宝、银行卡刷卡、储值卡核销、团购/代金券核销；个人/单位挂账、签单也按出餐当月计入。团购核销的钱结算在美团/抖音平台、不是当日到账，但仍按核销当月计入。不包括会员充值预收（没消费不算收入），也不包括收回挂账的回款（那是把应收款收回，不是营收）。店内折扣、会员价、满减一律按实际成交金额（折后）填，不按菜单原价填，折扣让利也不单列。',
      takeaway: '按平台账单的「商品总价 + 打包费 + 商家活动补贴」三项相加填（规范 A.1：非顾客实付、非到账）；平台佣金与配送费不要在这里扣，记到下面的「营销费用」。',
      other: '包括废品变卖、预制菜零售等；不包括老板个人转入、借款、押金。',
    },
    expenseScope: {
      operation: '包括房租、物业、水电燃气、耗材、平台年费；不包括设备与装修购置（走「摊销资产」分期摊）。房租一次付了几个月的，本月只填应摊的那部分（总额÷月数），别整笔计入。',
      labor: '包括工资绩效、社保、加班费、员工餐、临时工；不包括老板个人开支。',
      marketing: '包括团购与外卖平台佣金、配送服务费、推广费、活动补贴；不要与收入重复扣减。',
      other: '包括代账费、维修、差旅、办公；加盟费/品牌使用费金额大请走「摊销资产」；不包括食材采购与还本付息。',
    },
    // 页面顶部「填写口径」折叠块（默认收起，点开看 5 条防重防错规则）
    fillGuideTitle: '填写口径（点开看，避免填重填错）',
    fillGuide: [
      '① 同一笔钱只填一次：填了收入就别再填成费用，填了费用别再抵一次收入。',
      '② 金额单位是「元」，可以填两位小数；按当月实际发生填，不要估。',
      '③ 食材采购不计入费用：采购进库存，系统按「月初 + 采购 − 月末」自动算食材消耗。',
      '④ 设备、装修、加盟费等一次性投入走「摊销资产」分期摊；同一项以后再投入，点「再投一笔」另记一笔、各自摊。',
      '⑤ 外卖、团购的佣金不要在收入里扣，统一记到「费用 · 营销」。',
    ],
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

    // ===== v2（2026-09-23 李老师拍板：毛利率 / 自选费用项 / 建店投入摊销 / 餐饮指标对照 / 城市层级）=====
    // ⚠️ 指标名称与等级文案**必须在前端映射**：后端只返回 key + level 枚举（good/ok/warn/bad/na），
    //    中文一律走这里 —— 让「术语单源」与「页面零硬编码」两条铁律同时成立（后端不存中文、前端不存公式）。
    cityLabel: '城市层级',
    cityTiers: [
      { key: 'tier1', name: '一线' },
      { key: 'tier23', name: '二三线' },
      { key: 'county', name: '县城' },
    ],
    bizLabel: '经营类型',
    bizTypes: [
      { key: 'fastfood', name: '快餐小吃' },
      { key: 'dining', name: '中式正餐' },
      { key: 'hotpot', name: '火锅烧烤' },
      { key: 'cafe', name: '茶饮咖啡' },
    ],
    secBuild: '开店投入（一次性）',
    secFixed: '每月固定支出',
    secMargin: '菜品毛利率',
    secVar: '跟营业额挂钩的费用',
    secTarget: '目标月利润',
    secResult: '测算结果',
    secIndicators: '你的经营指标对照',
    buildItems: { franchise: '加盟费', decor: '装修', equip: '设备资产', other: '其他投入' },
    buildPh: '金额',
    yearsSuffix: '年',
    buildTotal: '开店共投入',
    amortMonthly: '折算到每月',
    fixedItems: { rent: '房租', labor: '人工', utility: '水电气', manage: '管理费', other: '其他固定' },
    fixedTotal: '每月固定支出合计',
    marginName: '菜品毛利率',
    marginSub: '毛利率越高，需要卖出的营业额越少',
    marginTip: '不用另填食材成本，它会随毛利率自动折算',

    // ===== 填表引导（round113 · 2026-09-24）=====
    // 目的：客户多是餐饮小白，"不知道这项该填多少" ⇒ 干脆不填、不用（李老师 round113 原话）。
    // 手段：① 逐项口径备注（这笔钱指什么）② 动态"行业参考区间"（该填多少量级）③ 最小可用集（填几项就能算）。
    // ⚠️ 参考区间的**数值**不在本文件 —— 它是云端 indicatorRef.BANDS 单源，由 calcSandbox 的
    //    `bands_preview` 出参下发（前端只做 key→中文名映射，不存数值，避免出现第二份真相源）。
    bandPreviewTitle: '行业参考区间',
    bandPreviewNote: '按你选的经营类型和城市层级给的，用来看自己填的数合不合理',
    buildNote: '一次性投入，不是每月花掉的。右边「年限」= 这笔钱用几年，系统按它摊到每月',
    buildItemNotes: {
      franchise: '按合同一次性付；没加盟就留空',
      decor: '含硬装、软装、门头招牌；不含押金',
      equip: '厨房设备、桌椅、冷柜、收银系统等',
      other: '转让费、证照办理、首批物料等',
    },
    fixedNote: '每月固定要付的，不管生意好坏都跑不掉',
    fixedItemNotes: {
      rent: '含物业费；季付/年付先除以月数',
      labor: '后厨+前厅+店长，含社保；不含提成奖金',
      utility: '看近 3 个月账单取平均；充值制按充值额算',
      manage: '加盟管理费、总部抽成等；没有就留空',
      other: '上面没覆盖的固定支出，如宿舍、宽带',
    },
    varNote: '这些是按流水抽成的，不是固定金额 —— 填百分比',
    varItemNotes: {
      takeawayComm: '平台抽佣，一般 15%~25%',
      grouponComm: '团购平台的抽成比例，按合同填',
      cardFee: '收单机构给的费率，通常不到 1%',
      other: '会员折扣、支付通道费等其他按流水抽的',
    },
    marginBandLabel: '本业态参考',

    // ===== 预计月营业额锚点（round114 · 2026-09-24 李老师"这个直接加"）=====
    // 目的：光给"房租 8~15%"这种区间，小白仍回答不了"那我到底该填多少钱"。
    // 手段：填一个预计月营业额 ⇒ 后端按各项参考带的**中值**反算金额，作为输入框的灰字起点
    //       + 参考区间卡上的"参考 ¥X"。
    // ⚠️ 只当灰字起点，**绝不自动填值** —— 用户不核对就得到一份"自证的合理"，反而误事。
    // ⚠️ 金额数值不在本文件（云端 indicatorRef.suggestAmounts 单源 → 经 amount_preview 下发）。
    expectRevLabel: '预计月营业额',
    expectRevPh: '选填，如 150000',
    expectRevNote: '填个大概数，上面各项就会给出行业常见的参考金额，拿去核对行情就行',
    refAmtCard: '参考 ¥',
    refAmtPh: '参考 ',
    varItems: { takeawayComm: '外卖平台佣金', grouponComm: '团购佣金', cardFee: '刷卡手续费', other: '其他' },
    varTotal: '合计扣点',
    resBreakMonthly: '保本月营业额',
    resBreakDaily: '保本日均',
    resTargetMonthly: '目标利润月营收',
    resTargetDaily: '目标利润日均',
    resPayback: '开店投入抵完',
    targetRow: '每月想赚',
    paybackUnit: '个月',
    // ⚠️ 键名必须与 indicatorRef 的 INDICATORS 严格同名（后端只回 key，中文全在前端 —— 术语单源）。
    // grossMargin 是**菜品毛利率**（越高越好）；其余五项是成本/费用占比（越低越好）。
    indNames: { grossMargin: '菜品毛利率', rent: '房租占比', labor: '人工占比', energy: '能耗占比', manage: '管理费占比', mkt: '平台推广费' },
    // 🔴 必须**两张**评级表：成本类"高"是坏，毛利率"低"才是坏。
    //    用一张表会把"毛利率偏低"渲染成「偏高」—— 方向相反，客户会读反。
    indLevels: { good: '优秀', ok: '合理', warn: '偏高', bad: '过高', na: '未填' },
    indLevelsGain: { good: '优秀', ok: '合理', warn: '偏低', bad: '过低', na: '未填' },
    indGainKey: 'grossMargin',
    indBand: '行业参考',
    indMine: '你的',
    indRedline: '警戒线',
    indByBreak: '按保本营业额算',
    indByTarget: '按目标利润营业额算',
    addItem: '+ 加一项',
    delItem: '删除',
    autoHint: '改完自动重算，不用点按钮',
    needFixed: '最少填一项每月固定支出（房租/人工/水电气/管理费任一项）就能算出保本营业额',
  },

  // ===== 十四、M3 成本卡页面文案 =====
  card: {
    listTitle: '菜品成本毛利核算',
    dishName: '菜品名称',
    category: '成本分类',
    tags: '标签',
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
    save: '保存菜品核算',
    addLine: '+ 添加明细行',
    reverseTitle: '反算售价',
    reverseHint: '输入目标毛利率，反推建议售价',
    targetMargin: '目标毛利率（%）',
    reverseResult: '建议售价',
    copyVersion: '生成新版本',
    hintAlways: '提示：理论配方成本 ≠ 真实门店毛利。',
    versionHistory: '版本历史',
    version: '版本',
    empty: '还没有菜品核算，点下方新增',
    oldVersionNote: '历史版本（只读）',
    syncNote: '同步后将按原料最新价生成新版本，旧版本保留可查。',
    versionCreatedAt: '保存时间',
    versionCostDiff: '成本变化',
    versionLines: '配方明细',
    versionReadonly: '历史版本只读，不可编辑',
    dishNamePh: '如 宫保鸡丁',
    // ===== 批次 P0（M3 v1.2）· 原料档案页（任务 1）=====
    materialListTitle: '原料档案',
    matName: '原料名称',
    matNamePh: '如 鸡胸肉',
    matBrand: '品牌规格',
    matUnit: '采购单位',
    matUnitDefault: '斤',
    matPrice: '采购单价（元）',
    matNetCost: '净料单位成本（元）',
    matCategory: '分类',
    matAliases: '别名',
    matAliasesHint: '逗号分隔，仅用于搜索提示，不会替换原料名',
    matRemark: '备注',
    matAdd: '新增原料',
    matEdit: '编辑原料',
    matSearchPh: '搜索名称或别名',
    matEmpty: '还没有原料，点下方新增',
    matDelete: '删除',
    matDeleteConfirm: '删除后该原料不再出现在列表，但已保存成本卡的快照不受影响。确定删除？',
    matVirtual: '虚拟原料',
    matVirtualReadonly: '虚拟原料由半成品卡自动生成，不可手动编辑或删除',
    matConvert: '换算系数（→克）',
    matConvertHint: '1 斤 = 500 克',
    matYield: '出成率（%）',
    catMeat: '肉类',
    catVeg: '蔬菜',
    catDry: '干货',
    catSeason: '调料',
    catPack: '包材',
    catOther: '其他',
    // ===== 批次 P0 · 成本卡列表页补齐（任务 2）=====
    searchPh: '搜索菜品名称',
    filterCategory: '分类',
    filterMargin: '毛利率区间',
    marginAll: '全部',
    marginHigh: '高（≥60%）',
    marginMid: '中（30%~60%）',
    marginLow: '低（<30%）',
    deleteCard: '删除',
    deleteCardConfirm: '删除后该菜品所有版本将移出列表，历史版本仍可在版本历史查看。确定删除？',
    copyCard: '复制',
    copyCardConfirm: '复制为一张新卡（配方相同、全新卡号）。确定复制？',
    syncCard: '同步至原料最新价',
    batchSync: '批量同步',
    batchSyncConfirm: '对选中的菜品按原料最新价生成新版本，旧版本保留。确定同步？',
    syncDone: '已生成新版本',
    selectSync: '选择要同步的菜品',
    // ===== 批次 P0 · 成本卡编辑页补全（任务 3）=====
    inputType: '录入方式',
    inputTypeArchive: '从原料档案选择',
    inputTypeManual: '临时手工录入',
    manualName: '原料名称',
    manualNamePh: '临时原料名，仅本卡生效',
    manualUnitPrice: '单价（元/克）',
    manualYield: '出成率（%）',
    activityPrice: '活动特价（元）',
    activityPriceHint: '活动期间的挂牌价，用于计算第二条毛利率',
    warnPriceBelowCost: '售价低于成本，确定保存吗？',
    reverseApply: '填入建议售价',
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
    // ===== round103：期初结转 + 修正（依据 规范 02_模拟测试数据集.md:127「从上月期末结转，不可编辑」）=====
    openingCarryNote: (m) => `期初由上月（${m}）期末自动结转，不用手填`,
    openingEmptyNote: '还没有可结转的上月期末，请填写建账库存',
    openingDiffNote: (p, s, d) => `与上月期末 ${p} 元不符（本页${s} ${d} 元），建议先核对上月盘点`,
    openingUnlock: '手动修正期初',
    openingFix: '去改上月期末',
  },

  // ===== 十六、M1 摊销资产页（shop_amortize）=====
  amortizePage: {
    title: '一次性投入',
    monthTotal: '本月摊销合计',
    add: '新增摊销资产',
    name: '名称',
    value: '原值（元）',
    startMonth: '开始月份',
    totalMonths: '总月数（月）',
    terminateMonth: '终止月份（可选）',
    monthAmount: '当月摊销',
    monthAmountShort: '月摊销',
    terminateNow: '提前报废',
    confirmTerminate: '确认提前报废该资产？未摊余额将作为处置损失计入。',
    save: '保存',
    edit: '编辑',
    empty: '还没有摊销资产，点下面新增',
    namePh: '如 装修、设备、加盟费',
    monthUnit: '月',
    optional: '可选',
    // ===== H1（批次 8c）：同一资产多次采购，每笔独立起摊 =====
    scopeHint: '装修、设备、加盟费等一次花的钱都在这里登记。金额小的选「一次算清」——全部算进投入那个月的费用；金额大的选「分期摊销」——按月摊开、不把当月压太狠。同一项支出以后又花钱（再买一台、二次装修、追加加盟费），点「再投一笔」再记一笔，每笔从各自投入的月份单独起摊、互不影响。',
    appendPurchase: '再投一笔',
    appendTitle: '再投一笔',
    batchWord: '投入',
    batchPrefix: '第',
    batchSuffix: '笔',
    batchTotalPrefix: '共',
    batchTotalSuffix: '笔投入',
    groupValueLabel: '合计原值',
    expandHint: '展开看每一笔',
    collapseHint: '收起',
    appendHint: '同一项支出再次投入用「再投一笔」（如再买一台设备）；若其实是另一件事（如二次装修），直接新建一个资产，别混进同一笔。',
    // ===== round106（F5b）：留存数据（剩余未摊 / 摊完月份）=====
    // 期数 k/N 与剩余额一律由后端（getAmortSchedule 调引擎 amountForMonth 逐月累加）算出，前端只拼文案，
    // 绝不在这里重算摊销公式（摊销口径单源在引擎）。
    paidProgress: (k, n, amount) => `已摊 ${k}/${n} 期 · 剩余未摊 ${amount}`,
    progressMulti: (n, amount) => `共 ${n} 笔 · 剩余未摊合计 ${amount}`,
    remainingOnly: (amount) => `剩余未摊 ${amount}`,
    endNote: (m) => `摊完 ${m}`,
    endNoteLast: (m) => `末笔摊完 ${m}`,
    endTerminated: (m) => `已终止（${m} 月）`,

    // ===== round107：本页同时承载两类投入 =====
    lumpSectionTitle: '本月一次算清',
    lumpSectionHint: '这些钱全部算进本月费用，不跨月摊',
    lumpEmpty: '本月还没有一次算清的投入',
    lumpSumLabel: '合计（计入本月费用）',
    lumpAdd: '记一笔',
    lumpDelete: '删掉这一笔',
    confirmDeleteLump: '确认删掉这一笔一次性投入？删除后本月费用会跟着变小。',
    amortSectionTitle: '分期摊销',
    // 摊销开关：⚠️ 服务端权威（shop_switch.amortize_switch）。入口从「录入页二选一」搬到这里，
    //   因为二选一会把两类投入变成互斥；开关本身的口径（关掉就不计摊销）**没变**。
    amortSwitchLabel: '启用分期摊销',
    amortSwitchHint: '关掉后，下面登记的摊销资产不计入利润',
    swOn: '已启用',
    swOff: '未启用',

    // ===== round109（李老师真机反馈）=====
    // ① 「分期摊销填错了删不掉」—— 后端 saveAsset 早就支持删任意资产（软删、不可复活），
    //    纯粹是前端 assetEdit 的删除键条件写死了 kind==='lump' ⇒ 摊销资产永远看不到删除入口。
    //    ⚠️ 文案与「一次算清」的 lumpDelete / confirmDeleteLump **分开**：摊销删掉会改动**从起摊月起的各月**，
    //       一次算清只影响当月 —— 后果不同，措辞不能共用（共用会让人以为只影响一个月）。
    amortDelete: '删掉这一项',
    confirmDeleteAmort: '确认删掉这一项摊销资产？删掉后，从起摊月起的各月摊销都会跟着变小，且不可恢复。',
    // ② 「填完了不知道做什么」—— 本页是全流程的最后一步填写
    //    （月度首页 → 月度录入 → 库存盘点 → 一次性投入 → 看经营结果），
    //    但底部原来只有「+ 新增摊销资产」，一个出口都没有，只能按手机最上面的返回键一层层退。
    finishZoneHint: '一次性投入是本月最后一步。登记完，去看本月经营结果。',
    viewResult: '看本月经营结果',
    backHome: '回月度首页',

    // ===== round107：独立编辑页（assetEdit）=====
    editLumpTitle: '一次算清的投入',
    editAmortTitle: '摊销资产',
    editLumpHint: '这笔钱全部算进所选月份的费用，之后不再影响别的月份',
    editAmortHint: '从开始月份起按月摊，摊完为止',
    fName: '名称',
    fNamePh: '如 装修、设备、加盟费',
    fAmount: '金额（元）',
    fAmountHint: '一共花了多少（分位可留空）',
    fStartMonth: '开始月份',
    fStartHint: '从哪个月开始算',
    fStartPh: '选月份',
    lumpMonthLabel: '计入月份',
    lumpMonthHint: '这笔钱算进哪个月的账；之后不再影响别的月份',
    fTotalMonths: '总月数（月）',
    fTotalHint: '分几个月摊完，填 1 就等于当月一次算清',
    fTerminateMonth: '终止月份',
    fTerminateHint: '提前停摊才填；不填就自然摊完',
    fSave: '保存',
    fErrName: '请填名称',
    fErrAmount: '请填金额',
    fErrStart: '请选开始月份',
    fErrMonths: '总月数请填 1 以上的整数',
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
    // ===== round115：行业指标对照（李老师 2026-09-24「让客户找到方向」的第一步）=====
    // ⚠️ 指标名 / 评级表 / 业态与城市清单**全部复用 M2 的术语**（单一来源，不另抄一份）：
    //    TERMS.m2.indNames / indLevels / indLevelsGain / indBand / indMine / bizLabel / bizTypes / cityLabel / cityTiers
    indTitle: '行业对照',
    indSub: '跟同类型的常见区间比一比，看哪项偏得多',
    // 🔴 缺项显示「本月没填」而不是「0%」—— 算 0% 会得出「房租占比 0%，优秀」这种荒谬结论
    indMissing: '本月没填',
    // 两项口径与 M2 不同义，必须标注，否则客户跨模块对比会误判
    indMarginNote: '整店口径（含外卖）',
    indMktNote: '含佣金、推广费、活动补贴',
    // 未设置业态/地区时的兜底说明（bandOf 回落 正餐 × 二三线）
    indScopeTip: '按「正餐 · 二三线」估算',
    indScopeChange: '可改',
  },

  // ===== 十八、核算方式（录入页就地二选一 · 2026-09-20 从店铺设置页迁入）=====
  // ⚠️ 单源：库存 / 摊销的口径选择**只在这一处**暴露给老板；店铺设置页不得再放开关。
  //    原因（真机走查 2026-09-19）：老板在设置页看到"库存核算 / 摊销核算"不知道是什么，
  //    放到真正要用到它的计算步骤旁边才有意义。切换即写库，服务端仍是唯一权威。
  calcMethod: {
    secTitle: '这两笔钱怎么算',
    secHint: '随时能改，改了不影响已经填好的数字',
    consumeTitle: '① 食材消耗',
    consumeDirect: '按采购直接填',
    consumeDirectDesc: '本月买菜花多少就填多少',
    consumeInv: '按库存盘点倒算',
    consumeInvDesc: '期初 + 采购 − 期末，算真实消耗',
    consumeDirectField: '本月食材消耗',
    consumeDirectHint: '没盘点习惯就填采购总额',
    consumeInvGo: '去填库存盘点',
    consumeInvSummary: (o, p, c) => `已填：期初 ${o} · 采购 ${p} · 期末 ${c}`,
    consumeInvEmpty: '还没填过盘点，点上面去填',
    consumeInvHint: '填完系统自动倒算，不用自己算',
    // ===== round107（李老师真机反馈）=====
    // ① 段名「装修设备」太窄：装修 / 加盟费 / 转让费 / 品牌使用费 / 进场费**都可能摊销**，统一叫「一次性投入」。
    // ② **取消「一次性计入当月 / 按月分摊」二选一** —— 那一对选项写的是 shop 级 amortize_switch，
    //    结构上就排除了「本月既有一笔摊销、又有几笔小额一次算清」，而这正是真实场景。
    //    现在两类投入**可以同时存在**，各自的处置方式在「一次性投入」页里逐笔登记。
    assetTitle: '② 一次性投入',
    assetHint: '装修、设备、加盟费等一次花的钱：金额小的当月一次算清，金额大的分月摊。两类可以同时存在',
    // 摘要两行：笔数与金额均由后端算，前端只拼文案
    assetLumpSum: (n, amt) => `一次算清 ¥${amt}（${n} 笔）`,
    assetAmortSum: (n, amt) => `分月摊 ¥${amt}（${n} 项）`,
    assetSumEmpty: '还没登记过，点上面去登记',
    assetGo: '去登记 / 管理',
    switchSaved: '已切换',
    switchFail: '切换失败，请重试',
    movedNote: '核算方式（食材怎么算）在「月度录入」页里选；一次性投入在「一次性投入」页里登记',
  },

  // ===== 十九、店铺设置页 =====
  settings: {
    title: '店铺设置',
    shopName: '店铺名称',
    shopNamePh: '如 老王川菜馆',
    remark: '备注',
    remarkPh: '选填，如 门店地址、主营品类',
    save: '保存设置',
    saved: '已保存',
  },

  // ===== 二十、M1 录入页（收入/费用/消耗）=====
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
    // R45 · iOS 端拦截提示（虚拟商品不得在 iOS 小程序内开通）
    // ⚠️ 措辞纪律：只说明"此设备不支持"，不承诺其他购买渠道、不出现"会员 / 订阅 / 付费"敏感词。
    iosBlockedTitle: '暂不支持在此开通',
    iosBlockedBody: '当前设备（iOS）暂不支持在小程序内开通。可在安卓设备或电脑端打开小程序完成开通。',
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
    // 已达免费上限时的按钮文案（真机走查缺陷①：按钮仍写「新增店铺」但点了弹付费墙，用户以为坏了）
    addShopLimited: '已建 1 家 · 开通后可建多家',
    switchHint: '切换店铺不会触发任何付费弹窗；免费版可建 1 家店铺。',
    // 导出
    exportTitle: '导出数据',
    exportIng: '正在导出…',
    exportDone: '导出完成',
    exportScopeM3: '菜品成本批量',
    exportFormatExcel: 'Excel',
    exportFormatJson: 'JSON',
    exportNeedPaid: '导出需开通真实利润',
    // 隐私合规
    privacyTitle: '用户隐私保护指引',
    privacyAgree: '同意并继续',
    privacyDisagree: '暂不同意',
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
    // C1：关于 / 客服 / 免责声明（mine 页）
    about: '关于',
    versionLabel: '版本',
    appVersion: 'v1.0.0',
    feedback: '意见反馈',
    feedbackHint: '使用中遇到问题，点这里反馈',
    disclaimerLabel: '免责声明',
    // G4/G8：热更新 + 断网提示（app.js 全局）
    updateTitle: '发现新版本',
    updateBody: '有新版本可用，是否立即更新？',
    updateConfirm: '立即更新',
    updateCancel: '暂不',
    offlineTitle: '网络不可用',
    offlineBody: '当前网络已断开，请检查网络连接后重试。',
    networkErr: '网络不可用，请检查网络连接',
    serviceUnavailable: '服务不可用',
    // G5：头像昵称（AD-15，chooseAvatar + nickname 新能力，本地保存展示）
    avatarLabel: '头像',
    nicknameLabel: '昵称',
    nicknamePh: '请输入昵称',
    avatarSaved: '已保存',
  },

  // ===== 二十四、导出按钮（付费墙触发）=====
  exportBtn: {
    m1Report: '导出月度报表',
    m3Cards: '导出菜品成本',
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
