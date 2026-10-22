// subpkg/biz/takeaway/index.js —— M3.17 外卖单均 + M3.32 补贴拆行/固定佣金（纯试算页）
//
// ⚠️ 计算下沉：本页**不做任何金额口径计算**，只把用户录入转成分、喂给纯计算单源
//   `utils/takeawayDerive.js`（calcTakeawayOrder / resolveCommission / reverseListedPrice）。
//   试算结果**不落库**；只把「平台参数默认值」经 saveShopSetting 存 shop_switch。
// ⚠️ 付费域：M3 外卖属付费功能（m3_takeaway）⇒ 点「计算」时经 fetchEntitlement 判定，
//   未开通走 openPaywall('takeaway')（与 R159 付费墙口径一致，不自造判断分支）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { openPaywall } = require('../../../utils/paywall.js');
const { fetchEntitlement } = require('../../../utils/entitlement.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { calcTakeawayOrder, reverseListedPrice } = require('../../../utils/takeawayDerive.js');
// 🔴 R259：产品级开关**单源**（账单导入暂停展示）。⚠️ 只作用"账单"，形态 A/B/C 不受影响 ——
//   它们与账单同出一个 tab 与同一个云函数（云函数按表头自动判形态），藏整个 tab 会连带
//   砍掉外卖单品复盘的输入通道。详见 utils/featureFlags.js 头注 + NOTE_2026-10-10。
const FLAGS = require('../../../utils/featureFlags.js');
// 🔴 R303：形态 C 导入的**一级校验**（纯函数 · 零外部依赖）—— 表内自洽的错，导之前就报出来
const { checkImportShape, coveredDates } = require('../../../utils/importSanity.js');

const TK = TERMS.ledger.takeaway;

// 🔴 表形态**机器值**（必须与云函数 cloudfunctions/importSalesBill/service.js::DISH_SHAPES 逐字一致）。
//   契约：云函数返回的 `shape` 是 **机器值**（'dish_sales' / 'combo_detail' / 'waimai_goods'），
//   不是字母序号。曾在此写 `d.shape === 'C'` ⇒ 与 'waimai_goods' 永不相等 ⇒ **恒走账单分支**
//   （真实缺陷：形态 C 表格渲染出「平台/识别到/归月到」全空白、无平台 picker、门禁必挂）。
//   伴侣守卫：tools/check_shape_machine_value.js。
const DISH_SHAPES = {
  A: 'dish_sales',
  B: 'combo_detail',
  C: 'waimai_goods',
  // R432（队列 #43）：京东外卖「订单导出」—— 商品混装在一列，云函数侧新解
  D: 'jd_order_export',
};

// v1.7 形态 C（外卖商品销量）：外卖平台选择项（label 来自 terms 单源；不含 pos —— 堂食不走这条路）
// 🔴 R246：加京东 —— 但**只列 `jd_sku`**（SKU 级 = 商品销量表，正是形态 C 要的表型）；
//   `jd_order`（订单级）是**账单**、走对账路（M3 外卖账单导入），不是"商品销量表" ⇒ 不进本 picker。
//   ⚠️ 两个 enum 值仍都在 `reviewPlatformNames` 里登记（榜单显示名要用），只是 picker 不列 jd_order。
// 🔴 R303（R300 §5.5 定案）· **picker 只列"有真实准确样本证据"的平台**：
//   · `taobao`（淘宝闪购）—— **唯一**有实测样本的：`importSalesBill/service.js:399` 注释
//     「样例已到货（R258/R259 实测：淘宝闪购「商品下载」355 行 = 7 天 × 51 商品）」⇒ 保留。
//   · `other` —— **必须留**：导入区已明文承诺「不会从后台导也没关系 —— 自己用 Excel 列这 3 列，
//     一样能导入」（terms `importColsBody`）⇒ 删了它等于**打断这条不依赖任何平台的自救路径**。
//   · `meituan` / `jd_sku` —— **移出**：李老师 2026-10-17 口供「**京东、美团提供的表不准确**」，
//     且无任何实测样本。军规「**先补验再窄范围承诺**」：列在 picker 里＝我们承诺他能导
//     ⇒ 对不准的平台做确定性承诺，就是「静默错账」的入口。他手上有准确表时仍可走 `other`。
//   · `eleme` —— 从未验证过 ⇒ 同纪律不列名（需要时归 `other`）。
// ⚠️ `TERMS.card.reviewPlatformNames` 的**历史键必须全留**（meituan / eleme / jd_order / jd_sku / taobao / other）
//   —— 已落库的历史数据显示名靠它，删了会让**历史榜单漏出机器值**（R271 老坑）。已核：6 键齐全。
const IMPORT_PLATFORM_OPTIONS = ['taobao', 'other']
  .map((v) => ({ value: v, label: (TERMS.card.reviewPlatformNames[v] || v) }));

// 🔴 R271：平台机器值 → 显示名（**唯一映射处**）。
//   `reviewPlatformNames` 里不含 'pos'（那是堂食，非外卖平台）⇒ 单独兜底，否则界面会漏出机器值。
function platformLabel(v) {
  const p = String(v || '');
  if (!p) return '';
  if (p === 'pos') return '堂食';
  return TERMS.card.reviewPlatformNames[p] || p;
}
// 上次导入平台的本地记忆（按店铺隔离；存本机即可，换机/换人 ⇒ 回到未选，不会选错）。
function lastPlatformKey() {
  const sid = (typeof getApp === 'function' && getApp().globalData && getApp().globalData.shop_id) || '';
  return 'last_import_platform_' + sid;
}

// 🔴 R250：甲级门禁失败**原因**映射（按 `grade.failures[0].code`）。
//   现场：李老师导入京东「sku对账单下载」（**只有表头的空模板**）⇒ 云函数回
//   `CHANNEL_EMPTY 未解析到任何数据行`，而界面只有一句「门禁未通过，已阻断导入」
//   ⇒ 他看不出"是这份文件没数据"，只能反复重试。原因必须透出。
//   口径：**不直接显示云函数原文**（那会让英文 code / 技术措辞漏到界面），一律经本表映射到
//   `TERMS.ledger.takeaway.*`；未登记的 code 走 `importFailRow` 兜底（fail-safe，不静默）。
//   ⚠️ 键必须与云函数 `service.js::checkGradeA` 产出的 code 逐字一致（漏一个 ⇒ 兜底文案，不空白）。
const FAIL_REASON_KEY = {
  CHANNEL_EMPTY: 'importFailEmpty',
  CHANNEL_TOTAL_MISSING: 'importFailTotal',
  SCHEMA_PLATFORM: 'importFailPlatform',
  SCHEMA_BIZDATE: 'importFailRow',
  SCHEMA_AMOUNT: 'importFailRow',
  SCHEMA_QTY: 'importFailRow',
  REQUIRED_SHOP_ID: 'importFailRow',
  REQUIRED_BIZDATE: 'importFailRow',
  REQUIRED_AMOUNT: 'importFailRow',
};

// 门禁失败 ⇒ 一句人话原因（无失败/未登记 code ⇒ 空串，界面不渲染那一行）。
function failReasonText(grade) {
  const f = grade && grade.failures && grade.failures[0];
  if (!f) return '';
  const key = FAIL_REASON_KEY[f.code] || 'importFailRow';
  return TK[key] || '';
}

function newItem() { return { card_id: '', card_name: '', qty: '1' }; }
function newPack() { return { material_id: '', qty: '1', unit_price_yuan: '' }; }
function defaultParams() {
  return {
    commission_mode: 'rate',
    commission_rate: '6',
    commission_min_yuan: '',
    commission_fixed_yuan: '',
    delivery_fee_yuan: '',
    delivery_subsidy_yuan: '',
    promo_yuan: '',
    pack_fee_yuan: '',
    delivery_customer_yuan: '',
    s_user: { amount_yuan: '', payer: '' },
    s_merchant: { amount_yuan: '', payer: 'merchant' },
  };
}

Page({
  data: {
    t: {
      title: TK.title,
      modeCash: TK.modeCash,
      modeAccrual: TK.modeAccrual,
      modeCashDesc: TK.modeCashDesc,
      modeAccrualDesc: TK.modeAccrualDesc,
      commissionBaseNote: TK.commissionBaseNote,
      dishTitle: TK.dishTitle,
      dishPick: TK.dishPick,
      dishPickPh: TK.dishPickPh,
      qty: TK.qty,
      addDish: TK.addDish,
      packTitle: TK.packTitle,
      packTempPh: TK.packTempPh,
      packQty: TK.packQty,
      addPack: TK.addPack,
      paramsTitle: TK.paramsTitle,
      commissionMode: TK.commissionMode,
      commissionModeRate: TK.commissionModeRate,
      commissionModeFixed: TK.commissionModeFixed,
      commissionRate: TK.commissionRate,
      commissionMin: TK.commissionMin,
      commissionFixed: TK.commissionFixed,
      deliveryFee: TK.deliveryFee,
      deliverySubsidy: TK.deliverySubsidy,
      promoFee: TK.promoFee,
      packFee: TK.packFee,
      deliveryCustomer: TK.deliveryCustomer,
      subsidyTitle: TK.subsidyTitle,
      subsidyUser: TK.subsidyUser,
      subsidyMerchant: TK.subsidyMerchant,
      payer: TK.payer,
      payerUnset: TK.payerUnset,
      payerMerchant: TK.payerMerchant,
      payerPlatform: TK.payerPlatform,
      resultTitle: TK.resultTitle,
      payment: TK.payment,
      receipt: TK.receipt,
      profit: TK.profit,
      receiptRate: TK.receiptRate,
      dishCost: TK.dishCost,
      packCost: TK.packCost,
      revenue: TK.revenue,
      expense: TK.expense,
      reverseTitle: TK.reverseTitle,
      targetProfit: TK.targetProfit,
      reverseBtn: TK.reverseBtn,
      reverseResult: TK.reverseResult,
      rateLowHint: TK.rateLowHint,
      // M3.17 账单导入（批次 F 阶段① 第二 tab）
      importTab: TK.importTab,
      importPick: TK.importPick,
      importPickHint: TK.importPickHint,
      // R282：导入「去哪下载这张表」引导 —— 🔴 页面 t:{} 是**逐条列举**，
      //   漏登记 = 页面静默空白（本仓已踩过的红线，守 check_page_terms）。
      importWhereTitle: TK.importWhereTitle,
      importWhereBody: TK.importWhereBody,
      importColsTitle: TK.importColsTitle,
      importColsBody: TK.importColsBody,
      importPlatformLabel: TK.importPlatformLabel,
      importRowsLabel: TK.importRowsLabel,
      importMonthsLabel: TK.importMonthsLabel,
      importTotalLabel: TK.importTotalLabel,
      importExcludedLabel: TK.importExcludedLabel,
      importRowUnit: TK.importRowUnit,
      importDaysUnit: TK.importDaysUnit,
      importSuccessPlat: TK.importSuccessPlat,
      importConfirm: TK.importConfirm,
      importSuccess: TK.importSuccess,
      importGoLater: TK.importGoLater,
      // P0#8：导入成功结果条（替代原 showModal —— 两出口放不下）；goRecon/goDishReview 见下方
      goRecon: TK.goRecon,
      goDishReview: TK.goDishReview,
      importFail: TK.importFail,
      // 🔴 R250：门禁失败原因四键（`failReasonText()` 按 failures[0].code 取）
      importFailEmpty: TK.importFailEmpty,
      importFailTotal: TK.importFailTotal,
      importFailPlatform: TK.importFailPlatform,
      importFailRow: TK.importFailRow,
      importNoFile: TK.importNoFile,
      importEmpty: TK.importEmpty,
      // R259：账单暂停态文案（第三处登记 —— 漏映射 ⇒ 页面渲染成**空白**且零报错，R124 同族）
      importBillPaused: TK.importBillPaused,
      importBillPausedHint: TK.importBillPausedHint,
      // R271：跨平台重复导入防护 + 回执/暂停态说人话
      importDupTitle: TK.importDupTitle,
      importDupBody: TK.importDupBody,
      importDupFix: TK.importDupFix,
      importBillRecognized: TK.importBillRecognized,
      // v1.7 形态 C（外卖商品销量）：平台机器判不出 ⇒ 必须选平台
      importShapeCHint: TK.importShapeCHint,
      importPickPlatform: TK.importPickPlatform,
      importPickPlatformHint: TK.importPickPlatformHint,
      importZeroAmountLabel: TK.importZeroAmountLabel,
      // R286：导入失败「缺哪几列」回执（第三处登记 —— 漏映射 ⇒ 页面渲染成**空白**且零报错）
      importDiagTitle: TK.importDiagTitle,
      importDiagBody: TK.importDiagBody,
      importDiagFound: TK.importDiagFound,
      importDiagExcluded: TK.importDiagExcluded,
      importDiagEmpty: TK.importDiagEmpty,
      // 🔴 R303 一级校验（标题 + 四条模板；`{n}` 由 js 替换，wxml 不做字符串处理）
      importSanityTitle: TK.importSanityTitle,
      importSanityNoDays: TK.importSanityNoDays,
      importSanityCrossMonth: TK.importSanityCrossMonth,
      importSanityZeroTotal: TK.importSanityZeroTotal,
      importSanityOddAvgPrice: TK.importSanityOddAvgPrice,
      save: TERMS.buttons.save,
      cancel: TERMS.buttons.cancel,
      cur: '¥',
      loading: TERMS.ui.loading,
      // ── R234/J4d 行内长提示折叠（本页 2 处：importPickHint 33 字 / importShapeCHint 20 字）──
      // ⚠️ R238：importPickHint 由 22 字改到 **33 字**（补「堂食《菜品销售统计》也从这里导」）——
      //    改的是**文案、不是节点** ⇒ 仍 ≥18 字、仍在折叠块内，`check_hint_fold` 的分层线
      //    （takeaway.keepPlain=1）不受影响。
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语），**不在** TK(takeaway) 里。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    tab: 'calc',          // 'calc' 单均测算 | 'import' 导入
    // 🔴 R259：账单导入开关（单源 utils/featureFlags.js）。false ⇒ 账单预览不展示数字、
    //   不给「确认导入」按钮；形态 A/B/C（堂食菜品统计 / 套餐明细 / 外卖商品销量）照常可导。
    billImportOn: FLAGS.BILL_IMPORT_ENABLED,
    mode: 'cash',          // 'cash' 到手口径 | 'accrual' 总额法口径
    // R234/J4d：行内长提示折叠（本页 2 处，默认收起）。与月录入页 / M2 / assetEdit / amortize **同一实现**。
    hintFold: {},
    dishes: [],            // 候选卡/套餐（含 card_type）
    items: [newItem()],
    packs: [newPack()],
    params: defaultParams(),
    // 承担方 picker：值序 = ['', 'merchant', 'platform']（未选/商家/平台）
    payerOptions: ['', 'merchant', 'platform'],
    payerLabels: [TK.payerUnset, TK.payerMerchant, TK.payerPlatform],
    result: null,          // calcTakeawayOrder 双口径输出
    reverseResultFen: 0,
    targetProfitYuan: '',
    loading: true,
    saving: false,
    // M3.17 账单导入（批次 F 阶段①）
    importFileID: '',      // 云存储 fileID
    importPlatform: '',    // 检测到的平台
    importGrade: null,     // 甲级门禁结果
    importFailReason: '',  // 🔴 R250：门禁失败原因（failures[0].code → 人话），空串 ⇒ 不渲染该行
    importDiagText: '',    // 🔴 R286：认不出表时的「缺哪几列」人话（空串 ⇒ 不渲染）
    // 🔴 R303：一级校验结论（表内自洽的错）。空串 ⇒ 不渲染（没发现问题，**不假报"一切正常"**）
    importSanityText: '',
    importDiagFoundText: '', // R286：表里实际读到的列名（给老板对照自己导的表对不对）
    importPreview: null,   // 预览 { rows, totals, months, excluded }
    importing: false,      // 防重复提交
    // v1.7 形态 C（外卖商品销量）：platform 机器判不出 ⇒ 必须选平台
    importShape: '',                    // 机器值：'' | 'dish_sales' | 'waimai_goods'（见顶部 DISH_SHAPES）
    shapeC: DISH_SHAPES.C,              // wxml 不读 JS 常量 ⇒ 单源经 data 下发（禁止在 wxml 里写字面量）
    importPlatformOptions: IMPORT_PLATFORM_OPTIONS,   // [{ value, label }]（label 来自 terms 单源）
    importPlatformIndex: -1,            // -1 = 未选
    importPlatformChoice: '',           // 提交值（形态 C 落库用）
    importPlatformChoiceLabel: '',      // picker 显示名
    importZeroAmountQty: [],            // 预览：零元行（v1.7 C-5）
    importPlatformMissing: false,       // 预览期平台必空（云函数回该标志）⇒ 不据此禁用「确认导入」
    // ===== R271：跨平台重复导入防护 =====
    importDup: null,                    // 云函数回的 { dup, platform, hit, scanned }
    importDupText: '',                  // 警告正文（js 侧拼好，wxml 不做字符串处理）
    importDupFixText: '',               // 「改选『X』覆盖」引导句
    importDupBlock: false,              // 命中 ⇒ 禁用「确认导入」（防销量翻倍）
    importPlatformLabel: '',            // 账单分支：识别到的平台显示名（暂停态要"说清认成了什么"）
    importBillRecognizedText: '',       // 账单分支：「识别到：X · N 行 · M月」（暂停态露出来，别只说"打磨中"）
    // P0#8：导入成功结果条（常驻，给老板明确下一步）
    importDone: false,
    importDoneText: '',
  },

  // R281 O3：支持从枢纽页引导块直达「销量导入」tab —— /subpkg/biz/takeaway/index?tab=import
  //   （原来 onLoad 不读 options ⇒ 引导第③步跳过来仍停在「单均测算」tab，等于白跳）
  onLoad(options) {
    if (options && options.tab === 'import') this.setData({ tab: 'import' });
    this.load();
  },

  // R234/J4d：行内提示折叠开关（仓内统一形态，五页同一实现 —— 不各写一套，否则改判据要改五处）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;                       // 无 key ⇒ 静默返回（不误翻别人的状态）
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  async load() {
    try {
      await api.ensureShop();
      ui.setTitle(TK.title);
      // 候选卡/套餐：非套餐卡（单品）+ 套餐卡都可作为一单的组成项
      const cd = await api.call('getCostCard', {});
      const dishes = (cd.list || []).map((c) => ({
        card_id: c.card_code,
        name: c.name || '',
        card_type: c.card_type,
        unit_cost_fen: c.total_cost_fen || 0,
        price_fen: c.price_fen || 0,
      }));
      // 读回平台参数默认值（shop_switch.m3_takeaway_params）
      let params = defaultParams();
      try {
        const sc = await api.call('getShopContext', {});
        if (sc.takeaway_params) {
          const saved = JSON.parse(sc.takeaway_params);
          params = Object.assign(defaultParams(), saved, {
            s_user: Object.assign(defaultParams().s_user, saved.s_user),
            s_merchant: Object.assign(defaultParams().s_merchant, saved.s_merchant),
          });
        }
      } catch (e) { /* 参数读失败用默认，不阻断 */ }
      this.setData({ dishes, params, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // ===== 录入事件 =====
  onMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  onItemPick(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const opt = this.data.dishes[Number(e.detail.value)];
    if (!opt) return;
    const items = this.data.items.slice();
    items[idx] = Object.assign({}, items[idx], { card_id: opt.card_id, card_name: opt.name });
    this.setData({ items });
  },
  onItemQty(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const items = this.data.items.slice();
    items[idx] = Object.assign({}, items[idx], { qty: e.detail.value });
    this.setData({ items });
  },
  addItem() { this.setData({ items: this.data.items.concat([newItem()]) }); },
  delItem(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.items.filter((x, i) => i !== idx);
    this.setData({ items: rest.length ? rest : [newItem()] });
  },
  onPackPrice(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const packs = this.data.packs.slice();
    packs[idx] = Object.assign({}, packs[idx], { unit_price_yuan: e.detail.value });
    this.setData({ packs });
  },
  onPackQty(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const packs = this.data.packs.slice();
    packs[idx] = Object.assign({}, packs[idx], { qty: e.detail.value });
    this.setData({ packs });
  },
  addPack() { this.setData({ packs: this.data.packs.concat([newPack()]) }); },
  delPack(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.packs.filter((x, i) => i !== idx);
    this.setData({ packs: rest.length ? rest : [newPack()] });
  },
  onParam(e) {
    const field = e.currentTarget.dataset.field;   // params 顶层字段名
    const params = this.data.params;
    params[field] = e.detail.value;
    this.setData({ params });
  },
  onCommissionMode(e) {
    this.setData({ 'params.commission_mode': e.detail.value });
  },
  onSubsidyAmount(e) {
    const which = e.currentTarget.dataset.which;   // 's_user' | 's_merchant'
    const params = this.data.params;
    params[which].amount_yuan = e.detail.value;
    this.setData({ params });
  },
  onPayer(e) {
    const which = e.currentTarget.dataset.which;
    const idx = Number(e.detail.value);
    const params = this.data.params;
    params[which].payer = this.data.payerOptions[idx] || '';
    this.setData({ params });
  },
  onTargetProfit(e) { this.setData({ targetProfitYuan: e.detail.value }); },

  // ===== 组装订单（元→分） =====
  buildOrder() {
    const fen = (v) => Math.round(Number(((Number(v) || 0) * 100).toFixed(10)));
    const p = this.data.params;
    const items = this.data.items.filter((it) => it.card_id).map((it) => ({ card_id: it.card_id, qty: Number(it.qty) || 0 }));
    const packs = this.data.packs.filter((pk) => fen(pk.unit_price_yuan) > 0).map((pk) => ({ qty: Number(pk.qty) || 0, unit_price_fen: fen(pk.unit_price_yuan) }));
    const params = {
      commission_mode: p.commission_mode,
      commission_rate: Number(p.commission_rate) || 0,
      commission_min_fen: fen(p.commission_min_yuan),
      commission_fixed_fen: fen(p.commission_fixed_yuan),
      delivery_fee_fen: fen(p.delivery_fee_yuan),
      delivery_subsidy_fen: fen(p.delivery_subsidy_yuan),
      promo_fen: fen(p.promo_yuan),
      pack_fee_fen: fen(p.pack_fee_yuan),
      delivery_customer_fen: fen(p.delivery_customer_yuan),
      s_user: { amount_fen: fen(p.s_user.amount_yuan), payer: p.s_user.payer || null },
      s_merchant: { amount_fen: fen(p.s_merchant.amount_yuan), payer: p.s_merchant.payer || null },
    };
    return { items, packs, params };
  },
  lookup(id) {
    const d = this.data.dishes.find((x) => x.card_id === id);
    return d ? { unit_cost_fen: d.unit_cost_fen, price_fen: d.price_fen } : {};
  },

  // ===== 计算（付费墙：点「计算」时拦）=====
  async onCalc() {
    const ent = await fetchEntitlement().catch(() => null);
    if (!ent || !ent.is_active) {
      openPaywall('takeaway', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
      return;
    }
    const order = this.buildOrder();
    if (order.items.length === 0) { wx.showToast({ title: TK.dishPick, icon: 'none' }); return; }
    const result = calcTakeawayOrder(order, (id) => this.lookup(id));
    const fmt = (fen) => (fen / 100).toFixed(2);
    this.setData({
      result,
      view: {
        payment: fmt(result.cash.payment_fen),
        receipt: fmt(result.cash.receipt_fen),
        profit: fmt(result.cash.profit_fen),
        receipt_rate: result.cash.receipt_rate,
        dish_cost: fmt(result.cash.dish_cost_fen),
        pack_cost: fmt(result.cash.pack_cost_fen),
        revenue: fmt(result.accrual.revenue_fen),
        expense: fmt(result.accrual.expense_fen),
        profit_accrual: fmt(result.accrual.profit_fen),
        rate_low: result.cash.receipt_rate < 70,
      },
    });
  },

  // ===== 挂牌价反算（P* = 商品挂牌总价，不含打包费）=====
  // 🔴 R299（缺陷 T3 · 静默错数且**直接害钱**）：原实现读 `this.data.result`（只有点过「计算」才有值）
  //   ⇒ 两条错路：
  //     ① **没点过「计算」直接点「反算」** ⇒ `dish_cost_fen` / `pack_cost_fen` 都取 0
  //        ⇒ `reverseListedPrice` 的分子 = `0 + 0 + 目标利润 + 补贴 + 配送 + 顾客配送费 − 打包费`
  //        ⇒ **完全没有食材成本与包装成本** ⇒ 反算出的挂牌价**严重偏低**，
  //        而界面照常显示「反算挂牌价：¥X」⇒ **老板照它定价就是亏本卖**（零报错）。
  //     ② 点过「计算」后**改了菜品 / 数量 / 打包**再点反算 ⇒ 用的是**上一次的旧成本**。
  //   修法：**按当前录入自算**（同一份纯单源 `calcTakeawayOrder`，零新增口径），不再读 `this.data.result`。
  // 🔴 R299（缺陷 T4 · 付费墙缺口）：本入口原先**不过付费墙**（同页「计算」过了 `fetchEntitlement`）
  //   ⇒ 未开通用户可直接用反算 —— 而反算属**同一个**付费能力 `m3_takeaway`。
  //   口径与 `onCalc` **逐字对齐**（不自造判断分支，守 R159）。
  async onReverse() {
    const ent = await fetchEntitlement().catch(() => null);
    if (!ent || !ent.is_active) {
      openPaywall('takeaway', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
      return;
    }
    const order = this.buildOrder();
    // 🔴 未选菜品 ⇒ 与「计算」**同一句提示**且**不产出数**（否则会用零成本算出一个看着合理的挂牌价）
    if (order.items.length === 0) { wx.showToast({ title: TK.dishPick, icon: 'none' }); return; }
    const cur = calcTakeawayOrder(order, (id) => this.lookup(id));
    const subsidyMerchantFen =
      (order.params.s_user.payer === 'merchant' ? order.params.s_user.amount_fen : 0) +
      (order.params.s_merchant.payer === 'merchant' ? order.params.s_merchant.amount_fen : 0);
    const pStar = reverseListedPrice({
      dish_cost_fen: cur.cash.dish_cost_fen,
      pack_cost_fen: cur.cash.pack_cost_fen,
      target_profit_fen: Math.round(Number(((Number(this.data.targetProfitYuan) || 0) * 100).toFixed(10))),
      subsidy_merchant_fen: subsidyMerchantFen,
      delivery_fee_fen: order.params.delivery_fee_fen,
      delivery_customer_fen: order.params.delivery_customer_fen,
      pack_fee_fen: order.params.pack_fee_fen,
      commission_rate: order.params.commission_rate,
    });
    this.setData({ reverseResultFen: pStar, reverseResultYuan: pStar > 0 ? (pStar / 100).toFixed(2) : '' });
  },

  // ===== 保存平台参数默认值（shop_switch，试算结果不落库）=====
  async onSaveParams() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.call('saveShopSetting', { takeaway_params: JSON.stringify(this.data.params) });
      wx.showToast({ title: TERMS.ui.savedDone, icon: 'success' });
    } catch (e) { api.toastError(e); }
    this.setData({ saving: false });
  },

  // ===== M3.17 账单导入（批次 F 阶段① 第二 tab）=====
  onTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },

  // 选文件 → 上传云存储 → importSalesBill(confirm=false) 预览（不落库）
  async onChooseFile() {
    if (this.data.importing) return;
    try {
      const res = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx'] });
      const file = res.tempFiles && res.tempFiles[0];
      if (!file) return;
      this.setData({ importing: true });
      wx.showLoading({ title: TERMS.ui.loading, mask: true });
      // 上传到云存储（路径带时间戳，防同名覆盖）
      const cloudPath = 'sales_bills/' + Date.now() + '_' + (file.name || 'bill.xlsx');
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      const fileID = up.fileID;
      // 调云函数解析 + 甲级门禁，confirm=false 只预览
      const d = await api.call('importSalesBill', { fileID, confirm: false });
      wx.hideLoading();
      // 🔴 R286：云函数认不出这张表 ⇒ 走 **ok 的 data** 回诊断（fail 的 msg 会被 api.js:47 覆盖成通用文案）
      //   ⇒ 只有从这里取才拿得到「缺哪几列」；不进预览态、不给确认按钮（fail-closed 语义不变）。
      if (d && d.diagnosis) {
        const dg = d.diagnosis;
        const miss = (dg.missing && dg.missing[dg.nearest]) || [];
        let body = '';
        if (dg.reason === 'empty_table') {
          body = TK.importDiagEmpty || '';
        } else if (dg.reason === 'cols_ok_but_excluded') {
          body = (TK.importDiagExcluded || '').replace('{col}', dg.excludedBy || '');
        } else {
          body = (TK.importDiagBody || '').replace('{cols}', miss.join('、'));
        }
        this.setData({
          importing: false,
          importDone: false, importDoneText: '',
          importFileID: fileID,
          importShape: '', importPlatform: '', importGrade: null, importPreview: null,
          importFailReason: '', importBillRecognizedText: '', importPlatformLabel: '',
          importSanityText: '',
          importPlatformMissing: false, importZeroAmountQty: [],
          importDup: null, importDupText: '', importDupFixText: '', importDupBlock: false,
          importDiagText: body,
          importDiagFoundText: (dg.foundCols && dg.foundCols.length)
            ? (TK.importDiagFound || '').replace('{cols}', dg.foundCols.slice(0, 8).join('、')) : '',
        });
        return;
      }
      // 识别成功 ⇒ 清掉上一次的诊断回执（避免旧提示一直挂着）
      if (this.data.importDiagText || this.data.importDiagFoundText) {
        this.setData({ importDiagText: '', importDiagFoundText: '' });
      }
      const p = d.preview || null;
      // R432：形态 D（京东外卖订单导出）的输出结构与 C 完全一致（groups/totals）
      //   ⇒ 共用同一段分组预览。变量名沿用 isC（下面 6 处都读它），语义 = 走分组路径。
      const isC = d.shape === DISH_SHAPES.C || d.shape === DISH_SHAPES.D;
      let preview = null;
      // 🔴 R303：一级校验结论（默认空串 ⇒ 不渲染；不假报"一切正常"）
      let sanityText = '';
      if (isC) {
        // 形态 C：按天分组（groups），无 months/excluded；零元行必须可见（v1.7 C-5）。
        // 🔴 分 → 元 必须**在括号外**除（R232j 修）：原写法 `(x || 0 / 100).toFixed(2)`
        //   把 `/100` 放进了 `||` 右支 ⇒ 只在 x 为假时才除，真值时原样输出分值（182308.00，放大 100 倍）。
        const amtFen = (p && p.totals && typeof p.totals.amountFen === 'number') ? p.totals.amountFen : 0;
        // 日期范围（首日 ~ 末日）：groups 已按 bizDate 升序排（云函数 sort 保证）
        const gs = (p && p.groups) ? p.groups : [];
        const first = gs.length ? String(gs[0].bizDate || '') : '';
        const last = gs.length ? String(gs[gs.length - 1].bizDate || '') : '';
        preview = {
          groupCount: gs.length,
          dateRangeText: (first && last) ? (first === last ? first : (first + ' ~ ' + last)) : '',
          amountYuan: (amtFen / 100).toFixed(2),
        };
        // 🔴 R303 一级校验（零外部依赖）：只用这张表自身能自证的错 ⇒ 导之前就告诉老板。
        //   覆盖：无日期 / 跨月 / 有销量但金额全 0 / **均价异常（疑销量与金额列写反）**。
        //   见 utils/importSanity.js 头注（含"为什么不做'只覆盖 N 天不是整月'"）。
        sanityText = this.buildSanityText(checkImportShape({
          groupDates: coveredDates(gs),
          totalQty: (p && p.totals && p.totals.qty) || 0,
          totalAmountFen: amtFen,
        }));
      } else {
        // 账单（批次 F）：amount 分→元、months join 都在这里做（wxml 不做法调用 / 浮点除法）
        preview = p ? {
          rowCount: p.totals.rowCount,
          amountYuan: (p.totals.amountFen / 100).toFixed(2),
          monthsText: (p.months || []).join('、'),
          excludedRows: (p.excluded && p.excluded.rows) || 0,
        } : null;
      }
      this.setData({
        importing: false,
        importDone: false, importDoneText: '',
        importFileID: fileID,
        importShape: d.shape || '',
        importPlatform: d.platform || '',
        importGrade: d.grade || null,
        // 🔴 形态 C：预览期 platform 必空（用户还没选）⇒ 云函数回 platform_missing，
        //   此时**不能**用 grade.pass 挡住确认按钮（否则 picker 在按钮旁边却永远点不到 = 死锁）。
        //   平台的阻断在 confirm 分支（云函数 `if (!platform) return fail`）+ 前端
        //   `onConfirmImport` 的 picker 兜底，两处都拦得住，不必在预览期拦。
        importPlatformMissing: !!d.platform_missing,
        // 🔴 R250：门禁没过时把**原因**一并落到 data（wxml 在那句笼统提示下面渲染一行人话）
        importFailReason: failReasonText(d.grade),
        // 🔴 R303：一级校验结论（空串 ⇒ 不渲染）
        importSanityText: sanityText,
        importPreview: preview,
        importZeroAmountQty: (isC && p && p.zeroAmountQty) ? p.zeroAmountQty : [],
        // 形态 C 平台选择重置
        importPlatformIndex: -1,
        importPlatformChoice: '',
        importPlatformChoiceLabel: '',
        // 🔴 R271：形态 C 默认带上「上次用的平台」（老板每月导一次，不让他每次都重新想）。
        //   ⚠️ 只是**预选**，picker 里看得见、可改；不是静默替他选。
        importPlatformIndex: isC ? this.savedPlatformIndex() : -1,
        importPlatformChoice: (isC && this.savedPlatformIndex() >= 0)
          ? (IMPORT_PLATFORM_OPTIONS[this.savedPlatformIndex()] || {}).value : '',
        // 账单分支：把"这张表被认成什么了"说清楚（平台 + 行数 + 月份）⇒ 老板知道该换哪种表
        importPlatformLabel: platformLabel(d.platform),
        importBillRecognizedText: (!isC && p && p.totals) ? this.buildRecognizedText(d.platform, p) : '',
      });
      // 预选了平台 ⇒ 立刻查一次重复（不等点「确认导入」才报错）
      if (isC && this.data.importPlatformChoice) this.refreshDup();
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      api.toastError(e);
    }
  },

  // 🔴 R303：一级校验结论 → 一句人话（**wxml 不做字符串处理**，与 importDupText / buildRecognizedText 同一约定）
  //   多条问题用「；」连成一行；**没有问题 ⇒ 回空串**（不渲染，也**不假报"一切正常"** ——
  //   假报"正常"会让老板以为我们验过了，而一级校验只看"表内自洽"，看不了"表对不对"）。
  buildSanityText(issues) {
    const list = Array.isArray(issues) ? issues : [];
    if (!list.length) return '';
    const T = this.data.t;
    const parts = [];
    for (const it of list) {
      if (it.code === 'noDays') parts.push(T.importSanityNoDays);
      else if (it.code === 'crossMonth') parts.push(String(T.importSanityCrossMonth).replace('{n}', String(it.value)));
      else if (it.code === 'zeroTotal') parts.push(T.importSanityZeroTotal);
      else if (it.code === 'oddAvgPrice') parts.push(String(T.importSanityOddAvgPrice).replace('{n}', String(it.value)));
    }
    return parts.length ? ((T.importSanityTitle || '') + '：' + parts.join('；')) : '';
  },

  // 形态 C 平台选择（v1.7 §2.5：platform 机器判不出 ⇒ 必须选平台；未选 ⇒ 提交禁用）
  onImportPlatformPick(e) {
    const i = Number(e.detail.value);
    const opt = this.data.importPlatformOptions[i];
    this.setData({
      importPlatformIndex: i,
      importPlatformChoice: opt ? opt.value : '',
      importPlatformChoiceLabel: opt ? opt.label : '',
      // 换平台 ⇒ 先清掉上一次的重复判定（避免残留旧结论把按钮一直禁用）
      importDup: null, importDupText: '', importDupFixText: '', importDupBlock: false,
    });
    if (opt && opt.value) this.refreshDup();
  },

  // ===== R271：跨平台重复导入防护 =====

  // 本机记忆的上次平台（返回 picker 下标；没记过 ⇒ -1）
  savedPlatformIndex() {
    try {
      const v = wx.getStorageSync(lastPlatformKey());
      if (!v) return -1;
      for (let i = 0; i < IMPORT_PLATFORM_OPTIONS.length; i += 1) {
        if (IMPORT_PLATFORM_OPTIONS[i].value === v) return i;
      }
    } catch (e) { /* 读不到 ⇒ 当没记过 */ }
    return -1;
  },

  // 账单暂停态的「识别到：X · N 行 · M月」整句（wxml 不做字符串拼接 ⇒ js 侧拼好）
  buildRecognizedText(platform, p) {
    const plat = platformLabel(platform) || '未知平台';
    const rows = (p && p.totals && p.totals.rowCount != null) ? p.totals.rowCount : 0;
    const months = ((p && p.months) || []).join('、');
    return (TERMS.ledger.takeaway.importBillRecognized || '')
      .replace('{plat}', plat).replace('{rows}', String(rows)).replace('{months}', months || '-');
  },

  // 选完平台后**立即**查一次「这批数据是不是已经用别的平台导过」。
  //   · 为什么不在点「确认导入」时才拦：那时老板已经走完流程才被弹回，体验差；
  //     现在改成选完平台就提示，并**直接禁用按钮**，他只需把平台改回原来的即可。
  //   · 云函数 fail 的 msg 会被 `api.call` 覆盖成 code→i18n 通用文案（见 utils/api.js:47）
  //     ⇒ 人话必须走**预览通道**（ok 的 data）回来，这里拿得到。
  async refreshDup() {
    const fileID = this.data.importFileID;
    const platform = this.data.importPlatformChoice;
    if (!fileID || !platform || this.data.importShape !== DISH_SHAPES.C) return;
    try {
      const d = await api.call('importSalesBill', { fileID, platform, confirm: false });
      const dup = d && d.dup;
      if (dup && dup.dup) {
        const oldLabel = platformLabel(dup.platform) || '另一个平台';
        const curLabel = platformLabel(platform) || '当前平台';
        this.setData({
          importDup: dup,
          importDupText: (TERMS.ledger.takeaway.importDupBody || '')
            .replace('{old}', oldLabel).replace('{n}', String(dup.hit)).replace('{cur}', curLabel),
          importDupFixText: (TERMS.ledger.takeaway.importDupFix || '').replace('{old}', oldLabel),
          importDupBlock: true,
        });
      } else {
        this.setData({ importDup: dup || null, importDupText: '', importDupFixText: '', importDupBlock: false });
      }
    } catch (e) {
      // 查重复失败 ⇒ **不阻断导入**（这只是预防性提示，不能反过来变成新的卡点）
      this.setData({ importDup: null, importDupText: '', importDupFixText: '', importDupBlock: false });
    }
  },

  // 用户确认 → importSalesBill(confirm=true) 落库
  async onConfirmImport() {
    if (!this.data.importFileID) { wx.showToast({ title: TK.importNoFile, icon: 'none' }); return; }
    if (this.data.importing) return;
    // 形态 C：必须先选平台（缺值云函数也会 fail，此处前端兜底拦住，避免白跑一趟）
    const platform = this.data.importShape === DISH_SHAPES.C ? this.data.importPlatformChoice : this.data.importPlatform;
    if (this.data.importShape === DISH_SHAPES.C && !platform) {
      wx.showToast({ title: this.data.t.importPickPlatform, icon: 'none' });
      return;
    }
    this.setData({ importing: true });
    try {
      wx.showLoading({ title: TK.importIng, mask: true });
      await api.call('importSalesBill', { fileID: this.data.importFileID, platform, confirm: true });
      wx.hideLoading();
      // 🔴 R271：记住本次平台（下次预选），并在结果条文里**说清是按哪个平台落库的**
      //   —— 此前回执只说"导入完成"，老板回头看到复盘页某个平台下有数据，对不上自己刚才选的啥。
      try { if (platform) wx.setStorageSync(lastPlatformKey(), platform); } catch (e) { /* 存不了不影响主流程 */ }
      const platName = platformLabel(platform) || '';
      // 导入成功后：清预览态 + 展示「成功结果条」（P0#8：给老板明确下一步）。
      // 🔴 不再用 showModal：modal 只能 confirm/cancel，放不下「看单品毛利」「去对账」两个出口；
      //   改用常驻结果条（importDone），老板可慢慢读、两个按钮都能点。
      this.setData({
        importing: false,
        importFileID: '', importShape: '', importPlatform: '', importGrade: null,
        importFailReason: '', importSanityText: '',
        importPreview: null, importPlatformIndex: -1, importPlatformChoice: '', importPlatformChoiceLabel: '', importZeroAmountQty: [],
        // 🔴 R271：清空重复判定，避免残留旧结论把下次导入的「确认导入」一直禁用
        importDup: null, importDupText: '', importDupFixText: '', importDupBlock: false,
        // P0#8：成功结果条（常驻：标题=importSuccess、正文=importDoneText、两个出口按钮）
        importDone: true,
        importDoneText: platName
          ? (TK.importSuccessPlat || '').replace('{name}', platName)
          : (TK.importDoneBodyPlain || ''),
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      api.toastError(e);
    }
  },

  // P0#8：导入成功结果条 —— 两个出口 + 收起
  goRecon() { wx.navigateTo({ url: '/subpkg/tools/recon/index' }); },
  goDishReview() { wx.navigateTo({ url: '/pages/m3/dishreview/index' }); },
  dismissDone() { this.setData({ importDone: false, importDoneText: '' }); },
});
