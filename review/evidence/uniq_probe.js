// §3 / A6a / A6b 真云判据：页面上下文调 smokeTest（带 uniq 入参）逐项跑
// 判读：写入「被拒」= 唯一约束生效；写入「成功」= 该键无唯一兜底
const automator = require('miniprogram-automator');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const race = (p, ms, tag) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout ' + tag)), ms))]);
const OUT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/uniq_probe_result.json';

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  log('connected');
  await mp.reLaunch('/pages/card/index');
  await sleep(3500);

  const res = {};
  for (const key of ['cc', 'user', 'shop']) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await race(mp.evaluate(async (k) => {
        try {
          const out = await wx.cloud.callFunction({ name: 'smokeTest', data: { uniq: k } });
          return { key: k, result: out && out.result };
        } catch (e) { return { key: k, err: (e && e.errMsg) || String(e) }; }
      }, key), 40000, 'call-' + key).catch((e) => ({ key, err: e.message }));
      log(key + ' attempt=' + attempt + ' -> ' + JSON.stringify(r && r.result ? r.result.uniqueReal : r).slice(0, 400));
      if (r && r.result && r.result.uniqueReal && !r.result.uniqueReal.skipped) { res[key] = r.result.uniqueReal; break; }
      res[key] = r;
      await sleep(2000);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2), 'utf8');
  log('written -> ' + OUT);
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', typeof e === 'object' ? JSON.stringify(e) : e); process.exit(2); });
