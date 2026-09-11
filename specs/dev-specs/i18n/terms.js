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
 * 取值：const msg = ERROR_MESSAGES[res.code] || ERROR_MESSAGES['ERR.SYSTEM']
 * 与 core/09_统一错误码表.md §3 同步锁死。
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
  'ERR.SYSTEM': '系统异常，请稍后重试',
  'ERR.NOT_IMPL': '功能暂未开放',
};

module.exports = { TERMS, t, ERROR_MESSAGES };
