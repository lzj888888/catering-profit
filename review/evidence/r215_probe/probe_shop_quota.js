// probe_shop_quota.js —— R215 探针：真跑生产 manageShop/index.js，验「付费档是否解锁多账套」
//
// 为什么不是读代码猜：
//   · 记忆红线「锚点复算/真跑生产引擎」；本探针用 Module._load 拦截 wx-server-sdk，
//     **require 生产 Controller 源码本身**，喂不同 (used, expire_at) 组合，看真实出参。
//   · 云端现在**没有付费用户**（支付未开 ⇒ expire_at 恒 0）⇒ GUI/真机实测只能验免费档，
//     验不出付费档；付费态只能用本探针构造。
//
// 对照实验（防止"是我 mock 坏了"）：
//   同一 mock 下跑 hasFeature('export') —— 付费态若为 true，证明 expire_at 确实被读到。
//
// 判据口径：只看 ok/fail 的 code，不看 rc。

const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..', '..');   // 仓根（review/evidence/r215_probe → 上三级）
const FN = path.join(ROOT, 'cloudfunctions', 'manageShop', 'index.js');

// ===== 1. 内存库 =====
const STORE = {
  user: [], shop: [], shop_entitlement: [], feature_permissions: [], audit_log: [],
};

function match(cond, row) {
  if (!cond) return true;
  for (const k of Object.keys(cond)) {
    const want = cond[k];
    const got = row && row[k];
    if (want && typeof want === 'object') continue;    // 不处理 $in/$gt 等（本探针用不到）
    if (got !== want) return false;
  }
  return true;
}

function makeQuery(name, cond) {
  let _limit = null, _skip = 0;
  const q = {
    limit(n) { _limit = n; return q; },
    skip(n) { _skip = n; return q; },
    orderBy() { return q; },
    field() { return q; },
    async get() {
      let rows = (STORE[name] || []).filter((r) => !r.is_deleted || cond === undefined || cond.is_deleted !== undefined ? true : true);
      rows = (STORE[name] || []).filter((r) => match(cond, r));
      const sliced = _limit == null ? rows.slice(_skip) : rows.slice(_skip, _skip + _limit);
      return { data: sliced.map((r) => Object.assign({}, r)) };
    },
    async count() { return { total: (STORE[name] || []).filter((r) => match(cond, r)).length }; },
  };
  return q;
}

function makeColl(name) {
  return {
    where(cond) { return makeQuery(name, cond); },
    limit(n) { return makeQuery(name, undefined).limit(n); },
    async count() { return { total: (STORE[name] || []).length }; },
    async add({ data }) {
      const row = Object.assign({}, data);
      if (!row._id) row._id = 'gen_' + name + '_' + Math.random().toString(36).slice(2, 10);
      (STORE[name] = STORE[name] || []).push(row);
      return { _id: row._id };
    },
    doc(id) {
      return {
        async get() {
          const r = (STORE[name] || []).filter((x) => x._id === id)[0];
          if (!r) { const e = new Error('document does not exist'); e.errCode = -1; throw e; }
          return { data: Object.assign({}, r) };
        },
        async update({ data }) {
          const r = (STORE[name] || []).filter((x) => x._id === id)[0];
          if (!r) return { stats: { updated: 0 } };
          Object.assign(r, data);
          return { stats: { updated: 1 } };
        },
        async remove() {
          const i = (STORE[name] || []).findIndex((x) => x._id === id);
          if (i < 0) return { stats: { removed: 0 } };
          STORE[name].splice(i, 1);
          return { stats: { removed: 1 } };
        },
      };
    },
  };
}

const DB = { collection: (n) => makeColl(n), command: {}, serverDate: () => new Date() };

let CUR_CTX = {};
const MOCK_SDK = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'mock-env',
  getWXContext() { return Object.assign({}, CUR_CTX); },
  database() { return DB; },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return MOCK_SDK;
  return origLoad.apply(this, arguments);
};

// ===== 2. 装载生产代码 =====
const fn = require(FN);
const entitlement = require(path.join(ROOT, 'cloudfunctions', 'common', 'entitlement.js'));

const NOW = Date.now();
const FAR = new Date('2099-12-31T00:00:00Z').getTime();       // 付费（远未到期）
const PAST = NOW - 86400000;                                   // 已过期

const LIMITS = { shop: 1, cost_card: 20, hard_shop: 200, hard_card: 2000 };  // 与 initDb/collections.js 种子一致

function resetStore({ shops, expireAt }) {
  STORE.user = [{ _id: 'u1', user_id: 'U_TEST', openid: 'OPENID_TEST', is_deleted: false }];
  STORE.shop = [];
  for (let i = 0; i < shops; i++) {
    STORE.shop.push({
      _id: 'shop_seed_' + i, id: 'shop_seed_' + i, shop_id: 'shop_seed_' + i,
      user_id: 'U_TEST', name: '种子店' + i, is_deleted: false,
    });
  }
  STORE.shop_entitlement = [{ _id: 'e1', user_id: 'U_TEST', expire_at: expireAt }];
  STORE.feature_permissions = [{ _id: 'fp1', plan_id: 'plan_free', feature_key: 'free_quota', enabled: true, limits: LIMITS }];
  STORE.audit_log = [];
  CUR_CTX = { OPENID: 'OPENID_TEST' };
}

async function callManageShop(op, name, crid) {
  const ev = { op, name, client_request_id: crid };
  return await fn.main(ev);
}

const rows = [];
// 🔴 判据口径修正（首跑踩到）：`ok()` 的返回**也带 code**（`code:'SUCCESS'`），
//    且出参载荷在 `r.data` 里 ⇒ 不能写 `r.code ? FAIL : OK`，也不能读顶层字段。
const isOk = (r) => !!(r && r.code === 'SUCCESS');
const verdict = (r) => (isOk(r) ? 'OK' : 'FAIL:' + ((r && r.code) || 'UNKNOWN'));
const body = (r) => (r && r.data) || {};
function log(scenario, r, expect) {
  rows.push({ scenario, got: verdict(r), expect, raw: JSON.stringify(r).slice(0, 200) });
}

(async () => {
  // ---- 对照组：证明 mock 的付费态真生效 ----
  resetStore({ shops: 0, expireAt: FAR });
  const paidExport = await entitlement.hasFeature(DB, 'U_TEST', 'export');
  resetStore({ shops: 0, expireAt: 0 });
  const freeExport = await entitlement.hasFeature(DB, 'U_TEST', 'export');
  rows.push({ scenario: 'CTRL-1 付费态 hasFeature(export)=true', got: String(paidExport), expect: 'true', raw: '证明 mock 的 expire_at 真被读到' });
  rows.push({ scenario: 'CTRL-2 免费态 hasFeature(export)=false', got: String(freeExport), expect: 'false', raw: '对照组：免费态确实未解锁' });

  // ---- S0：免费用户 used=0 → 应成功 ----
  resetStore({ shops: 0, expireAt: 0 });
  log('S0 免费 used=0 → 建第1家（应 OK）', await callManageShop('create', '甲店', 'c_s0'), 'OK');

  // ---- S1：免费用户 used=1 → 应被拦（符合设计）----
  resetStore({ shops: 1, expireAt: 0 });
  log('S1 免费 used=1 → 建第2家（应 FREE_LIMIT_EXCEEDED）', await callManageShop('create', '乙店', 'c_s1'), 'FAIL:FREE_LIMIT_EXCEEDED');

  // ---- S2：付费用户 used=1 → specs 说"账套不限" ⇒ 应 OK ----
  resetStore({ shops: 1, expireAt: FAR });
  log('S2 付费 used=1 → 建第2家（specs: 账套不限 ⇒ 应 OK）', await callManageShop('create', '乙店', 'c_s2'), 'OK');

  // ---- S3：付费用户 used=5 → 仍应 OK（不限）----
  resetStore({ shops: 5, expireAt: FAR });
  log('S3 付费 used=5 → 建第6家（应 OK）', await callManageShop('create', '己店', 'c_s3'), 'OK');

  // ---- S4：付费用户 used=200 → 应触硬上限 ----
  resetStore({ shops: 200, expireAt: FAR });
  log('S4 付费 used=200 → 建第201家（应 HARD_CAP_EXCEEDED）', await callManageShop('create', '超硬顶', 'c_s4'), 'FAIL:HARD_CAP_EXCEEDED');

  // ---- S5：权益过期（曾付费）used=1 → 应回落到免费档被拦 ----
  resetStore({ shops: 1, expireAt: PAST });
  log('S5 过期权益 used=1 → 建第2家（应 FREE_LIMIT_EXCEEDED）', await callManageShop('create', '乙店', 'c_s5'), 'FAIL:FREE_LIMIT_EXCEEDED');

  // ---- S6：幂等重放（同 crid 两次，免费档 used=0）----
  resetStore({ shops: 0, expireAt: 0 });
  const r1 = await callManageShop('create', '甲店', 'c_s6');
  const r2 = await callManageShop('create', '甲店', 'c_s6');
  // 🔴 判据口径修正 2（首跑踩到）：预检命中后 `return ok(prior0)` 返回的是**首次结果的原文**，
  //    故 `replayed` 恒为 false（"重放"这个语义体现在**没有再写一次库**，不是字段改写成 true）。
  //    ⇒ 判据应看 shop 表行数 / 审计行数是否仍为 1，而不是 replayed 字段。
  rows.push({
    scenario: 'S6 幂等：同 crid 第二次不该重复建店（行数仍为 1）',
    got: 'first=' + verdict(r1) + ' second=' + verdict(r2)
       + ' shopRows=' + STORE.shop.length + ' auditRows=' + STORE.audit_log.length,
    expect: 'first=OK second=OK shopRows=1 auditRows=1',
    raw: JSON.stringify(r2).slice(0, 200),
  });

  // ---- 输出 ----
  const out = [];
  out.push('===== R215 探针：manageShop 账套额度（真跑生产 Controller）=====');
  out.push('limits(种子) = ' + JSON.stringify(LIMITS));
  out.push('');
  let bad = 0;
  for (const r of rows) {
    const ok = r.got === r.expect;
    if (!ok) bad++;
    out.push((ok ? '✅ ' : '❌ ') + r.scenario);
    out.push('     实得: ' + r.got);
    out.push('     期望: ' + r.expect);
    if (!ok) out.push('     原始: ' + r.raw);
  }
  out.push('');
  out.push('===== 结果：' + (rows.length - bad) + ' 通过 / ' + bad + ' 失败 =====');
  const txt = out.join('\n');
  require('fs').writeFileSync(path.join(__dirname, 'probe_out.txt'), txt, 'utf8');
  process.stdout.write(txt + '\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  require('fs').writeFileSync(path.join(__dirname, 'probe_out.txt'), 'CRASH: ' + (e && e.stack || e), 'utf8');
  process.stdout.write('CRASH: ' + (e && e.stack || e) + '\n');
  process.exit(2);
});
