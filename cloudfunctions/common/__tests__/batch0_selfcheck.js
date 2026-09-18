// cloudfunctions/common/__tests__/batch0_selfcheck.js
// 批次 0 自测：用内存假 db 验证复审节点① 五条（点1~点5）。
// 运行：node cloudfunctions/common/__tests__/batch0_selfcheck.js
// 纯逻辑，无需 wx-server-sdk / 云环境。

const path = require('path');
const ROOT = path.resolve(__dirname, '../../..'); // catering-profit 根

const { resolveAuth, assertShopOwner, defaultShopId, genId, isDuplicateKeyError } = require('../auth');
const { makeAdapter } = require('../dataAdapter');
const { checkIdempotent, findPriorResult, shopKey } = require('../idempotency');
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
  }

  // ===== 🔒 R72：幂等单源化后的行为契约 =====
  // 契约改为 (db, key) → boolean，key 由调用方构造。
  // ⚠️ 旧 (db, shopId, clientRequestId) 三参形态**已废除**（R72）：它零生产调用，
  //    真正生效的 3 处各自内联了同一段查询 ⇒ 同一语义 4 份实现、本模块是死的。
  //    随之取消的是「模块自带 shop_id 隔离」这一从未被使用的行为；隔离改由**调用方前缀**承担。
  {
    const db = makeFakeDb({ audit_log: [] });
    const dbinstance = { collection: db.collection };
    const noKey = await checkIdempotent(dbinstance, '');
    check('R72·空 key → false（该调用点不做幂等约束）', noKey === false, `got=${noKey}`);
    const miss = await checkIdempotent(dbinstance, 'adm_grant_req1');
    check('R72·未登记 key → false', miss === false, `got=${miss}`);
  }
  {
    const db = makeFakeDb({
      audit_log: [
        { _id: 'al1', idempotency_key: 'adm_grant_req1' },
        { _id: 'al2', shop_id: 'shopA', idempotency_key: shopKey('shopA', 'req2') },
      ],
    });
    const dbinstance = { collection: db.collection };
    const hit = await checkIdempotent(dbinstance, 'adm_grant_req1');
    check('R72·已登记 key → true（判为重复提交）', hit === true, `got=${hit}`);
    // 隔离能力仍在，但责任在调用方：前缀带店号 ⇒ 换店用同一 reqId 互不命中
    // ⚠️ 夹具改用单源 shopKey() 造键：原先写死 `'shop_shopA__req2'`（多一个 `shop_` 前缀），
    //    而全仓**没有任何地方**产出这种键 ⇒ 夹具与真实格式脱节的误导，已纠正。
    const a = await checkIdempotent(dbinstance, shopKey('shopA', 'req2'));
    const b = await checkIdempotent(dbinstance, shopKey('shopB', 'req2'));
    check('R72·换店同 reqId 不误拦（靠调用方前缀隔离）', a === true && b === false, `A=${a}, B=${b}`);
  }

  // ===== 🔒 R73：重放形态（findPriorResult）+ 键格式单源（shopKey）=====
  // 背景：契约（喂投包 §181 / §6.1）要求"同一 client_request_id 重复请求**直接返回首次结果**、
  //   不重复写入"，而 saveCostCard 曾自带一份 `getIdempotent` 内联实现 ⇒ 与单源构成两份。
  // 本节的**假库真往返**（writeAudit 登记 → findPriorResult 取回）直接证伪
  //   「登记了却查不到」这类静默失效 —— R73 修的正是它。
  {
    check('R73·shopKey 格式 = <shopId>__<crid>', shopKey('shopA', 'req1') === 'shopA__req1', `=${shopKey('shopA', 'req1')}`);
    check('R73·shopKey 空 crid → 空串（= 该调用点不做约束）',
      shopKey('shopA', '') === '' && shopKey('shopA', undefined) === '');
  }
  {
    const db = makeFakeDb({ audit_log: [] });
    const miss = await findPriorResult({ collection: db.collection }, 'shopA', 'req_none');
    check('R73·未登记 → null（不误判成"已处理过"）', miss === null, `got=${JSON.stringify(miss)}`);
  }
  {
    // 用**全新的**假库，才能用 lastWhere 判定"到底有没有查库"
    const db = makeFakeDb({ audit_log: [] });
    const empty = await findPriorResult({ collection: db.collection }, 'shopA', '');
    check('R73·空 crid → null（无键不受约束）', empty === null, `got=${JSON.stringify(empty)}`);
    check('R73·空 crid 时**连库都不查**（无谓读为 0）', db.lastWhere.audit_log === undefined,
      `lastWhere=${JSON.stringify(db.lastWhere.audit_log)}`);
  }
  {
    // 🏆 真往返：登记侧的键 ≡ 查重侧的键
    const db = makeFakeDb({ audit_log: [] });
    const dbinstance = { collection: db.collection };
    const firstResult = { shop_id: 'shopA', asset_id: 'amort_1', client_request_id: 'req_rt' };
    await writeAudit(dbinstance, {
      action: 'SAVE_ASSET', operator_type: 'user', operator_id: 'u1', shop_id: 'shopA',
      after_data: firstResult, idempotency_key: shopKey('shopA', 'req_rt'),
    });
    const got = await findPriorResult(dbinstance, 'shopA', 'req_rt');
    check('R73🏆 往返一致：findPriorResult 取回 writeAudit 存的首次结果',
      !!got && got.asset_id === 'amort_1' && got.shop_id === 'shopA', `got=${JSON.stringify(got)}`);
    check('R73·换店同 crid 不误命中（shop 维度隔离）',
      (await findPriorResult(dbinstance, 'shopB', 'req_rt')) === null);
    check('R73·两种形态对同一行判定一致（checkIdempotent 亦命中）',
      (await checkIdempotent(dbinstance, shopKey('shopA', 'req_rt'))) === true);
  }
  {
    // 边界：行存在但**没有 after_data**（例如只记 before 的审计行）⇒ 必须返回 null，
    //   否则调用方会把 undefined 当"首次结果"返回 = 假成功 + 数据丢失
    const db = makeFakeDb({ audit_log: [{ _id: 'al9', shop_id: 'shopA', idempotency_key: shopKey('shopA', 'req_bf') }] });
    const got = await findPriorResult({ collection: db.collection }, 'shopA', 'req_bf');
    check('R73·命中行无 after_data → null（不当成首次结果返回）', got === null, `got=${JSON.stringify(got)}`);
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
      check('点4·dev/prod 已替换为真实环境 ID（非占位符）', true, `dev=${dev}, prod=${prod}`); // R71-ok: 已知未完成项（env.js 仍为占位符），由上方 todos 承载，替换真实 ID 后才可判真
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

  // ===== A6b（2026-09-19）：并发首次进入只能建出**一个**店 =====
  // 背景：真云实测 `shop.idx_shop_user` **非** unique（同一 user_id 连插两次都成功，
  //   `review/evidence/uniq_probe_result.json`）⇒ 「随机 id + 先查后建」在并发下能建出两个店，
  //   而 `resolveAuth` 是**每个云函数的必经路径**。
  // 本用例用「会拒重复 `_id` / 重复 `openid`」的**严格假库**模拟真云行为：
  //   · `_id` 重复 → 抛 -502001/E11000（真云原文形态）
  //   · `user.openid` 重复 → 抛 -502001/E11000（对应 `idx_openid` unique，真云实测生效）
  // ⚠️ 判据不得恒真：旧实现（随机 genId + 先查后建）在本用例下 **shop 会 = 2** ⇒ 必须转红。
  {
    function makeStrictFakeDb() {
      const store = {};
      const dup = () => {
        const e = new Error('collection.add:fail -502001 database request fail. [FailedOperation.Insert] '
          + 'bulk write error: E11000 duplicate key error collection: tnt.shop index: idx_dup dup key: { }');
        e.errCode = -502001;
        throw e;
      };
      return {
        store,
        collection(name) {
          const arr = (store[name] = store[name] || []);
          return {
            where(cond) {
              const filtered = arr.filter((d) => match(d, cond));
              return {
                limit(n) { return { get() { return Promise.resolve({ data: filtered.slice(0, n) }); } }; },
                get() { return Promise.resolve({ data: filtered }); },
              };
            },
            add({ data }) {
              const doc = Object.assign({}, data);
              if (doc._id != null && arr.some((x) => x._id === doc._id)) dup();
              if (name === 'user' && doc.openid != null && arr.some((x) => x.openid === doc.openid)) dup();
              if (doc._id == null) doc._id = 'gen_' + Math.random().toString(36).slice(2);
              arr.push(doc);
              return Promise.resolve({ _id: doc._id });
            },
          };
        },
      };
    }
    const sdb = makeStrictFakeDb();
    const [a, b] = await Promise.all([
      resolveAuth({ OPENID: 'openid_new_user' }, sdb),
      resolveAuth({ OPENID: 'openid_new_user' }, sdb),
    ]);
    const errs = [a, b].filter((x) => x && x.error);
    check('A6b·并发首进不得硬失败（撞唯一键要容错回读）', errs.length === 0, `errors=${JSON.stringify(errs)}`);
    check('A6b·并发首进只建出 1 个 user', (sdb.store.user || []).length === 1, `user=${(sdb.store.user || []).length}`);
    // ⚠️ 措辞纪律：本断言在 resolveAuth 场景下**不是**靠确定性 id 生效的
    //   （输家采用了赢家的 user_id 后**提前返回**，根本不建店）⇒ 别把功劳记错。
    check('A6b·并发首进只建出 1 个 shop', (sdb.store.shop || []).length === 1,
      `shop=${(sdb.store.shop || []).length}`);
    check('A6b·并发首进只建出 1 条 entitlement', (sdb.store.shop_entitlement || []).length === 1,
      `ent=${(sdb.store.shop_entitlement || []).length}`);
    const ids = [a, b].map((x) => x && x.user && x.user.id).filter(Boolean);
    check('A6b·并发两次拿到同一个 user_id', ids.length === 2 && ids[0] === ids[1], `ids=${ids.join(',')}`);
    const shopIds = (sdb.store.shop || []).map((s) => s.shop_id);
    check('A6b·店铺 id 用单源确定性格式 shop_<user_id>',
      shopIds.length === 1 && shopIds[0] === defaultShopId(ids[0]), `shop_id=${shopIds.join(',')}`);

    // ---- 机制级判据（这才真正压住「同一 user 建出两个店」的那条路径）----
    // 场景：用户已存在但**没有店**（`getShopContext` 建店分支 / 建档中途失败的补偿重跑），
    //   两个并发请求都「先查到没有 → 各自 insert」。真云实测 `shop.idx_shop_user` **非** unique
    //   ⇒ 唯一能拦住第二份的，只有**确定性 `_id`**。
    const uid = 'u_mech_probe';
    const sdb2 = makeStrictFakeDb();
    await sdb2.collection('shop').add({ data: { _id: defaultShopId(uid), shop_id: defaultShopId(uid), user_id: uid } });
    let rejected = null;
    try {
      await sdb2.collection('shop').add({ data: { _id: defaultShopId(uid), shop_id: defaultShopId(uid), user_id: uid } });
    } catch (e) { rejected = isDuplicateKeyError(e); }
    check('A6b·机制级：确定性 id ⇒ 同 user 第二次建店被库拒', rejected === true, `rejected=${rejected}`);
    check('A6b·机制级：仅剩 1 个店', sdb2.store.shop.length === 1, `shop=${sdb2.store.shop.length}`);

    // 反向证据（证判据有鉴别力）：换回随机 `genId` ⇒ 两次都成功 = 2 个店 = **旧实现的真实后果**
    const sdb3 = makeStrictFakeDb();
    await sdb3.collection('shop').add({ data: { _id: genId('shop_'), user_id: uid } });
    await sdb3.collection('shop').add({ data: { _id: genId('shop_'), user_id: uid } });
    check('A6b·反向证据：随机 id 两次都成功 ⇒ 2 个店（这就是旧实现能建出重复店的原因）',
      sdb3.store.shop.length === 2, `shop=${sdb3.store.shop.length}`);
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
