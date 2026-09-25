// _r122_probe.js —— 真云探针：补种 plan_free 并回读（判读规则见文件尾）
// 用法（须先起 cli auto --auto-port 9420 --trust-project）：
//   node _r122_probe.js seed     # 调 initDb {only:'seed_missing'} → 看 seeds 里有没有 feature_permissions:plan_free::free_quota
//   node _r122_probe.js quota    # 调 checkQuota → 看 free_limit 是不是 5（= 配置行真读到并解析成功）
//   node _r122_probe.js quota2   # 同上但 scope='shop'（免费档 1 账套）
//
// 🔴 判读规则（勿反）：
//   · seed 返回里 `seeds` 含 `feature_permissions:plan_free::free_quota` ⇒ **本次新插入**（之前云端没有该行）
//     `seeds` 为空 ⇒ 该行**已存在**（幂等生效，重复跑不会插第二条）
//     `errors` 非空 ⇒ 必须逐条读，禁止当成"大概没事"
//   · quota 返回 `data.free_limit === 5` ⇒ 配置行确实存在且被解析（**这是最强回读证据**，比"我插进去了"强）
//     返回 `code` 为 SYSTEM_ERROR / msg 含「配额配置缺失」 ⇒ 该行仍不存在 ⇒ 补种没生效
//   · ⚠️ wx.cloud.callFunction 拿到的是 {code,msg,data}；业务字段在 res.result.data.xxx（不是 res.result.xxx）
//   · ⚠️ 一个连接只做一件事；写后读必超时 ⇒ 每次只调一个云函数
const automator = require('miniprogram-automator');

const MODE = process.argv[2] || 'seed';

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  // 页面路径照 app.json 抄；写错会抛 Uncaught [object Object]
  await mp.reLaunch('/pages/index/index');

  let payload;
  if (MODE === 'seed') payload = { name: 'initDb', data: { only: 'seed_missing' } };
  else if (MODE === 'quota') payload = { name: 'checkQuota', data: { shop_id: 'probe_shop_r122', scope: 'cost_card' } };
  else if (MODE === 'quota2') payload = { name: 'checkQuota', data: { shop_id: 'probe_shop_r122', scope: 'shop' } };
  else { console.log('未知 MODE: ' + MODE); process.exit(2); }

  const out = await mp.evaluate(async (p) => {
    const res = await wx.cloud.callFunction({ name: p.name, data: p.data });
    return { raw: res && res.result };
  }, payload);

  console.log('===== MODE=' + MODE + ' =====');
  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
})().catch((e) => {
  console.log('FATAL ' + ((e && e.message) || e));
  process.exit(1);
});
