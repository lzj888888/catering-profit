// pages/material/batch.js —— round204 · 原料批量录入（粘贴 → 解析 → 预览 → 导入）
//
// 为什么有这一页（李老师 2026-10-04 追问「能不能导出空表让客户填，再导入」）：
//   原料库首建要录几十上百种，手机逐条填一条约 40 秒 ⇒ 60 种一小时；而老板手边本来就有
//   采购价目表（电脑 Excel）⇒ 复制过来最快。本页就是这条最短链路。
//   ⚠️ 与 round156 的「连续录入」是**两条并存的路**：连续录入解决零散补 1~3 条，本页解决首建一批。
//
// 形态（对齐既有 `importSalesBill` 的 preview/confirm 两段式，不落库直到用户点头）：
//   粘贴 → 解析（纯函数 `utils/materialBatch.js`，可单测）→ 逐行预览（有问题的行标红且默认不选）
//   → 勾选 → 导入（分批并发调 `saveMaterial`，单条失败不影响其它条，最后报成功/失败条数）。
//
// 🔴🔴 为什么不新增云函数做「批量保存」：新增云函数在本仓牵动四处（A15 白名单 / core-10 全集与契约 /
//   隐私收集项 / 幂等契约），成本远高于收益；`saveMaterial` 本身已幂等（client_request_id）
//   ⇒ 前端分批并发调用即可，引擎与服务端**零改动**。
// 🔴 解析出的错误**不静默兜底**：缺单位/缺换算系数一律标红要求老板补，与 edit.js「不许静默改掉老板敲的数」同律。
// ⚠️ 计数族（箱/桶/件…）没有通用换算 ⇒ 解析层直接判「换算系数必填」，绝不替老板猜。

const api = require('../../utils/api.js');
const units = require('../../utils/units.js');
const batch = require('../../utils/materialBatch.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// 并发批次：一次 5 条。太大 ⇒ 云函数并发超限；太小 ⇒ 60 条要等太久
const CONCURRENCY = 5;

Page({
  data: {
    t: {
      title: TERMS.card.matBatchTitle,
      guide: TERMS.card.matBatchGuide,
      ph: TERMS.card.matBatchPh,
      cols: TERMS.card.matBatchCols,
      quick: TERMS.card.matBatchQuick,
      headerAuto: TERMS.card.matBatchHeaderAuto,
      pasteTip: TERMS.card.matBatchPasteTip,
      parse: TERMS.card.matBatchParse,
      reparse: TERMS.card.matBatchReparse,
      preview: TERMS.card.matBatchPreview,
      ok: TERMS.card.matBatchOk,
      bad: TERMS.card.matBatchBad,
      selectAll: TERMS.card.matBatchSelectAll,
      unselect: TERMS.card.matBatchUnselect,
      save: TERMS.card.matBatchSave,
      saving: TERMS.card.matBatchSaving,
      empty: TERMS.card.matBatchEmpty,
      none: TERMS.card.matBatchNone,
      needConv: TERMS.card.matBatchNeedConv,
      unnamed: TERMS.card.matBatchUnnamed,
      checked: TERMS.card.matBatchChecked,
      back: TERMS.card.backToList,
      cur: '¥',
    },
    text: '',
    parsed: false,
    parseBtn: TERMS.card.matBatchParse,
    rows: [],
    countText: '',
    checkedCount: 0,
    saveBtn: TERMS.card.matBatchSave,
    saving: false,
    doneText: '',
    failText: '',
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: TERMS.card.matBatchTitle });
  },

  onText(e) { this.setData({ text: e.detail.value }); },

  onParse() {
    const text = this.data.text;
    if (!String(text || '').trim()) {
      wx.showToast({ title: TERMS.card.matBatchEmpty, icon: 'none' });
      return;
    }
    const r = batch.parsePaste(text, TERMS.card.matUnitDefault);
    // 展示态在 js 里算好 —— WXML 里不得调方法（check_list_ux 判据）
    const rows = r.rows.map((x) => ({
      index: x.index,
      ok: x.ok,
      errors: x.errors.slice(),
      name: x.row.name || TERMS.card.matBatchUnnamed,
      priceText: api.fenToYuan(x.row.purchase_price_fen, 2),
      specText: TERMS.card.matConvertHintOf(
        x.row.purchase_unit,
        x.row.convert_factor,
        units.baseWordOf(x.row.purchase_unit),
      ),
      yieldText: String(x.row.yield_rate),
      src: (x.cells || []).join(' · '),
      checked: x.ok,                 // 有问题的行**默认不选**（fail-closed：不把脏数据混进去）
      material: x.row,
    }));
    const okCount = rows.filter((x) => x.ok).length;
    const badCount = rows.length - okCount;
    const checkedCount = rows.filter((x) => x.checked).length;
    this.setData({
      parsed: true,
      rows,
      okCount,
      badCount,
      checkedCount,
      parseBtn: TERMS.card.matBatchReparse,
      countText: TERMS.card.matBatchCountOf(okCount, badCount),
      saveBtn: TERMS.card.matBatchSave,
      doneText: '',
      failText: '',
    });
  },

  // 行选中切换：有问题的行**不许勾**（勾了也是保存失败，不如当场说清）
  onToggleRow(e) {
    const i = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i) || -1);
    const row = this.data.rows[i];
    if (!row || !row.ok) return;
    const key = 'rows[' + i + '].checked';
    const checkedCount = this.data.rows.filter((x, k) => (k === i ? !row.checked : x.checked)).length;
    this.setData({ [key]: !row.checked, checkedCount });
  },

  onSelectAll() {
    let n = 0;
    const patch = {};
    this.data.rows.forEach((x, i) => {
      const v = x.ok;               // 只勾可导入的行
      patch['rows[' + i + '].checked'] = v;
      if (v) n += 1;
    });
    patch.checkedCount = n;
    this.setData(patch);
  },

  onUnselect() {
    const patch = {};
    this.data.rows.forEach((x, i) => { patch['rows[' + i + '].checked'] = false; });
    patch.checkedCount = 0;
    this.setData(patch);
  },

  async onSave() {
    if (this.data.saving) return;
    const targets = this.data.rows.filter((x) => x.checked && x.ok);
    if (targets.length === 0) return;
    this.setData({ saving: true, doneText: '', failText: '' });
    wx.showLoading({ title: TERMS.card.matBatchSaving, mask: true });
    const stamp = Date.now();
    let okN = 0;
    const failed = [];
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const group = targets.slice(i, i + CONCURRENCY);
      const tasks = group.map((r, j) => api.call('saveMaterial', {
        material: r.material,
        // 幂等键**每条唯一**（同一批里第 k 条），重放不会互相顶掉
        client_request_id: 'matb_' + stamp + '_' + (i + j),
      }).then(() => { okN += 1; }).catch(() => { failed.push(r.name); }));
      await Promise.all(tasks);
    }
    wx.hideLoading();
    this.setData({
      saving: false,
      doneText: TERMS.card.matBatchDoneOf(okN),
      failText: failed.length ? TERMS.card.matBatchFailOf(failed.length) + '：' + failed.slice(0, 5).join('、') : '',
    });
  },

  // 导入完回原料库（列表页 `onShow` 会重新拉，新原料立刻可见）
  backToList() { wx.navigateBack(); },
});
