// 亏本筛选接线核验：列表页暂无真卡 ⇒ 往页面数据里注入 3 行（含 1 行负毛利），
// 只验 applyFilter 的判定与「可点切换」这条接线（计数由 load() 写入，本段不重算，边界如实记录）。
const automator = require('miniprogram-automator');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'review/evidence/r567_device';
const report = { checks: [], notes: [] };
const out = (id, expect, actual, pass) => {
  report.checks.push({ id, expect, actual, pass });
  console.log(pass ? 'PASS' : 'NG  ', id, '|', expect, '|', JSON.stringify(actual));
};
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  try { await mp.evaluate(() => { wx.reLaunch({ url: '/subpkg/biz/card/index', fail: () => {} }); return 1; }); } catch (e) {}
  await sleep(9000);
  const r = await mp.evaluate(() => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const band = require ? null : null;
    const rows = [
      { card_code: 'C1', name: '注入-亏本', margin: -12.5, price: '10.00', margin_color: '#e74c3c' },
      { card_code: 'C2', name: '注入-低毛利', margin: 22.0, price: '20.00', margin_color: '#e67e22' },
      { card_code: 'C3', name: '注入-健康', margin: 62.0, price: '30.00', margin_color: '#27ae60' },
      { card_code: 'C4', name: '注入-未定价', margin: null, price: '—', margin_color: '#999999' },
    ];
    p.setData({ all: rows, loseCount: 1, loseWarn: '有 1 道菜在亏本卖，点这里只看它们' });
    p.applyFilter();
    const before = (p.data.list || []).map((c) => c.name);
    p.onToggleLossOnly();
    const after = (p.data.list || []).map((c) => c.name);
    const flag = p.data.lossOnly;
    p.onToggleLossOnly();
    return { before, after, flag, back: (p.data.list || []).map((c) => c.name), lossOnlyBack: p.data.lossOnly };
  });
  console.log(JSON.stringify(r));
  out('X-baseline', '注入后默认显示 4 行', (r.before || []).length, (r.before || []).length === 4);
  out('X-filter', '点提示条只剩负毛利那 1 行', r.after, (r.after || []).length === 1 && r.after[0] === '注入-亏本' && r.flag === true);
  out('X-restore', '再点恢复 4 行', r.back, (r.back || []).length === 4 && r.lossOnlyBack === false);
  // 复原真实数据
  const reset = await mp.evaluate(() => { const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null; if (!p) return 0; p.load(); return 1; });
  report.notes.push('页面已重新 load() 复原真实数据: ' + reset);
  fs.writeFileSync(OUT + '/report_filter.json', JSON.stringify(report, null, 1));
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})();
