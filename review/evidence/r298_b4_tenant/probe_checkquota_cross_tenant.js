// review/evidence/r298_b4_tenant/probe_checkquota_cross_tenant.js
// R298 · B4 取证：`checkQuota` 跨租户读 —— 行为级复现（不是静态推断）
//
// 场景：调用者 = 用户 B（OPENID=openid_B）；传入的 shop_id = 用户 A 的店（shop_A）
//   修前预期：返回 SUCCESS，used = A 店成本卡数（跨店读成立）
//   修后预期：返回 FORBIDDEN（归属校验拦下）
//
// 实现：Module._load 桩掉 wx-server-sdk + 内存假库（等价于真云 where/doc/add 语义子集）。
// 运行：node review/evidence/r298_b4_tenant/probe_checkquota_cross_tenant.js
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CFN_DIR = path.join(ROOT, 'cloudfunctions', 'checkQuota');

// ===== 假库 =====
function matcher(cond) {
  return (doc) => Object.keys(cond || {}).every((k) => {
    const v = cond[k];
    if (v && typeof v === 'object' && v.__in) return v.__in.indexOf(doc[k]) >= 0;
    return doc[k] === v;
  });
}
function makeDb(tables) {
  const state = JSON.parse(JSON.stringify(tables));
  let autoId = 0;
  function coll(name) {
    const rows = () => (state[name] = state[name] || []);
    function q(cond, opt) {
      const o = Object.assign({ skip: 0, limit: 100 }, opt);
      return {
        skip(n) { return q(cond, Object.assign({}, o, { skip: n })); },
        limit(n) { return q(cond, Object.assign({}, o, { limit: n })); },
        async get() {
          return { data: rows().filter(matcher(cond)).slice(o.skip, o.skip + o.limit) };
        },
        async count() { return { total: rows().filter(matcher(cond)).length }; },
      };
    }
    return {
      where: (cond) => q(cond),
      doc: (id) => ({
        async get() {
          const d = rows().filter((r) => r._id === id)[0];
          if (!d) { const e = new Error('document.get: not exist'); throw e; }
          return { data: d };
        },
        async update(req) {
          const d = rows().filter((r) => r._id === id)[0];
          if (d) Object.assign(d, (req && req.data) || {});
          return { stats: { updated: d ? 1 : 0 } };
        },
      }),
      add: async (req) => {
        autoId += 1;
        const _id = 'auto_' + autoId;
        rows().push(Object.assign({ _id }, (req && req.data) || {}));
        return { _id };
      },
    };
  }
  return { collection: coll, command: {} };
}

// ===== 固定装置：A 店 3 张已算成本卡；B 用户无卡 =====
function fixtures(shopIdOfA) {
  return {
    user: [{ _id: 'ux_B', user_id: 'u_B', openid: 'openid_B', is_deleted: false }],
    shop: [{
      _id: '9f8e7d6c (库自动 _id，故意 ≠ 业务键)', id: shopIdOfA, shop_id: shopIdOfA,
      user_id: 'u_A', name: 'A 的店', is_deleted: false,
    }],
    shop_cost_card: [
      { _id: 'c1', shop_id: shopIdOfA, card_code: 'dish_1', calc_status: 'calculated', is_deleted: false },
      { _id: 'c2', shop_id: shopIdOfA, card_code: 'dish_2', calc_status: 'calculated', is_deleted: false },
      { _id: 'c3', shop_id: shopIdOfA, card_code: 'dish_3', calc_status: 'calculated', is_deleted: false },
      { _id: 'c4', shop_id: shopIdOfA, card_code: 'dish_4', calc_status: 'draft', is_deleted: false },
    ],
    feature_permissions: [{ _id: 'fp1', plan_id: 'plan_free', limits: { shop: 1, cost_card: 20, hard_shop: 200, hard_card: 2000 } }],
    shop_entitlement: [],
  };
}

// ===== 桩 wx-server-sdk =====
const SHOP_A = 'shop_aaaaaaaaaaaa';
let CURRENT_OPENID = 'openid_B';
const fakeDb = makeDb(fixtures(SHOP_A));
const WX_STUB = {
  DYNAMIC_CURRENT_ENV: 'dyn',
  init() {},
  database: () => fakeDb,
  getWXContext: () => ({ OPENID: CURRENT_OPENID, ENV: 'dev-stub' }),
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'wx-server-sdk') return WX_STUB;
  return origLoad.call(this, req, parent, isMain);
};

let mod = null;
try {
  mod = require(path.join(CFN_DIR, 'index.js'));
} finally {
  Module._load = origLoad;
}

(async () => {
  console.log('===== R298 · B4 · checkQuota 跨租户读（行为级）=====');
  console.log('调用者 OPENID   : ' + CURRENT_OPENID + '（= 用户 B）');
  console.log('传入 shop_id    : ' + SHOP_A + '（= 用户 A 的店）');
  console.log('A 店成本卡      : 3 张 calculated + 1 张 draft（draft 不占额）');
  console.log('B 用户成本卡    : 0 张');
  console.log('');

  const r = await mod.main({ shop_id: SHOP_A, scope: 'cost_card' });
  console.log('出参 RAW        : ' + JSON.stringify(r));
  console.log('出参 code       : ' + (r && r.code));
  console.log('');

  const leaked = !!(r && r.code === 'SUCCESS' && r.data && Number(r.data.used) > 0);
  if (leaked) {
    console.log('🔴 结论：跨租户读**成立** —— 用户 B 读到了用户 A 店的成本卡数 used=' + r.data.used);
  } else if (r && r.code === 'FORBIDDEN') {
    console.log('✅ 结论：归属校验**已拦截**（FORBIDDEN）—— 用户 B 拿不到 A 店数据');
  } else {
    console.log('⚠️ 结论：既非泄漏也非 FORBIDDEN（code=' + (r && r.code) + '）—— 判据需核对');
  }
  process.exit(leaked ? 2 : 0);
})().catch((e) => { console.error('probe error:', e && (e.stack || e.message || e)); process.exit(3); });
