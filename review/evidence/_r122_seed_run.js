// _r122_seed_run.js —— 走 automator.launch()（官方路径：自己拉起 IDE 并握手，不依赖 cli auto）
// 用途：在真云上调 initDb {only:'seed_missing'} 补种 plan_free 配额配置行，并回读。
//
// 判读规则：
//   · result.seeds 含 `feature_permissions:plan_free::free_quota` ⇒ 本次**新插入**（说明云端此前确实没有该行）
//   · result.seeds 为空 ⇒ 该行已存在（幂等生效）
//   · result.errors 非空 ⇒ 逐条读，别当没事
//   · blocked:true ⇒ env 门禁拦住（DEV_ENV_ID 环境变量没配到该函数）
const automator = require('miniprogram-automator');

const CLI = 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat';
const PROJ = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';

(async () => {
  console.log('launching...');
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJ });
  console.log('LAUNCHED');
  await mp.reLaunch('/pages/index/index');
  console.log('RELAUNCHED');
  const out = await mp.evaluate(async () => {
    const res = await wx.cloud.callFunction({ name: 'initDb', data: { only: 'seed_missing' } });
    return { raw: (res && res.result) || null };
  });
  console.log('===== initDb seed_missing =====');
  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.log('FATAL ' + ((e && e.message) || e));
  process.exit(1);
});
