// cloudfunctions/common/__tests__/batch0_selfcheck.js
// 批次 0 自测：用内存假 db 验证复审节点① 五条（点1~点5）。
// 运行：node cloudfunctions/common/__tests__/batch0_selfcheck.js
// 纯逻辑，无需 wx-server-sdk / 云环境。

const path = require('path');
const ROOT = path.resolve(__dirname, '../../..'); // catering-profit 根

const { resolveAuth, assertShopOwner } = require('../auth');
const { makeAdapter } = require('../dataAdapter');
const { checkIdempotent } = require('../idempotency');
const { makeRateLimiter } = require('../rateLimit');
const { writeAudit } = require('../audit');
const { ERROR_CODES } = require('../errors');
const { COLLECTIONS, gate } = require('../../initDb/collections');
const env = require(path.join(ROOT, 'miniprogram/config/env.js'));

// ---------- 假 db（内存）----------
function match(doc, cond) {
  return Object.entries(cond || {}).every(([k, v]) => doc[k] === v);
}
function makeFakeDb(seed) {
  const store = {};
  for (const [k, v] of Object.entries(seed || {})) store[k] = v.map((x) => Object.assign({}, x));
  const lastWhere = {};
  function collection(name) {
    const arr = (store[name] = store[name] || []);
    return {
      where(cond) {
        lastWhere[name] = cond;
        const filtered = arr.filter((d) => match(d, cond));
        return {
          get() { return Promise.resolve({ data: filtered }); },
          count() { return Promise.resolve({ total: filtered.length }); },
          limit(n) { return { get() { return Promise.resolve({ data: filtered.slice(0, n) }); } }; },
        };
      },
      doc(id) {
        return {
          get() {
            const d = arr.find((x) => x._id === id || x.id === id);
            if (!d) return Promise.reject(new Error('document.get:fail document does not exist'));
            return Promise.resolve({ data: Object.assign({}, d) }); // 与 wx-server-sdk 契约一致：返回结果对象 {data}
          },
          update({ data }) {
            const d = arr.find((x) => x._id === id || x.id === id);
            if (d) Object.assign(d, data);
            return Promise.resolve({});
          },
        };
      },
      add({ data }) {
        const doc = Object.assign({}, data);
        if (doc._id == null && doc.id == null) doc._id = 'gen_' + Math.random().toString(36).slice(2);
        arr.push(doc);
        return Promise.resolve({ _id: doc._id || doc.id });
      },
    };
  }
  return { store, lastWhere, collection };
}

// ---------- 断言 ----------
let pass = 0, failN = 0;
const results = [];
const todos = []; // 部署前置 / 非单测可判的项：不打 ✅ 也不计入失败
function check(name, cond, detail) {
  if (cond) { pass++; results.push(['PASS', name, detail || '']); }
  else { failN++; results.push(['FAIL', name, detail || '']); }
}

(async () => {
  // ===== 点1：鉴权丢弃前端身份，身份只来自 OPENID =====
  {
    // 场景：库里有两条 user：OPENID=real→u_real；OPENID=forged→u_forged（模拟"前端伪造"的记录）
    const db = makeFakeDb({
      user: [
        { _id: 'u_real', user_id: 'u_real', openid: 'real', is_deleted: false },
        { _id: 'u_forged', user_id: 'u_forged', openid: 'forged', is_deleted: false },
      ],
      shop: [],
      shop_entitlement: [],
      audit_log: [],
    });
    // 关键：resolveAuth 只接收 ctx(含 OPENID) 与 db，不接收 event；
    //       即便"前端"试图伪造 user_id='u_forged'，也从不进入函数签名。
    const forgedEvent = { user_id: 'u_forged', shop_id: 'shop_x', openid: 'forged' };
    const r = await resolveAuth({ OPENID: 'real' }, db);
    void forgedEvent; // 该伪造对象根本无法传入 resolveAuth
    check('点1·身份只来自OPENID(忽略伪造记录)', r.user && r.user.id === 'u_real', `user.id=${r.user && r.user.id}`);
    check('点1·函数不接收event(签名为 ctx,db,audit)', resolveAuth.length === 3, `resolveAuth.length=${resolveAuth.length}（参数=ctx,db,audit，无 event 入口）`);
  }

  // ===== 点1b：首次进入自动建档（openid 无 user → 建 user+shop+entitlement+audit）=====
  {
    const db = makeFakeDb({ user: [], shop: [], shop_entitlement: [], audit_log: [] });
    const audit = { write: (p) => writeAudit({ collection: db.collection }, p) };
    const r = await resolveAuth({ OPENID: 'newbie' }, { collection: db.collection }, audit);
    check('点1b·首次自动建档返回user', !!r.user && !!r.user.id, `user.id=${r.user && r.user.id}`);
    check('点1b·建了默认shop', db.store.shop.length === 1, `shop=${db.store.shop.length}`);
    check('点1b·建了entitlement(expire_at=0)', db.store.shop_entitlement[0] && db.store.shop_entitlement[0].expire_at === 0, `expire_at=${db.store.shop_entitlement[0] && db.store.shop_entitlement[0].expire_at}`);
    check('点1b·建档写audit_log(AUTH_AUTO_PROVISION)', db.store.audit_log.some((a) => a.action === 'AUTH_AUTO_PROVISION'), `audit=${db.store.audit_log.length}`);
  }

  // ===== 点2：shop.user_id !== ctx.user.id → FORBIDDEN =====
  {
    const db = makeFakeDb({ shop: [{ _id: 's1', id: 's1', user_id: 'owner', is_deleted: false }], audit_log: [] });
    const dbinstance = { collection: db.collection };
    const attacker = await assertShopOwner(dbinstance, 's1', 'attacker');
    const owner = await assertShopOwner(dbinstance, 's1', 'owner');
    check('点2·越权→FORBIDDEN', attacker.code === ERROR_CODES.FORBIDDEN, `code=${attacker.code}`);
    check('点2·本人→SUCCESS', owner.code === ERROR_CODES.SUCCESS, `code=${owner.code}`);
    // 幂等键含 shop_id：不同店同一 reqId 不误拦（换店用同一ID不被误拦截）
    const idem1 = await checkIdempotent(dbinstance, 'shopA', 'req1');
    const idem2 = await checkIdempotent(dbinstance, 'shopB', 'req1');
    check('点2·幂等键含shop_id(换店同ID不误拦)', idem1.ok && idem2.ok, `shopA.ok=${idem1.ok}, shopB.ok=${idem2.ok}`);
  }

  // ===== 点3：DataAdapter 列表默认 is_deleted=false，软删不出现 =====
  {
    const db = makeFakeDb({
      shop_monthly_account: [
        { _id: 'a1', shop_id: 'x', month: '2026-08', is_deleted: false },
        { _id: 'a2', shop_id: 'x', month: '2026-07', is_deleted: true },
      ],
      audit_log: [],
    });
    const da = makeAdapter({ collection: db.collection });
    const list = await da.list('shop_monthly_account', { shop_id: 'x' });
    check('点3·软删记录不出现在列表', list.data.length === 1 && list.data[0]._id === 'a1', `len=${list.data.length}`);
    check('点3·查询条件注入is_deleted=false', db.lastWhere['shop_monthly_account'] && db.lastWhere['shop_monthly_account'].is_deleted === false, `cond=${JSON.stringify(db.lastWhere['shop_monthly_account'])}`);
  }

  // ===== 点3b：DataAdapter.get 单条 —— 软删视为不存在（A2 回归护栏）=====
  {
    const db = makeFakeDb({
      shop: [
        { _id: 'g1', user_id: 'owner', is_deleted: false },
        { _id: 'g2', user_id: 'owner', is_deleted: true },
      ],
      audit_log: [],
    });
    const da = makeAdapter({ collection: db.collection });
    const alive = await da.get('shop', 'g1');
    const dead = await da.get('shop', 'g2');
    const missing = await da.get('shop', 'nope');
    check('点3b·get 活跃文档返回文档本体(非{data})', alive && alive.user_id === 'owner' && !('data' in alive), `alive=${JSON.stringify(alive)}`);
    check('点3b·get 软删文档→null', dead === null, `dead=${dead}`);
    check('点3b·get 不存在文档(reject)→null', missing === null, `missing=${missing}`);
  }

  // ===== 点4：环境 ID 属部署前置（不拦提交，单测无法判"真实"）=====
  {
    const dev = env.ENV_MAP.dev, prod = env.ENV_MAP.prod;
    const PLACEHOLDER = /^catering-(dev|prod)-x{4,}$/;
    const isReal = (v) => /^catering-(dev|prod)-[0-9a-z]{6,}$/.test(v) && !PLACEHOLDER.test(v);
    if (isReal(dev) && isReal(prod)) {
      check('点4·dev/prod 已替换为真实环境 ID（非占位符）', true, `dev=${dev}, prod=${prod}`);
    } else {
      todos.push('🔶 点4 未完成：env.js:14-15 仍是占位符 —— 部署前置，非单测可判真；替换真实ID后重跑转 ✅（点⑤ 给 gate 喂输入属真测试，不受影响）');
    }
  }

  // ===== 点5：initDb 25 集合 + dev 门禁 blocked===undefined =====
  {
    check('点5·集合数=25', COLLECTIONS.length === 25, `len=${COLLECTIONS.length}`);
    const gDev = gate('catering-dev-xxxxxx', '');
    const gProd = gate('catering-prod-xxxxxx', '');
    const gWhiteOk = gate('catering-dev-abc', 'catering-dev-abc');
    const gWhiteMis = gate('catering-dev-abc', 'catering-prod-xyz'); // 白名单误配prod→仍拒
    check('点5·dev 环境 gate.blocked===undefined', gDev.blocked === undefined, `blocked=${gDev.blocked}`);
    check('点5·prod 环境 gate.blocked===true', gProd.blocked === true, `blocked=${gProd.blocked}`);
    check('点5·白名单精确匹配dev放行', gWhiteOk.blocked === undefined, `blocked=${gWhiteOk.blocked}`);
    check('点5·白名单误配prod仍拒', gWhiteMis.blocked === true, `blocked=${gWhiteMis.blocked}`);
  }

  // ===== 通用：限流 60 次/分钟 =====
  {
    const rl = makeRateLimiter(new Map());
    let limited = false;
    for (let i = 0; i < 61; i++) { const r = await rl('openid_x'); if (r.limited) limited = true; }
    check('限流·第61次写触发RATE_LIMITED', limited === true, `limited=${limited}`);
  }

  // ---------- 输出 ----------
  console.log('\n===== 批次0 自测结果（复审节点① 五条）=====');
  for (const [st, name, detail] of results) {
    console.log(`${st === 'PASS' ? '✅' : '❌'} ${name}${detail ? '  →  ' + detail : ''}`);
  }
  for (const t of todos) {
    console.log(`${t}`);
  }
  console.log(`\n合计：${pass} 通过 / ${failN} 失败（待办 ${todos.length} 项不计入失败）`);
  process.exit(failN === 0 ? 0 : 1);
})();
