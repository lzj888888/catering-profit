// pages/metrics/impact.js —— M3.19 原料变动影响面（只展示、绝不自动改卡）
//
// 数据来自 api.call('syncCostCard', { material_id, dry_run: true })。dry_run = 只读预览：
//   列出所有用到该原料的成本卡、按最新价重算的新成本/新毛利率、是否跌破业态参考带下限。
// 🔴 本页**只展示**，绝不出现「一键改卡 / 应用新价」按钮 —— 改卡只能由用户在列表页手动走「同步至最新价」。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
// 🔴 档位/颜色一律走单源（marginBand），级别判定走 marginAlert（同一处映射）——
//   本页不得自己写「低于 40% 就算低」这类阈值：成本卡列表的色带由同一套阈值产出，
//   两处各写一套就会出现「列表黄、影响面红」。
const band = require('../../../utils/marginBand.js');
const { marginDrift, BAND_CN } = require('../../../utils/marginAlert.js');

// 🔴 R203：路由参数里的**中文名必须自行解码**。
//   跳转侧（subpkg/biz/material/index.js::goImpact）用 encodeURIComponent 编过一次，
//   微信路由**不保证**替我们解回来 ⇒ 页面直接显示 `%E7%82%B8%E9%B8%A1%E8%85%BF`
//   （李老师报的「涨价影响面前面一大串英文和百分号」就是它）。
//   ⚠️ 之所以到现在才暴露：此前店铺鉴权 404 ⇒ 本页取数必失败 ⇒ 从没真正渲染出来过。
//   ⚠️ 循环上限 2 次：兼容「框架又替我们编了一次」的双重编码；
//      原料名里带裸 `%`（如「含盐 5%」）会让 decodeURIComponent 抛错 ⇒ 必须 catch 并原样返回，不能崩。
function decodeParam(s) {
  let out = String(s == null ? '' : s);
  for (let i = 0; i < 2; i += 1) {
    if (out.indexOf('%') < 0) break;
    let next;
    try { next = decodeURIComponent(out); } catch (e) { break; }
    if (next === out) break;
    out = next;
  }
  return out;
}

Page({
  data: {
    t: {
      impactTitle: TERMS.card.impactTitle,
      impactEmpty: TERMS.card.impactEmpty,
      impactCard: TERMS.card.impactCard,
      impactPrice: TERMS.card.impactPrice,
      impactCostChange: TERMS.card.impactCostChange,
      impactMargin: TERMS.card.impactMargin,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    material_id: '',
    material_name: '',
    affected: [],
    summary: '',
    loading: true,
  },

  onLoad(q) {
    this.setData({ material_id: (q && q.material_id) || '', material_name: decodeParam(q && q.name) });
    this.load();
  },

  // 🔴 R379：下拉刷新。原来只能退出重进 —— 老板在原料页改完采购价、回到「影响面」时，
  //   看到的还是上一次 dry_run 的结果（页面上没有任何时间戳），很容易把旧影响当成新影响。
  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    this.load().then(done, done);
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.impactTitle);
      const d = await api.call('syncCostCard', {
        material_id: this.data.material_id,
        dry_run: true,
        client_request_id: 'mimp_' + Date.now(),
      });
      const rows = (d.affected || []).map((a) => {
        const oldM = a.old_gross_margin_pct;
        const newM = a.new_gross_margin_pct;
        const drift = marginDrift(oldM, newM);
        // 只在「真的变差」时给一行提示：升档/持平不出声（改价不总是坏事）
        let driftTag = '';
        if (drift.level === 'danger' && newM != null && newM < 0) driftTag = TERMS.card.impactDriftLoss;
        else if (drift.crossedLow) driftTag = TERMS.card.impactDriftLow;
        else if (drift.downgraded) driftTag = TERMS.card.impactDriftDown(BAND_CN[drift.oldBand], BAND_CN[drift.newBand]);
        return {
          card_code: a.card_code,
          name: a.name || '',
          price: a.price_fen > 0 ? api.fenToYuan(a.price_fen, 2) : '—',
          old_cost: api.fenToYuan(a.old_total_cost_fen, 2),
          new_cost: api.fenToYuan(a.new_total_cost_fen, 2),
          old_margin: oldM != null ? oldM.toFixed(1) : '—',
          new_margin: newM != null ? newM.toFixed(1) : '—',
          margin_delta: (oldM != null && newM != null) ? (newM - oldM).toFixed(1) : '—',
          below_band: !!a.below_band,
          band_floor: a.band_floor_pct != null ? a.band_floor_pct : 0,
          band_hint: a.below_band ? TERMS.card.impactBelowBand(a.band_floor_pct) : '',
          drift_tag: driftTag,
          // 颜色也取单源：新档位的色值（未定价灰）
          drift_color: band.colorOf(newM),
          drift_down: !!driftTag,
          new_low: drift.newBand === band.KEYS.low,
        };
      });
      // 汇总一行：降档几道、其中跌进低毛利几道（老板最想先看这两个数）
      const downN = rows.filter((r) => r.drift_down).length;
      const lowN = rows.filter((r) => r.drift_down && r.new_low).length;
      this.setData({
        affected: rows,
        summary: downN > 0 ? TERMS.card.impactSummary(downN, lowN) : '',
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },
});
