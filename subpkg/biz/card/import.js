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
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const DI = require('../../../utils/dishImport.js');
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
      // R702（P0-A）：整表粘贴体检的两种拦截说明
      blockCombo: TERMS.card.impBlockCombo,
      blockNoName: TERMS.card.impBlockNoName,
    },
    text: '',
    rows: [],
    summaryText: '',
    reconText: '',     // R702（P0-B）：对账行（粘贴行数 → 识别道数 → 跳过 → 已填价合计）
    blockTip: '',      // R702（P0-A）：整表被拒时的说明（空 = 没被拒）
    catOptions: CAT_OPTIONS,
    parsed: false,      // 是否已解析过（未解析时不显示空态提示，免得一进来就报错）
  },

  onLoad() { ui.setTitle(TERMS.card.impTitle); },

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
    this.setData({ rows, parsed: true, blockTip: '' });
    this.syncSummary(rows);
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
    wx.navigateTo({ url: '/subpkg/biz/card/edit?from_draft=1' });
  },
});
