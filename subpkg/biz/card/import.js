// subpkg/biz/card/import.js —— P0-4 批量导入（粘贴菜单 → 三色预览 → 逐道去补价）
//
// 🔴 为什么**不做「一键批量建卡」**（这是产品口径，不是没做完）：
//   草稿卡的示例主料**故意没有价**（红线 R138/R317 不许替老板编价）。若直接 saveCostCard：
//   成本只剩「调料(含油盐酱醋)」≈0.3~0.5 元 ⇒ 售价 28 元的菜算出 **98% 毛利率**，
//   而这张假卡会进列表色带、毛利榜与 M2 诊断 —— **比没有卡更危险**（老板以为算过了）。
//   故本页只做「预填器」：解析 → 核对品类/售价 → 逐道进编辑页补价 → 由编辑页正常保存。
//   理由文案单源：utils/dishImport.js::IMPORT_NO_AUTOSAVE。
//
// 🔴 解析/判定/映射全部在 utils/dishImport.js（纯逻辑，26 断言守着）；本页只负责：
//   textarea 取值 → 每行匹配品类 → 展示三色 → 跳编辑页前把草稿放进本地暂存。
const ui = require('../../../utils/ui.js');
const api = require('../../../utils/api.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const DI = require('../../../utils/dishImport.js');
// 🔴 R708：`truncated` 必须走单源判定（`=== true`），不在这里自己写 `res.truncated` 真值判断 ——
//   契约是布尔，云端若回字符串 'true'/'1' 那就是契约破了，该判红而不是被宽松放行。
const dh = require('../../../utils/dataHealth.js');
const { CATEGORY_PRESETS } = require('../../../utils/categoryPresets.js');

// 品类 picker：索引 0 = 未识别（老板可手动选），其余与 CATEGORY_PRESETS 顺序一致（+1 偏移）。
const CAT_OPTIONS = [TERMS.card.impCatUnknown].concat(CATEGORY_PRESETS.map((c) => c.label));
const STATUS_TEXT = {
  green: TERMS.card.impStatusGreen,
  orange: TERMS.card.impStatusOrange,
  red: TERMS.card.impStatusRed,
};

Page({
  data: {
    t: {
      title: TERMS.card.impTitle,
      intro: TERMS.card.impIntro,
      pasteLabel: TERMS.card.impPasteLabel,
      pastePh: TERMS.card.impPastePh,
      pasteHint: TERMS.card.impPasteHint,
      clipBtn: TERMS.card.impClipBtn,
      parse: TERMS.card.impParse,
      noAuto: TERMS.card.impNoAuto,
      goFill: TERMS.card.impGoFill,
      goFillHint: TERMS.card.impGoFillHint,
      pricePh: TERMS.card.impPricePh,
      catUnknown: TERMS.card.impCatUnknown,
      noRows: TERMS.card.impNoRows,
      // 🔴 R704：开做之前的准备（原料库体检）
      matTitle: TERMS.card.impMatTitle,
      matEmptyT: TERMS.card.impMatEmptyT,
      matEmptyD: TERMS.card.impMatEmptyD,
      matEmptyBtn: TERMS.card.impMatEmptyBtn,
      matOkD: TERMS.card.impMatOkD,
      savedBadge: TERMS.card.impSavedBadge,
      // R702（P0-A）：整表粘贴体检的两种拦截说明
      blockCombo: TERMS.card.impBlockCombo,
      blockNoName: TERMS.card.impBlockNoName,
    },
    text: '',
    rows: [],
    summaryText: '',
    reconText: '',     // R702（P0-B）：对账行（粘贴行数 → 识别道数 → 跳过 → 已填价合计）
    blockTip: '',      // R702（P0-A）：整表被拒时的说明（空 = 没被拒）
    // 🔴 R704：原料库体检结果。-1 = 没读到（**不显示这块**，绝不默认 0）——
    //   与本仓「不替用户编数」同一条纪律：网络一抖就报「你还没有原料」会把人吓去重建。
    matN: -1,
    matTipTitle: '',
    matTipDesc: '',
    matTipBtn: false,
    catOptions: CAT_OPTIONS,
    parsed: false,      // 是否已解析过（未解析时不显示空态提示，免得一进来就报错）
    resumeTip: '',      // 🔴 R711：接上了上次那批时的说明（空 = 没有可接的）
    resumeClose: TERMS.card.impResumeClose,
  },

  onLoad() {
    ui.setTitle(TERMS.card.impTitle);
    this.loadMaterials();
    this.restoreBatch();
  },

  // 🔴 R711：接上「上次没做完的那批」。
  //
  // 为什么这不是锦上添花：页面被销毁是**必现**路径 —— 老板补了 5 道、想回 M3 看一眼别的、
  // 再点进来，页面就重建了。而重来一遍的代价**不对称**：已补完那 5 道云端已经有卡，
  // 可重新粘贴后每行都是 `saved:false`、看着像一道没做过 ⇒ 老板会再补一遍、同名的卡被重复建。
  // ⇒ 关键不是「省一次粘贴」，是**让 saved 标记跟着整批活下来**。
  //
  // 三条纪律：
  //   ① fail-closed：读不到 / 结构不对 / 过期 ⇒ 就当没有，绝不半信半疑恢复半张表；
  //   ② status/reason **不吃缓存的旧结论**，一律 decorate 现算（DI 的口径以后改了也不怕）；
  //   ③ 过期顺手删 key —— 否则一个坏 key 会在这里被反复读、反复判、永远清不掉。
  restoreBatch() {
    let cache = null;
    try {
      cache = wx.getStorageSync(DI.BATCH_CACHE_KEY);
    } catch (e) {
      return;   // 读不到就当没有，绝不因为缓存坏了让页面起不来
    }
    if (!cache) return;
    if (!DI.isBatchFresh(cache, Date.now())) {
      try { wx.removeStorageSync(DI.BATCH_CACHE_KEY); } catch (e) { /* noop */ }
      return;
    }
    const rows = cache.rows.map((r) => this.decorate(r));
    this._rawN = Number(cache.rawN) || rows.length;
    const done = rows.filter((r) => r.saved).length;
    const left = rows.length - done;
    this.setData({
      text: String(cache.text || ''),
      rows,
      parsed: true,
      blockTip: '',
      resumeTip: left === 0 ? TERMS.card.impResumeNone(rows.length)
        : (done === 0 ? TERMS.card.impResumeSingle(left) : TERMS.card.impResumeSome(left, done)),
    });
    this.syncSummary(rows);
  },

  onDismissResume() { this.setData({ resumeTip: '' }); },

  // 整批落盘（**含 saved 标记**）。凡是会改变「补齐进度」的动作之后都必须调一次。
  //   失败**不 toast**：这是背景动作，报出来只会让老板以为哪儿出错了；顶多下次重来一遍。
  persistBatch() {
    const rows = this.data.rows || [];
    if (!rows.length) return;   // 空批次不落盘 —— 否则一次解析失败会把上一批覆盖成空壳
    try {
      wx.setStorageSync(DI.BATCH_CACHE_KEY, {
        text: String(this.data.text || ''),
        rows,
        rawN: this._rawN || rows.length,
        ts: Date.now(),
      });
    } catch (e) { /* noop */ }
  },

  // 🔴 R704（李老师真机「有点发懵」的根因，产品层）：
  //   他把菜单导进来、走到「去补价」，才发现在这里要一道道填价 —— 因为**没有任何地方**
  //   告诉过他：原料库能一次性批量建，建好之后「补价」是**选料**（价格自动带出），不是填数字。
  //   ⇒ 本块放在粘贴框**之前**：它是前置条件，不是使用说明。放进页面底部等于没放。
  //   fail-closed：读失败 ⇒ matN 保持 -1 ⇒ 整块不渲染（宁可不说，也不误报「你还没有原料」）。
  async loadMaterials() {
    try {
      await api.ensureShop();
      const res = await api.call('getMaterial', {});
      const n = (res && Array.isArray(res.list)) ? res.list.length : -1;
      if (n < 0) { this.setData({ matN: -1 }); return; }
      this.setData({
        matN: n,
        matTipTitle: n > 0 ? TERMS.card.impMatOkT(n) : TERMS.card.impMatEmptyT,
        matTipDesc: n > 0 ? TERMS.card.impMatOkD : TERMS.card.impMatEmptyD,
        matTipBtn: n === 0,
      });
    } catch (e) {
      this.setData({ matN: -1 });
    }
  },

  // 空库时直达「批量录入」——那是几十种料一次粘完的入口，不是逐条新建
  goMaterialBatch() { wx.navigateTo({ url: '/subpkg/biz/material/batch' }); },

  // 🔴 R704（B-①）：补完价返回时，把**真的存进库了**那一行标成「已保存」。
  //   改前：本页只有 onLoad，没有 onShow ⇒ 去补价再返回，那一行还是橙的，
  //   老板会以为"白干了/没生效"，于是重复补一遍。
  //   🔴 为什么不按「点过就算」：老板可能进编辑页后中途退出，或者保存失败（配额满/断网）。
  //     按"点过"标绿＝假信号，与「不替用户编数」冲突。判据只认服务端返回的同名卡。
  onShow() {
    const name = this._pendingName;
    if (!name) return;            // 首次进入 / 普通返回：什么都不做
    this._pendingName = '';
    this.confirmSaved(name);
  },

  async confirmSaved(name) {
    const rows = this.data.rows || [];
    const idx = rows.findIndex((r) => r.name === name);
    if (idx < 0 || rows[idx].saved) return;
    try {
      await api.ensureShop();
      const res = await api.call('getCostCard', {});
      const list = (res && res.list) || [];
      // 🔴 R708（truncated 消费面）：`getCostCard` 的 list 是 listAll 分页取全，
      //   但 2 万行护栏处会**显式降级**并置 `truncated` ⇒ 这时「没找到同名卡」根本不能推出
      //   「没存上」：刚存的那张可能就在被截掉的那一段。
      //   三点 fail-closed：① 不标 saved（没核对上就不给结论）
      //                    ② 绝不报「没保存」（假警报会让老板把同一道菜重填一遍）
      //                    ③ 说出来，并指路去列表自己看（他能一眼看到真相，比我们猜准）
      if (dh.isTruncated(res)) {
        wx.showToast({ title: TERMS.card.impSavedUncertain, icon: 'none', duration: 3000 });
        return;
      }
      if (!list.some((c) => c.name === name)) {
        // 没存上：必须说，否则他回到列表找不到卡更懵
        wx.showToast({ title: TERMS.card.impSavedMiss, icon: 'none' });
        return;
      }
      const next = rows.slice();
      next[idx] = Object.assign({}, next[idx], { saved: true });
      this.setData({ rows: next });
      // 🔴 R711：saved 标记必须立刻落盘 —— 它就是「老板不用重补」的唯一依据
      this.persistBatch();
      wx.showToast({ title: TERMS.card.impSavedOk(name), icon: 'none' });
    } catch (e) {
      // 查不到就不标：宁可不标，不标错
    }
  },

  onInput(e) { this.setData({ text: e.detail.value }); },

  // ===== 解析 =====
  // 🔴 R570-G：单击读系统剪贴板。为什么不是「教老板长按」——长按弹出的系统菜单是原生 UI，
  //   自动化点不到、也不是每台安卓机都稳定出得来；一个自带按钮既稳又能被门禁验证。
  //   三条口径：① 读不到必须说人话（不许静默失败）；② 已有内容**追加**不覆盖（老板可能手改过）；
  //   ③ 贴完直接出三色预览（少一次点击，也避免「贴了没反应」的错觉）。
  onPasteClip() {
    if (typeof wx.getClipboardData !== 'function') {
      wx.showToast({ title: TERMS.card.impClipFail, icon: 'none' });
      return;
    }
    wx.getClipboardData({
      success: (res) => {
        const clip = String((res && res.data) || '').trim();
        if (!clip) { wx.showToast({ title: TERMS.card.impClipEmpty, icon: 'none' }); return; }
        const old = String(this.data.text || '').replace(/\s+$/, '');
        const next = old ? (old + '\n' + clip) : clip;
        this.setData({ text: next });
        this.onParse(next);
      },
      fail: () => { wx.showToast({ title: TERMS.card.impClipFail, icon: 'none' }); },
    });
  },

  onParse(text) {
    // text 可选：剪贴板贴完直接把新文本递进来，避免依赖 setData 之后 this.data 的时序。
    // 🔴 R711：但**data.text 也必须跟着对齐** —— persistBatch 存的是 `this.data.text`，
    //   只更新入参不更新 data，落盘的原文就会是上一版（甚至空串）⇒ 下次恢复"有菜没原文"。
    //   （这是页面桩抓出来的：真机走 textarea 时 onInput 已经写过 data，所以肉眼看不出来，
    //     但「传参进来」这条路径一直是错的。）
    if (typeof text === 'string' && text !== this.data.text) {
      this.setData({ text: text });
    }
    const src = (typeof text === 'string') ? text : String(this.data.text || '');
    // 保留原始行用于「千分位」提示：parseDishLines 会跳过空行，索引对不上 ⇒ 这里自己逐行走。
    const raws = src.split('\n')
      .map((s) => s.replace(/\r/g, ''))
      .filter((s) => s.trim());

    // 🔴 R702（P0-A）：**先体检，再解析**。
    //   区别是根本性的：旧逻辑只问「能解析出几行」，于是任何表都能"解析出东西"；
    //   这里先问「这张表该不该解析」。真表实证 —— 套餐明细整表粘贴会建出
    //   「统计方式：…」「菜品编码」「D001」三张垃圾卡，页面还显示"有 3 行数据"，零报错。
    //   统一导入器（subpkg/biz/takeaway）对同一张表是拒收的，两条链路必须一致。
    const diag = DI.diagnosePaste(src);
    if (diag.kind === 'combo_detail' || diag.kind === 'no_name_col') {
      this._rawN = 0;   // 没解析 ⇒ 对账行不参与
      this.setData({
        rows: [], summaryText: '', reconText: '', parsed: true,
        blockTip: diag.kind === 'combo_detail' ? TERMS.card.impBlockCombo : TERMS.card.impBlockNoName,
      });
      return;
    }
    this._rawN = raws.length;   // R702（P0-B）：对账要「粘贴了几行」，改价重算时仍要用
    const rows = [];
    for (let i = 0; i < raws.length; i++) {
      const line = DI.parseDishLine(raws[i]);
      if (!line || !line.name) continue;
      rows.push(this.buildRow(line, i, raws[i]));
    }
    if (!rows.length) {
      this.setData({ rows: [], summaryText: '', reconText: '', blockTip: '', parsed: true });
      wx.showToast({ title: TERMS.card.impNoRows, icon: 'none' });
      return;
    }
    this.setData({ rows, parsed: true, blockTip: '', resumeTip: '' });
    this.syncSummary(rows);
    // 🔴 R711：解析成功即落盘 —— 从这一刻起这批就是「老板的活」，后面每次进度变化都要跟着写
    this.persistBatch();
  },

  // 单行 → 展示项（品类匹配 / 草稿骨架 / 三色 / 缺项提示 全部走 dishImport 单源）
  buildRow(line, key, raw, catKey) {
    const k = (catKey === undefined) ? DI.matchCategory(line.category) : catKey;
    const draft = DI.buildDraftCard(line, k);
    return this.decorate({
      key,
      name: draft.name,
      price: draft.priceYuan > 0 ? draft.priceYuan.toFixed(2) : '',
      catKey: k,
      catIdx: k ? CATEGORY_PRESETS.findIndex((c) => c.key === k) + 1 : 0,
      catLabel: k ? draft.category : '',
      draft,
      thousands: DI.hasThousandsSeparator(raw),
      // R696：这行有多个数字（销量/销售额/单价混在一起），解析器拒绝猜售价
      ambiguous: !!line.ambiguous,
      ambNumsText: (line.ambNums || []).join('、'),
    });
  },

  // 由 draft 重算三色与提示（改价/改品类后都走这里，避免两处各算一次）
  decorate(row) {
    const st = DI.draftStatusOf(row.draft);
    const issues = DI.draftIssues(row.draft);
    let reason = '';
    if (row.thousands) {
      // 优先报千分位：价格没解析出来是逗号造成的，说「缺售价」会指错路。
      reason = TERMS.card.impReasonThousands;
    } else if (row.ambiguous) {
      // R696：多个数字认不出售价 —— 必须说**为什么**，否则老板只看到"缺售价"，
      //   回头再粘一次还是同样的结果。这里把候选数字列出来，他一眼就知道该删哪几列。
      reason = TERMS.card.impReasonAmbiguous.replace('{nums}', row.ambNumsText || '');
    } else if (issues.noPrice && issues.noMain) {
      reason = TERMS.card.impReasonNoPrice + ' · ' + TERMS.card.impReasonNoMain;
    } else if (issues.noPrice) {
      reason = TERMS.card.impReasonNoPrice;
    } else if (issues.noMain) {
      reason = TERMS.card.impReasonNoMain;
    }
    return Object.assign({}, row, {
      status: st,
      statusText: STATUS_TEXT[st],
      reason,
    });
  },

  syncSummary(rows) {
    const n = rows.length;
    const g = rows.filter((r) => r.status === 'green').length;
    const o = rows.filter((r) => r.status === 'orange').length;
    const r0 = rows.filter((r) => r.status === 'red').length;
    // 🔴 R702（P0-B）：对账行。为什么值得单独一行：
    //   今天美团退款那个 bug 的形态是「页面上有数、数字却是错的」——老板不看数就永远不会发现。
    //   给三个他能独立核对的数：粘贴了几行 / 识别出几道 / 跳过几行，再加「已填价合计」。
    //   任何一环对不上（比如菜单 30 道只识别出 12 道），当场就能看出来，而不是等毛利算错。
    //   ⚠️ 跳过行数用「原始行 − 识别行」：表头行、合计行、噪音行都算在这里，不静默吞掉。
    const rawN = this._rawN || n;
    const skip = Math.max(0, rawN - n);
    const priced = rows.filter((r) => r.price !== '' && Number(r.price) > 0);
    const sum = priced.reduce((a, r) => a + Number(r.price), 0);

    this.setData({
      summaryText: TERMS.card.impSummary(n, g, o, r0),
      reconText: TERMS.card.impRecon(rawN, n, skip, priced.length, sum.toFixed(2)),
    });
  },

  // ===== 行内编辑 =====
  // 售价：输入过程**不 setData**（否则 value 回写会把光标顶到末尾/吞字），
  //   原地改 this.data.rows 里的值，失焦时再统一重算三色并 setData。
  onPrice(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const row = this.data.rows[idx];
    if (!row) return;
    row.price = e.detail.value;
  },
  onPriceBlur(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rows = this.data.rows.slice();
    const row = rows[idx];
    if (!row) return;
    const yuan = Number(row.price);
    row.draft = Object.assign({}, row.draft, { priceYuan: isFinite(yuan) && yuan > 0 ? yuan : 0 });
    rows[idx] = this.decorate(row);
    this.setData({ rows });
    this.syncSummary(rows);
    this.persistBatch();
  },

  onPickCat(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const pick = Number(e.detail.value);
    const rows = this.data.rows.slice();
    const row = rows[idx];
    if (!row) return;
    const catKey = pick === 0 ? null : CATEGORY_PRESETS[pick - 1].key;
    // 换品类 = 重生成示例主料与默认出净率；菜名/售价沿用当前行（老板可能已经改过价）
    const yuan = Number(row.price);
    const draft = DI.buildDraftCard(
      { name: row.name, category: '', priceYuan: isFinite(yuan) && yuan > 0 ? yuan : 0 },
      catKey
    );
    rows[idx] = this.decorate(Object.assign({}, row, {
      catKey,
      catIdx: pick,
      catLabel: catKey ? draft.category : '',
      draft,
    }));
    this.setData({ rows });
    this.syncSummary(rows);
    this.persistBatch();
  },

  // ===== 去补价 =====
  onGoFill(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const row = this.data.rows[idx];
    if (!row || !row.name) return;
    try {
      wx.setStorageSync(DI.DRAFT_PREFILL_KEY, row.draft);
    } catch (err) {
      wx.showToast({ title: TERMS.card.impSaveFail, icon: 'none' });
      return;
    }
    // 🔴 R704：记下「派出去了哪一道」——只在这之后记（暂存失败就不算派出去），
    //   回来时 onShow 靠它去查库确认是否真的存上了（见 confirmSaved）。
    this._pendingName = row.name;
    wx.navigateTo({ url: '/subpkg/biz/card/edit?from_draft=1' });
  },
});
