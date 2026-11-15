#!/usr/bin/env node
// R743 主审计探针 · 幂等键真实语义（不采信注释自述，真跑单源实现）
// 问题：前端三处 saveAsset 都内联 client_request_id: 'at_' + Date.now()。
//   ① 网络重试 / 用户双击 ⇒ 两次调用各生成新键 ⇒ 幂等是否形同虚设？
//   ② 同一毫秒两次点击 ⇒ 两键相同 ⇒ 会把两次合法独立录入误判为重复吗？
//   ③ 空键 ⇒ findPriorResult 返回什么？是否"不做约束"？
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const idem = require(path.join(ROOT, 'cloudfunctions/common/idempotency.js'));

console.log('===== R743 幂等键语义实测 =====\n');

// ---- 1. shopKey 行为 ----
console.log('【1】shopKey 对 空/同/异 键的处理');
const cases = [
  ['空键', 's1', undefined],
  ['空串', 's1', ''],
  ['同键两次', 's1', 'as_1731650000000'],
  ['异键', 's1', 'as_1731650000001'],
  ['跨店同键', 's2', 'as_1731650000000'],
];
for (const [name, shop, crid] of cases) {
  let k;
  try { k = idem.shopKey(shop, crid); } catch (e) { k = 'THROW:' + e.message; }
  console.log(`  ${name.padEnd(12)} shop=${shop} crid=${String(crid)} => ${JSON.stringify(k)}`);
}

// ---- 2. 前端 Date.now() 键的"重试"语义 ----
// 模拟：用户点一次保存，网络超时自动重试 —— 前端若在 api.call 内联生成 key，
// 两次调用的 key 不同 ⇒ 幂等表命中不了。
console.log('\n【2】Date.now() 内联键：同一逻辑操作重试是否复用同一 key');
function frontendKey(prefix) { return prefix + Date.now(); } // 复刻前端写法
const k1 = frontendKey('as_');
const k2 = frontendKey('as_'); // 同一次操作的"重试"（前端重新调用）
console.log(`  第1次 key = ${k1}`);
console.log(`  重试  key = ${k2}`);
console.log(`  相同? ${k1 === k2}  ⇒ ${k1 === k2 ? '幂等生效' : '❌ 幂等失效：两次会各插一行资产'}`);

// 同毫秒碰撞：两次**独立**录入被折叠
let sameMs = 0, trials = 200000;
for (let i = 0; i < trials; i++) { if (frontendKey('x_') === frontendKey('x_')) sameMs++; }
console.log(`  同毫秒碰撞率（20 万次对）: ${(sameMs / trials * 100).toFixed(3)}%  ⇒ ${sameMs > 0 ? '❌ 会把两次独立录入误判为重复（吞掉一笔真实资产）' : '未观测到'}`);

// ---- 3. findPriorResult 空键行为（桩 db）----
console.log('\n【3】findPriorResult 对空键的真实行为');
const seen = [];
const dbStub = {
  collection: () => ({
    where: (q) => { seen.push(q); return { limit: () => ({ get: async () => ({ data: [] }) }) }; },
  }),
};
(async () => {
  try {
    const r = await idem.findPriorResult(dbStub, 's1', '');
    console.log(`  空键返回 = ${JSON.stringify(r)}；审计表被查询次数 = ${seen.length}`);
    console.log(`  ⇒ ${seen.length === 0 ? '✅ 空键确实跳过幂等（不做约束）' : '键被拿去查了'}`);
  } catch (e) {
    console.log(`  空键抛错: ${e.message}`);
  }

  // ---- 4. 结论所需的"两次 insert"推演 ----
  console.log('\n【4】saveAsset 新增分支的两条写入路径（证据：index.js:84-86 / :134-146）');
  console.log('  · 有 prior ⇒ return ok(prior)，不再 insert');
  console.log('  · 无 prior ⇒ genId() + da.insert() ⇒ **新资产行**');
  console.log('  两次不同 key ⇒ 两次都是"无 prior" ⇒ 两行资产 ⇒ 台账现算时摊销翻倍');
  console.log('\n===== 结论：需不需要修，取决于「重试是否复用 key」与「是否允许空键」，见报告 =====');
})();
