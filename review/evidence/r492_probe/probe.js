const { pickProfitLabel } = require('C:/Users/lzj/WorkBuddy/Claw/catering-profit/utils/profitLabel.js');
const mk = (closing, amort) => ({
  switches: { inventorySwitchOn: true, amortizeSwitchOn: true },
  inventory: { closing_fen: closing },
  result: { ref_material_source: 'direct', effective_amortize_fen: amort },
  effective_lump_sum_fen: 0,
});
for (const [tag, l] of [['盘点(期末>0)+摊销0', mk(2800000, 0)], ['没盘点(期末0)+摊销0', mk(0, 0)], ['没盘点+摊销1250', mk(0, 125000)]]) {
  const r = pickProfitLabel(l, 'real');
  console.log(tag, '| title=' + r.title, '| basis=' + r.basis, '| amortText=' + JSON.stringify(r.amortText));
}
