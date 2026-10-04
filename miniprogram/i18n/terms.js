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
    addCostCard: '+ 新增', // M3，免费张数由配置下发（plan_free.limits），超限触发 paywall.saveLimit
    // R191 改名：原名「+ 新增菜品」概括不了套餐（卡类型选「套餐」后建的也是卡）⇒ 去掉品类限定词。
    save: '保存',
    calc: '算一算', // 不叫"计算盈利"
    export: '导出 / 打印', // 免费禁，触发 paywall.export
    unlockPro: '开通真实利润', // ⭐ 主按钮，必须带功能名
    cancel: '取消',
    thinkAgain: '再想想',
    gotIt: '知道了', // R45：iOS 拦截提示的唯一按钮（不给"去开通"动作）
  },

  // ===== 四、付费弹窗（触发面 = 保存超限 / 导出 / 套餐 / 外卖，与 PAID_FEATURES 对齐 · R159）=====
  paywall: {
    saveLimit: {
      title: '已达免费上限',
      content:
        '免费版可建 1 家店铺、菜品数量有限。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。',
      primary: '去开通', // ⚠️ 只用于 showModal confirmText，平台上限 4 字符 // 跳套餐页
      secondary: '再想想',
    },
    export: {
      title: '导出需开通',
      content: '开通真实利润后可导出 / 打印菜品成本与经营报表。',
      primary: '去开通', // ⚠️ 只用于 showModal confirmText，平台上限 4 字符
      secondary: '取消',
    },
    // R159：M3 付费域（云端 PAID_FEATURES 登记 m3_combo / m3_takeaway ⇒ 此处必须有对应文案，
    //   否则「登记了能力却没有墙」—— 由 tools/check_paywall_coverage.js 强制）。
    // ⚠️ 交互边界：**进页面与录入都不拦**，只在点「计算 / 生成利润报表」时拦；
    //   故 content 明写"录入可免费保存"，避免用户录完才被拦、觉得被钓。
    combo: {
      title: '套餐需开通',
      content: '套餐利润测算为专业版功能：录入可免费保存，开通后解锁计算与报表。',
      primary: '去开通', // ⚠️ ≤4 字符（平台硬限制）
      secondary: '再想想',
    },
    takeaway: {
      title: '外卖需开通',
      content: '外卖利润核算为专业版功能：录入可免费保存，开通后解锁到手率与毛利测算。',
      primary: '去开通', // ⚠️ ≤4 字符（平台硬限制）
      secondary: '再想想',
    },
    // ⚠️ 平台限制：wx.showModal 的 confirmText / cancelText **最多 4 个字符**，超了弹窗直接 fail
    //   （真机事故 2026-09-26：primary「开通真实利润」6 字 ⇒ showmodal:fail confirm text length）。
    //   故弹窗按钮**单独**用 ctaShort（≤4）；带功能名的长文案留给页面按钮（buttons.unlockPro）。
    ctaShort: '去开通',
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
    // R199：底部 tabBar 上线后首页下半屏的引导语（说明「去哪找别的功能」，避免看着像空了一段）。
    //      禁用词表：不含「盈利/赚钱/收益率/付费/订阅」等 13 个禁用词里的任何一条（门槛守卫每轮查）。
    tipMore: '底部「配方」进菜品成本卡与原料库，「我的」看订单与客服。',
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
    // ===== round189 · 常规科目预置 + 上月一键复制 =====
    //   常规科目 = **每月都有、且金额占比大**的科目（房租 / 水 / 电 / 燃气 / 工资）。
    //   🔴 只预置「行」，金额一律留空 —— 与 M2「参考金额只作 placeholder、不自动填值」是同一条纪律：
    //      **系统绝不替老板编数**。
    //   fixed = 金额月月不变 ⇒ 复制上月后**沿用**、不标待核对；
    //   variable = 每月必有但金额会变 ⇒ 复制上月后**带值但标待核对**（防"复制完忘了改"）。
    recurringHint: '这几项每月都有，已经帮你列好了，金额自己填',
    recurringFixed: ['房租', '物业费', '宽带网费', '工资绩效'],
    recurringVariable: ['水费', '电费', '燃气费'],
    copyPrevBtn: '复制上月',
    copyPrevNone: '上个月还没有账，这次先填一遍，下个月就能一键带出来了',
    copyPrevConfirmTitle: '覆盖这个月已经填的？',
    copyPrevConfirmBody: '这个月已经填过一些了。复制上月会覆盖现在的行，确定吗？',
    // ⚠️ wxml 不做法调用 ⇒ 横幅文案由 js 预计算成字符串后再给 wxml。
    copyPrevBanner: (m, n, k) => `已带出 ${m} 共 ${n} 项，其中 ${k} 项要核对`,
    needCheck: '要核对',
    fixedTag: '沿用',
    // ⚠️ wx.showModal 按钮文案 **≤4 字符**（记忆 §5 铁律：超了整窗 fail 且**静默**）
    copyPrevOkBtn: '覆盖',
    copyPrevCancelBtn: '取消',
    copyPrevOk: '已带出上月的科目',
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
      fastHint: '每平台填「商品总价 + 打包费 + 商家承担全部补贴」三项之和这一个数，再填该平台有效订单数。如知商家承担补贴金额，可填到每平台「其中：商家承担补贴」框，系统会自动计入费用，利润更准。',
      detailHint: '每个平台填 4 个数，小计自动算出、不用手填。',
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
      // 🔴 R161-2（淘宝闪购 8 月账单实测）：平台账单里**商家承担的补贴是三列**——
      //   商家活动补贴 / 商家代金券补贴 / 商家配送费活动补贴。
      //   本店 8 月：791.68 + 831.02 + 447.00 = 2069.70；只抄第一列 ⇒ **少扣 1278.02 元、利润虚高**。
      //   ⇒ 显示名改为「合计」，并在框下钉一句口径，逼用户抄全三项。
      subsidyField: '商家承担全部补贴（合计）',
      subsidyNote: '填写规则：平台账单里【商家活动补贴 + 商家代金券补贴 + 商家配送费活动补贴】三项相加的合计金额；不要只抄"商家活动补贴"单列，漏填代金券、配送补贴。只填商家承担的部分 —— 平台承担/平台补贴不要填进来（它不进商家到手，填了会多扣）。',
      goodsPh: '商品总价（元）',
      packPh: '打包费（元）',
      subsidyPh: '三项补贴合计（元）',
      // 🔴 R161-1（硬缺项）：三平台月度汇总都给「有效订单」，缺了它单均一律算不出来。
      //   ⚠️ 口径：有效订单 = 平台账单「有效订单」那一个口径；**退单不算**（本店 8 月 156 行里 6 行退单）。
      ordersField: '有效订单数',
      ordersPh: '有效订单数（单）',
      ordersHint: '平台汇总页「有效订单」那一个数（退单不算）。填了它，下面才会给您算单均。',
      ordersTotalLabel: '有效订单合计',
      perOrderLabel: '单均优惠前总收入',
      perOrderHint: '各平台小计之和 ÷ 有效订单合计，只做参考、不参与利润计算。',
      // 🔴 R161-3（防双记，固定挂在外卖专段顶部）：
      //   平台的「商家配送费活动补贴」**已含在**「商家活动成本 / 全部补贴」里；
      //   我方费用侧「外卖活动补贴」「外卖配送补贴」若再各记一次 ⇒ 同一笔补贴扣两遍。
      boundaryNote: '外卖专段内的「商家承担全部补贴（合计）」已经包含：商家活动补贴、商家代金券补贴、商家配送费活动补贴；不要再在费用页面重复录入「外卖活动补贴」「外卖配送补贴」，同一笔补贴不能二次计入费用，否则成本重复叠加，利润失真。',
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
      scopeGuide: '这"一个数" = 商品总价 + 打包费 + 商家承担全部补贴（合计）；不是顾客实付、不是到账、不是商家应收款。佣金与配送费不要在这里扣（扣了就成净额，费用侧会无事可填）。',
      // R161-6（round163）：归月口径。结算日期 = 账单日期 + 3 天（淘宝闪购实测；美团/京东待核），
      //   按「结算日期」导月会把月初 3 天的单串到上月 ⇒ 必须钉一句在界面上。
      periodNote: '归月口径：按「账单日期 / 订单完成时间」归到本月，不要按「结算日期」归月 —— 结算日通常比账单日晚 3 天，按它归会把月初几天的单串到上个月。',
      // 配平（软提示，不阻断）
      reconcileTitle: '账单核对',
      recField: '账单商家应收款',
      recPh: '从平台账单抄一个数（选填）',
      // ⚠️ R166 修正：原描述「外卖收入 − 活动补贴 − 佣金 − 配送服务费 − 配送补贴」= **R164 已证伪的旧算法**
      //   （收入三框相加本就含补贴，只减一次 ⇒ 补贴被完全抵消，恒定误报漏填 2069.70）。
      //   现已两步走（① 还原优惠前总额 ② 再真实扣一次补贴），文案必须追上实现，否则客户读到的算法说明是错的。
      recCalcHint: '估算方式：先从您填的三项里还原出「优惠前总额」，再依次扣掉补贴、佣金、配送服务费、配送补贴，与您抄的账单应收款比对。',
      recPass: '两侧一致（差额 ≤ 50 元），说明收入与费用都填全了。',
      recMiss: '差 {diff} 元，可能漏填了某项扣款。常见漏项：推广费 / 商家配送补贴 / 违规扣款。',
      recPack: '差额与打包费金额相等，请核对账单「商品总价」是否已含打包费（避免打包费被重复计入收入）。',
      recDeliv: '差额与您填的配送费相近，可能是"用户支付配送费"已计入商家应收款（商家自配送常见），并非填错。',
      recNoInput: '填了"账单商家应收款"才会做核对；不填则跳过。',
      // 费用侧带出与取数路径
      autoCarryLabel: '自动带出',
      // ⚠️ R166 修正：删掉「用于配平相抵」——那是为**旧配平式**写的解释（旧式依赖这一行来抵消收入里的补贴）。
      //   R164 修复后配平式已自洽（收入侧还原优惠前再扣一次补贴），**不再依赖费用侧这一行**，
      //   留着这句会让客户误以为可以把补贴再记一次。保留「不用手抄第二遍」——那条仍然成立且有用。
      autoCarryHint: '分项录入的「商家承担全部补贴（合计）」已自动带到费用 · 营销 · 外卖活动补贴，不用手抄第二遍；可手动修改。',
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
    // ===== M3.17（批次 D）· 外卖单均试算页（纯试算，不落库）=====
    takeaway: {
      title: '外卖单均测算',
      // 双口径（顶部显示口径名 + 一句人话解释；两套数字不混）
      modeCash: '到手口径',
      modeAccrual: '总额法口径',
      modeCashDesc: '现金视角：老板实际到手多少，减掉菜品和包材成本就是赚的。',
      modeAccrualDesc: '会计视角：收入与费用分开记，和月度核算对得上（补贴既进收入又进费用）。',
      commissionBaseNote: '佣金（技术服务费）的计费基数是商品总价，不含打包费。',
      // 菜品 / 套餐
      dishTitle: '本单菜品',
      dishPick: '选菜品 / 套餐',
      dishPickPh: '点选一个菜品或套餐',
      qty: '份数',
      addDish: '+ 加一道',
      // 包材
      packTitle: '包材',
      packTempPh: '临时包材金额（元）',
      packQty: '数量',
      addPack: '+ 加包材',
      // 平台参数
      paramsTitle: '平台参数',
      commissionMode: '佣金方式',
      commissionModeRate: '按比例',
      commissionModeFixed: '固定金额',
      commissionRate: '佣金率（%）',
      commissionMin: '佣金保底（元）',
      commissionFixed: '固定佣金（元）',
      deliveryFee: '配送服务费（元）',
      deliverySubsidy: '配送补贴（元）',
      promoFee: '推广费（元）',
      packFee: '打包费（元）',
      deliveryCustomer: '配送费·顾客承担（元）',
      // 补贴拆行（承担方未选 ⇒ 不计入，fail-closed）
      subsidyTitle: '补贴（承担方未选则不计入）',
      subsidyUser: '用户券补贴',
      subsidyMerchant: '商家满减补贴',
      payer: '承担方',
      payerUnset: '未选',
      payerMerchant: '商家',
      payerPlatform: '平台',
      // 结果（双口径分别展示）
      resultTitle: '测算结果',
      payment: '顾客支付',
      receipt: '商家实收',
      profit: '单均理论利润',
      receiptRate: '到手率',
      dishCost: '菜品成本',
      packCost: '包材成本',
      revenue: '收入',
      expense: '费用',
      // 挂牌价反算
      reverseTitle: '挂牌价反算',
      targetProfit: '目标到手利润（元）',
      reverseBtn: '反算',
      reverseResult: '商品挂牌总价',
      // 软提示（不阻断）
      rateLowHint: '到手率偏低（行业约 70%~75%），平台扣项可能吃掉了利润。',
      // ===== M3.17 账单导入（批次 F 阶段① 第二 tab）=====
      importTab: '账单导入',
      importPick: '选择账单文件',
      importPickHint: '支持淘宝闪购 / 美团外卖的 xlsx 账单',
      importPlatformLabel: '平台',
      importRowsLabel: '识别到',
      importMonthsLabel: '归月到',
      importTotalLabel: '合计',
      importExcludedLabel: '已排除',
      importRowUnit: '行',
      importConfirm: '确认导入',
      importSuccess: '导入成功',
      importFail: '门禁未通过，已阻断导入',
      importNoFile: '请先选择账单文件',
      importEmpty: '先选文件，解析后在此预览',
    },
    // 费用侧营销项「取数路径」标注（⚠️ 按营销项**显示名**（与 collections.js item_name 一致）挂，随 terms 双副本走）
    expenseItemNotes: {
      '外卖平台佣金': '账单「技术服务费」列求和',
      // 🔴 R161-9：原注只写「履约服务费」（美团列名），而淘宝闪购账单里这一列叫「配送服务费」
      //   ⇒ 客户按注去账单里找「履约服务费」找不到列。改为双名对照。
      '外卖配送服务费': '账单「配送服务费」列求和（美团叫「履约服务费」）',
      // R166：字段名同步（R161-2 已把收入侧改名为「商家承担全部补贴（合计）」，此处仍在叫旧名 ⇒ 两边对不上号）。
      '外卖活动补贴': '收入侧「商家承担全部补贴（合计）」自动带出（可手改）',
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
      takeaway: '按平台账单的「商品总价 + 打包费 + 商家承担全部补贴（合计）」三项相加填（规范 A.1：非顾客实付、非到账）；平台佣金与配送费不要在这里扣，记到下面的「营销费用」。另填「有效订单数」，才能算出单均。',
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
    // R193：M2 算完即丢 —— 本地草稿（零云端改动）
    draftRestored: '已载入上次填的数',
    clearDraft: '清空重填',
    draftClearConfirm: '清空后本次填写的数不可恢复，确定？',
    // showModal confirmText ≤4 字符（超了整窗 fail 且静默）
    draftClearOk: '清空',
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
    category: '菜品分类',
    tags: '标签',
    categoryPh: '填写或点选，如 锅底 / 荤菜',
    categoryHint: '跟菜单栏目一致即可；填过的分类会记住，下次点一下就行',
    tagsPh: '如 招牌、辣、时令',
    tagsHint: '多个标签用逗号隔开，列表里可按标签筛选',
    // 🔴 菜品分类 = **自由文本**，这里只是「建议池」不是枚举（v1.0 M3 §菜品分类 明写"支持自定义"）。
    //   为什么不能枚举：分类横跨 4 个正交维度（出品形态 热菜/凉菜 · 食材属性 荤菜/素菜 ·
    //   业态专属 锅底/蘸料/涮品 · 营销栏目 大口吃肉/招牌推荐），同一道菜可同时落在多个维度上，
    //   加选项永远补不完。⇒ 编辑页是「自由输入 + 本店历史 chips」，本池只作冷启动建议。
    // ⚠️ 本池只许**追加**、不许删改既有值（旧卡的自由输入值靠它回显）。
    dishCats: ['热菜', '凉菜', '荤菜', '素菜', '锅底', '蘸料', '主食', '汤羹', '饮品', '小吃', '其他'],
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
    // round149：用量单位改为**可选**（克/千克/毫升/升）⇒ 标签不再写死 "g"，单位由「用量单位」那一行给。
    qty: '用量',
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
    materialListTitle: '原料库', // R191 改名：「档案」是内部说法，老板看不懂；用途另见 hub.materialSub
    matName: '原料名称',
    matNamePh: '如 鸡胸肉',
    matBrand: '品牌规格',
    matUnit: '采购单位',
    matUnitDefault: '斤',
    matPrice: '采购单价（元）',
    // round155：「一件多少钱」——单价标签带上采购单位，老板不必自己记单位。
    //   与 matConvertOf 同族：同一个「随单位变」的可见文案，页面不自己拼串。
    matPriceOf: (u) => `采购单价（元/${u}）`,
    // round149：把单位写进标签（净料成本恒为「元/克」，与引擎口径一致；不写单位时老板会以为是"元/斤"）
    matNetCost: '净料单位成本（元/克）',
    matCategory: '分类',
    matAliases: '别名',
    matAliasesHint: '逗号分隔，仅用于搜索提示，不会替换原料名',
    matRemark: '备注',
    matAdd: '新增原料',
    matEdit: '编辑原料',
    matSearchPh: '搜索名称或别名',
    matEmpty: '还没有原料，点下方新增',
    // ===== round156 · 原料选择页（**独立页**，不用弹层）=====
    //   为什么独立成页：弹层里放搜索框 ⇒ 弹层 × 键盘是死结（见 PITFALLS §6/§8），
    //   且原生 `<picker mode="selector">` 只能滚、没有搜索与分组 ⇒ 100 个原料要滚十几屏。
    matPickTitle: '选择原料',
    matPickSearchPh: '搜索名称或别名',
    matPickAll: '全部',
    matPickEmpty: '没找到匹配的原料',
    matPickEmptyHint: '换个词试试，或先去原料档案新增',
    // ===== round156 · 列表置顶（店铺级偏好，存 shop 文档 ⇒ 零新建集合）=====
    pinOn: '置顶',
    pinOff: '取消置顶',
    pinTag: '置顶',
    pinnedDone: '已置顶',
    unpinnedDone: '已取消置顶',
    // ===== round156 · 连续录入（保存后**不跳走**，接着录下一道）=====
    //   改前每存一道菜都 navigateBack 回列表 ⇒ 录 30 道菜要来回 60 次。
    //   改后原地清空表单 + 顶部留一条「已保存」横幅 + 显式「返回列表」出口（不打断、也不困住人）。
    savedOk: '已保存',
    savedHint: '可以接着录入下一道',
    backToList: '返回列表',
    // ===== round204 · 原料批量录入（粘贴 → 解析 → 预览 → 导入）=====
    //   由来：原料库首建要录几十上百种，手机逐条填一条约 40 秒 ⇒ 60 种要一小时；
    //   而老板手边本来就有采购价目表（电脑 Excel）⇒ 复制过来最快。
    //   ⚠️ 与「连续录入」是两条路：连续录入解决**零散补 1~3 条**（round156 已落地），
    //   本组解决**首建一批**（几十条起）—— 两者并存，不互相替代。
    matBatchTitle: '批量录入原料',
    matBatchEntry: '批量录入',
    matBatchGuide: '把电脑 Excel 里的原料表复制过来，粘进下面的框；也可以直接按行手打。',
    matBatchPh: '每行一个原料，例如：炸鸡腿  箱装24  件  195  24000  95',
    matBatchCols: '列顺序：名称 · 规格 · 采购单位 · 单价(元) · 换算系数 · 出成率(%)',
    matBatchQuick: '也可以只写两列：名称 · 单价，单位与换算按默认带出',
    matBatchHeaderAuto: '第一行是表头会自动跳过',
    matBatchPasteTip: '在电脑复制 → 微信发给自己 → 手机长按复制 → 回到这里粘贴',
    matBatchParse: '解析',
    matBatchReparse: '重新解析',
    matBatchPreview: '解析结果',
    matBatchOk: '可导入',
    matBatchBad: '有问题',
    matBatchSelectAll: '全选',
    matBatchUnselect: '全不选',
    matBatchSave: '导入选中的原料',
    matBatchSaving: '正在导入…',
    matBatchDoneOf: (n) => `已导入 ${n} 条原料`,
    matBatchFailOf: (n) => `${n} 条没导进去`,
    matBatchEmpty: '先粘贴或手打内容，再点解析',
    matBatchNone: '没解析出原料',
    matBatchNeedConv: '箱/件这类没有通用换算，换算系数要自己填',
    matBatchUnnamed: '这一行缺名称',
    matBatchChecked: '已选',
    matBatchCountOf: (a, b) => `可导入 ${a} 条 · 有问题 ${b} 条`,
    matDelete: '删除',
    matDeleteConfirm: '删除后该原料不再出现在列表，但已保存成本卡的快照不受影响。确定删除？',
    matVirtual: '虚拟原料',
    matVirtualReadonly: '虚拟原料由半成品卡自动生成，不可手动编辑或删除',
    // round151：基准单位词随**采购单位的计量族**走（重量→克 / 体积→毫升 / 计数→个）。
    //   改前恒为「→克」，按「个/箱」买的老板看到的字面量根本没有对应含义。
    //   ⚠️ 族表单源在 `utils/units.js::UNIT_FAMILY`，本处**只拼串、不抄表**。
    matConvert: '换算系数',
    matConvertOf: (w) => `换算系数（→${w}）`,
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
    // R191：列表页顶部只留「找东西」⇒ 必须回报「找到了多少」，否则筛选后看着像没数据。
    countPrefix: '共 ',
    countSuffix: ' 张',
    filterCategory: '分类',
    filterMargin: '毛利率区间',
    marginAll: '全部',
    marginHigh: '高（≥60%）',
    marginMid: '中（30%~60%）',
    marginLow: '低（<30%）',
    // R192：「⋯」菜单项 —— 点卡片主体也能进编辑，但**按钮不能凭空消失**（老板的肌肉记忆在按钮上）
    editCard: '编辑',
    deleteCard: '删除',
    deleteCardConfirm: '删除后该菜品所有版本将移出列表，历史版本仍可在版本历史查看。确定删除？',
    copyCard: '复制',
    copyCardConfirm: '复制为一张新卡（配方相同、全新卡号）。确定复制？',
    syncCard: '同步至原料最新价',
    // R192：卡片**按钮**上用短文案（全名 8 字在两按钮并排时会挤到换行）；
    //   全名 syncCard 仍用于确认弹窗与「⋯」菜单（有整行宽度时说全称更清楚）。
    syncShort: '同步最新价',
    batchSync: '批量同步',
    batchSyncConfirm: '对选中的菜品按原料最新价生成新版本，旧版本保留。确定同步？',
    syncDone: '已生成新版本',
    selectSync: '选择要同步的菜品',
    // ===== 批次 P0 · 成本卡编辑页补全（任务 3）=====
    inputType: '录入方式',
    inputTypeArchive: '从原料档案选择',
    inputTypeManual: '临时手工录入',
    // round153：红「×」删行按钮原来挂在「录入方式」那一行的行尾 ⇒ 被读成"取消临时手工录入"
    //   （实测反馈：老板以为它在否定刚选的录入方式）。改到**明细行末尾**并给足四个字的语义。
    delLine: '删除本行',
    // round153：只有**这一行已经填了东西**才拦一下确认；空行直接删（不为没内容的东西增加摩擦）。
    //   ⚠️ showModal 的 confirmText / cancelText 上限 4 字符（真机事故见 paywall 注释）⇒ 短键单独出来。
    delLineTitle: '删除这一行',
    delLineConfirmOf: (n) => `已填「${n}」，确定删除这一行？`,
    delLineConfirmBare: '这一行还没填完，确定删除？',
    delLineConfirmOk: '删除', // ⚠️ 只用于 showModal confirmText（上限 4 字符）
    manualName: '原料名称',
    manualNamePh: '临时原料名，仅本卡生效',
    // round151：单价**单位可选**（元/斤、元/个…）—— 改前写死「元/克」，老板买 6 元/斤的肉
    //   得自己心算成 0.012 才敢填。现在选「斤」直接填 6，提交前由 `units.priceToBase` 折算回元/克。
    //   ⚠️ 单位**由右侧 picker 显示**，label 保持中性的「单价」⇒ 不再把单位拼进标签（不做第二份口径）。
    manualUnitPrice: '单价',
    manualYield: '出成率（%）',
    activityPrice: '活动特价（元）',
    activityPriceHint: '活动期间的挂牌价，用于计算第二条毛利率',
    warnPriceBelowCost: '售价低于成本，确定保存吗？',
    reverseApply: '填入建议售价',
    // ===== 批次 S0 · 版本恢复 / 标签筛选 / 快照明细 =====
    filterTags: '标签',
    restoreVersion: '按此版本新建',
    restoreVersionConfirm: '将按此版本内容生成一个新版本，现有版本全部保留可查。确定？',
    restoreDone: '已按此版本新建',
    restoring: '正在恢复…',
    snapshotBrand: '品牌规格',
    snapshotUnit: '采购单位',
    snapshotPrice: '采购价',
    snapshotConvert: '换算系数',
    snapshotYield: '出成率',
    // ===== round149 · 采购单位 / 用量单位：同一原料「买」与「用」可以是不同单位 =====
    //   参考外部产品：采购单价 + 采购单位 / 单次用量 + 用量单位，各自独立可选。
    //   ⚠️ 数值（单位倍率 + 建议换算系数）单源在 `utils/units.js`，本处**只放文案**，不许抄表。
    matUnitHint: '点一下填常用单位；换算系数会自动带出建议值，可再手改',
    // round151：第三参 = 基准单位词（由 `units.baseWordOf()` 给出，页面传进来；本处不抄表）
    // round152：把「可手改」**写进换算系数自己那行的提示** —— 改前只有「（净料口径）」，
    //   看着像系统算出的死值；而「可再手改」四个字在采购单位那行的 hint 里，离得太远（真机实测）。
    matConvertHintOf: (u, f, w) => `1 ${u} = ${f} ${w}（净料口径 · 可手改）`,
    // round153：换算系数组合行的**左侧短句**「1 斤 =」—— 与右边 [输入框] + 基准词拼成一句
    //   「1 斤 = 500 克」。为什么非得改控件形态：真机实测反馈，哪怕下方 hint 已经写了「可手改」，
    //   一个孤零零写着 500 的框仍被读成"系统替我算好的结果值"。文字说不清的事交给形态说。
    //   ⚠️ 右侧基准词由页面传（`units.baseWordOf()`），本处不抄单位表。
    matConvertLeftOf: (u) => `1 ${u} =`,
    // round151：跨计量族提示（不拦截）。参考产品在这里栽过 —— 采购「个」× 用量「千克」
    //   它静默按 1:1 硬算，界面跳出 ¥6,000,000.00 一个字都不提示（实测）。
    unitCrossWarn: (pu, qu) => `该原料按「${pu}」采购，这里按「${qu}」用：两者没有通用换算，成本会失真`,
    qtyUnit: '用量单位',
    qtyUnitHint: '按做菜手感选；换单位会自动换算数量，成本不变',
    matSpecHintOf: (p, u, f, yr, net) => `${p} 元/${u} ÷ ${f} ÷ 出成率 ${yr}% ⇒ 净料 ${net} 元/克`,
    matSpecHintEmpty: '选好原料后显示：采购价 ÷ 换算系数 ÷ 出成率 = 净料单价（元/克）',
    // ===== round150 · M3.14 组件分类 + M3.15 多规格（大小份）=====
    //   ⚠️ 组件类型的**机器键**单源在 `cloudfunctions/common/specDerive.js::LINE_KINDS`；
    //     本处是**中文文案**，键集必须与之一致（守卫 `tools/check_spec_derive.js` L5 逐键比对 —— 键名漂了就静默不缩放）。
    //   规格**系数**单源在服务端（`SPEC_PRESETS`）⇒ 页面**不抄系数**、只送 `spec_key`（不做第二份真相源）。
    lineKindTitle: '组件',
    lineKind: { main: '主料', aux: '辅料', season: '调料', semi: '半成品', pack: '耗材' },
    lineKindHint: '半份菜里「调料 / 耗材」不减半（否则没味、包装也省不了）—— 分类只影响规格试算，不影响这份成本',
    //       M3.31 起含「每100g」计重规格 ⇒ 标题不能再只写「大小份」（概括不了计重），改「份量/计重」。
    specTitle: '规格（份量/计重）',
    specHint: '同一道菜挂多个规格：成本按组件类型缩放后**单独试算**，主成本口径不变',
    specEnable: '记入本卡',
    specPriceLabel: '规格售价（元）',
    specCostLabel: '规格成本',
    specMarginLabel: '规格毛利率',
    specSuggestLabel: '建议价（按目标毛利率）',
    specCalc: '规格试算',
    specEmpty: '选好规格后点「规格试算」',
    // 规格 chips 的显示名：**只有键 + 中文名，没有系数**（系数单源在服务端 SPEC_PRESETS）。
    //   键集必须 ≡ 服务端 SPEC_PRESETS 的 spec_key 集合（守卫 L5 逐键比对）。
    specLabel: { half: '半份', small: '小份', per100g: '每100g' },
    // M3v1.2_B（D21/M3.31）：每 100g 计价规格（展示单位 + 口径说明；系数全 1，成本不缩放）
    specPer100gUnit: '100g',
    specPer100gNote: '按 100g 计价，实际按称重结算',
    // ===== M3.16（批次 C）· 套餐（引用型成本卡）=====
    //   套餐能引用其它成本卡（子卡）但不被引用；子卡锁版本；给老板看「顾客省 / 我少赚 / 成本结构」。
    cardType: '卡片类型',
    cardTypeDish: '单品菜品',
    cardTypeCombo: '套餐',
    cardTypeHint: '选「套餐」后，内容从下面「菜品库」里已有的菜添加',
    comboSubCardTitle: '套餐包含的子菜',
    comboSubCardPh: '选择子菜',
    comboSubCardQty: '份数',
    comboAddSubCard: '+ 添加子菜',
    comboPickEmpty: '暂无可用子菜（先建单品菜品）',
    comboInsightCustomerSave: '顾客省了',
    comboInsightMerchantLose: '我少赚了',
    comboInsightLoseWarn: '这个套餐在拉低你的毛利',
    comboInsightCostShare: '成本结构',
    // M3.37（R190）到店团购渠道层：佣金基数 = 顾客实付价（李老师 2026-10-02 定）
    grouponTitle: '团购到手（抖音 / 美团到店）',
    grouponHint: '佣金按顾客实付的团购价算，不是按原价',
    grouponPrice: '团购价（顾客实付）',
    grouponPricePh: '如 88',
    grouponRate: '平台佣金率',
    grouponRatePh: '6',
    grouponPromo: '推广费（选填）',
    grouponCalc: '算到手',
    grouponCommission: '平台佣金',
    grouponNet: '到手',
    grouponProfit: '到手毛利',
    grouponNetRate: '到手毛利率',
    grouponVsDine: '比堂食少赚',
    grouponNeedCost: '先点上方算一次成本',
    grouponNeedPrice: '先填团购价',
    // ===== M3.20（批次 B 收尾）· 标准原料词库 + 菜品模板 =====
    //   只做搜索建议 + 一键起行，**绝不自动替换、绝不预填价格**。
    matLexiconHint: '试试这些常用原料（点一下填入，不会自动改名）',
    templateFrom: '从模板新建',
    templatePickPh: '选一道模板，预填配方（价格留空）',
    templateHint: '模板只预填行名 / 用量 / 单位，价格请自行填写',
    // ===== M3.19（批次 E）· 原料变动影响面 =====
    impactTitle: '涨价影响面',
    impactEmpty: '没有成本卡用到这个原料',
    impactCard: '菜品',
    impactPrice: '现售价',
    impactCost: '成本',
    impactCostChange: '原成本 → 新成本',
    impactMargin: '毛利率',
    impactBelowBand: (x) => `已跌破本业态参考带下限（${x}%）`,
    impactTrend: '成本趋势',
    impactTrendSingle: '只有 1 个版本，暂无成本趋势',
    // ===== M3.21（批次 E）· M1↔M3 率对率对账 =====
    reconTitle: 'M1↔M3 对账',
    reconMenuMargin: 'M3 标准菜单毛利率',
    reconActualMargin: 'M1 实际菜品毛利率',
    reconDiffPp: '差值',
    reconDiffFen: '折算金额',
    reconCoverage: '在售菜品数',
    reconCoveragePh: '本月在售菜品数',
    reconSave: '保存在售数',
    reconIncludeCombo: '含套餐',
    reconMonth: '月份',
    reconSuppressCoverage: '覆盖率不足（<60%），差值可能失真，暂不显示。',
    reconSuppressDetail: '本月外卖用了快速录入，拆不出商品总价，请改用分项录入。',
    reconSuppressNoCount: '请先填写「本月在售菜品数」，才能算覆盖率。',
    reconAttributionTitle: '差额可能来自（只列方向，不下结论）：',
    reconAttr1: '① 有菜没建卡（覆盖率缺口）',
    reconAttr2: '② 卡内价 ≠ 原料现价（部分卡用了旧价）',
    reconAttr3: '③ 出品超耗 / 损耗 / 报废 / 赠送',
    reconAttr4: '④ 口径差异（外卖到手 vs 总额法）',
  },

  // ===== 十四-bis、M3 模块枢纽页（pages/m3/hub）=====
  // 为什么单独建这一页（R191）：此前首页「M3」直接落在**成本卡列表页**，
  //   原料库 / 外卖 / 对账 只能寄生在列表页顶部当按钮 ⇒ 顶部两行里上一行是「找东西」（筛选）、
  //   下一行是「去别处」（跳转），还共用同一个 `.tool-btn` 样式 ⇒ 分类说不明白（李老师 2026-10-02 反馈）。
  //   ⇒ 解耦：枢纽页只做「去哪」，列表页只做「找东西 + 新增」。
  hub: {
    // 🔴 R201：底部 tab 第 2 格由「成本」改「配方」后，本页标题同步改口径 ——
    //   tab 名与页面标题必须一致，否则用户点进来发现标题写着「菜品成本」会以为走错页。
    //   副标题补齐 tab 文字没表达的范围（原料 / 套餐 / 外卖对账），呼应豆包给的口径。
    title: '配方',
    subtitle: '原料、成本、毛利核算',
    // 每张分区卡 = 标题（这件事叫什么）+ 副文案（拿它干什么）。副文案不是装饰：
    //   本仓已知短板＝「术语直给无解释」（权责发生制 / 出成率 / 净料率），老板看名字猜不出用途。
    cardTitle: '菜品及套餐成本卡',
    cardSub: '建卡 · 查卡 · 算成本与毛利',
    materialTitle: '原料库',
    materialSub: '改一次价，用到它的菜全部跟着变',
    takeawayTitle: '外卖菜品成本及利润',
    takeawaySub: '一单卖出去，到手多少、赚多少',
    reconTitle: 'M1↔M3 对账',
    reconSub: '账本上的数 vs 菜品卡推出来的数',
    // 「涨价影响面」不单独占一张卡：它的入口埋在原料库每条原料上（点具体原料才谈得上影响面），
    //   摆在枢纽页会变成「不知道先选哪个原料」的死路 —— 保持 4 张，与方案 §3.1 一致。
    // R192：分区卡左侧图标块的**单字**（不用 emoji：微信真机在部分字体下宽高不一致、会塌行）
    //   ⚠️ 这不是装饰：图标块 = 整卡体积感的抓手（替代 R191 那条被判「像括号」的左侧色条）
    icoCard: '卡',
    icoMaterial: '料',
    icoTakeaway: '外',
    icoRecon: '账',
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
    // R194：店铺管理（新建 / 重命名 / 删除）—— 此前「新增店铺」跳设置页其实只是在改当前店名，
    //   重命名只能改当前店，删除店铺**全站不存在**（免费档 1 家店，误建第 2 家即永久占额度）。
    renameShop: '重命名',
    deleteShop: '删除店铺',
    deleteConfirm: '删除后该店铺不再出现在列表里，也不再占用店铺额度；账本与菜品卡不会被物理清除。确定删除？',
    deleteOk: '删除',
    deleted: '已删除',
    createOk: '创建',
    created: '已创建，已切到新店铺',
    renamed: '已重命名',
    nameRequired: '请先填店铺名称',
    lastOneWarn: '至少要保留一家店铺。想换店，可以先新建一家，再删掉这家。',
    moreHint: '点右侧 ⋯ 可重命名或删除店铺',
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
    privacyAgree: '同意继续', // ⚠️ showModal confirmText ≤4 字符（原 5 字会 fail）
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
    // R193：站级兜底入口 —— 订单/订阅（此前只有到期弹条能进）、客服、使用指引
    // ⚠️ 禁用词守卫：「订阅」属金融类目红线词（付费/订阅/会员费）⇒ 改说「订单 / 有效期」
    ordersEntry: '我的订单 / 有效期',
    serviceEntry: '联系客服',
    guideEntry: '使用指引',
    guideBody: '① 先建店铺：首页顶部店铺名，可切换或新建。\n② 再录一个月：M1 把房租、水电、食材等填进去，就能看到参考利润。\n③ 再算菜品：M3 建菜品成本卡，看每道菜赚多少、该卖多少钱。\n④ 想开店先试算：M2 填投入和每月固定支出，算保本营业额。',
    // 客服会话拉不起时的兜底（未绑客服人员 / 基础库过低）
    serviceNotOpen: '客服暂未开通，可先在「意见反馈」里留言',
    guideOk: '知道了',
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
  'ERR.COMBO_NEST': '套餐里不能再包含另一个套餐',
  'ERR.SUB_CARD_VERSION': '引用的菜品版本已失效，请重新选择',
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
  COMBO_NEST_NOT_ALLOWED: 'ERR.COMBO_NEST',
  SUB_CARD_VERSION_INVALID: 'ERR.SUB_CARD_VERSION',
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
