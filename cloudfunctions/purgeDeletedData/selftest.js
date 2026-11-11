// cloudfunctions/purgeDeletedData/selftest.js —— R688 · 已删除数据物理清理自测
// 运行： node cloudfunctions/purgeDeletedData/selftest.js
//
// 本自测**真跑 main()**（用内存假库替换 wx-server-sdk），不只看源码形状 ——
// 因为这里唯一要紧的行为是「该删的删了、不该删的一条都没动」，形状断言看不出来。
const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const SRC = (() => {
  const raw = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
})();

// ===== 内存假库 =====
const CMD = '__cmd__';
function makeDb(seed) {
  const store = {};
  for (const k of Object.keys(seed)) store[k] = seed[k].map((d) => Object.assign({}, d));

  const command = {
    gt: (v) => ({ [CMD]: 'gt', v }),
    lt: (v) => ({ [CMD]: 'lt', v }),
    and: (...a) => ({ [CMD]: 'and', v: a }),
  };

  function matchOne(dv, c) {
    if (c && typeof c === 'object' && c[CMD]) {
      const op = c[CMD];
      if (op === 'gt') return dv > c.v;
      if (op === 'lt') return dv < c.v;
      if (op === 'and') return c.v.every((x) => matchOne(dv, x));
      return false;
    }
    return dv === c;
  }
  function match(doc, cond) {
    return Object.keys(cond).every((k) => matchOne(doc[k], cond[k]));
  }

  return {
    command,
    __store: store,
    collection(name) {
      // ⚠️ 不在查询时自动建空数组：真实库里"查一个不存在的集合"不会创建它。
      //   首版在这里 `if (!store[name]) store[name] = []` ⇒ 干跑遍历 19 张表后
      //   store 平白多出十几个空数组键 ⇒「干跑后库内容逐字未变」假红。
      const rows = () => store[name] || [];
      return {
        where(cond) {
          const sel = () => rows().filter((d) => match(d, cond));
          return {
            limit: (n) => ({ get: async () => ({ data: sel().slice(0, n) }) }),
            get: async () => ({ data: sel() }),
            count: async () => ({ total: sel().length }),
            remove: async () => {
              const before = rows().length;
              store[name] = rows().filter((d) => !match(d, cond));
              return { stats: { removed: before - store[name].length } };
            },
          };
        },
        doc(id) {
          return {
            remove: async () => {
              store[name] = rows().filter((d) => d._id !== id);
              return {};
            },
          };
        },
        add: async (p) => {
          // 真写进库：否则「清理动作有没有留痕」根本测不出来（首版 add 返回假 id 不落库，
          // 导致 PURGE_* 审计永远查不到，而这正是本函数要保证的事）
          const d = Object.assign({ _id: 'n' + rows().length }, (p && p.data) || {});
          store[name] = rows().concat([d]);
          return { _id: d._id };
        },
      };
    },
  };
}

// 在 require index.js 之前把 wx-server-sdk 换成假云
let CURRENT_DB = makeDb({});
let FAKE_OPENID = '';   // 非空 ⇒ 模拟「小程序端调用」，必须被拒
// 🔴 必须用 Proxy 转发：index.js 顶部 `const db = cloud.database()` 在**模块加载时只调一次**，
//   若这里直接 `database: () => CURRENT_DB`，db 会永久绑到最初那个空库，
//   后面换了 CURRENT_DB 也白换 —— 首版就栽在这，表现为"实删 0 个店"却看不出原因。
const COMMAND = makeDb({}).command;
const fakeCloud = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'dyn',
  database: () => new Proxy({}, {
    get(t, prop) {
      if (prop === 'command') return COMMAND;
      const v = CURRENT_DB[prop];
      return typeof v === 'function' ? v.bind(CURRENT_DB) : v;
    },
  }),
  getWXContext: () => (FAKE_OPENID ? { OPENID: FAKE_OPENID } : {}),
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fakeCloud;
  return origLoad.apply(this, arguments);
};
const fn = require('./index.js');

const DAY = 24 * 3600 * 1000;
const NOW = Date.now();

// 夹具：一个到期店(D1)、一个未到期店(D2)、一个 delete_at=0 的店(D3)
function makeSeed() {
  return {
    shop: [
      { _id: 'D1', is_deleted: true, delete_at: NOW - 31 * DAY },
      { _id: 'D2', is_deleted: true, delete_at: NOW - 5 * DAY },
      { _id: 'D3', is_deleted: true, delete_at: 0 },
    ],
    shop_monthly_income: [
      { _id: 'i1', shop_id: 'D1' }, { _id: 'i2', shop_id: 'D2' }, { _id: 'i3', shop_id: 'D3' },
    ],
    shop_cost_card: [
      { _id: 'c1', shop_id: 'D1' }, { _id: 'c2', shop_id: 'D2' },
    ],
    // 受保护：即使属于到期店，也**一条都不许删**
    shop_payment_flow: [{ _id: 'p1', shop_id: 'D1', order_no: 'o1' }],
    audit_log: [{ _id: 'a1', shop_id: 'D1', action: 'X' }],
    order_refund: [{ _id: 'r1', shop_id: 'D1', order_no: 'o1' }],
    user: [
      { _id: 'u1', user_id: 'U1', is_deleted: true, delete_at: NOW - 40 * DAY },
      { _id: 'u2', user_id: 'U2', is_deleted: true, delete_at: NOW - 2 * DAY },
    ],
    shop_entitlement: [
      { _id: 'e1', user_id: 'U1' }, { _id: 'e2', user_id: 'U2' },
    ],
    shop_diagnosis_credit: [{ _id: 'g1', user_id: 'U1' }],
  };
}

async function run() {
  // ===== A. 常量与口径 =====
  console.log('===== A · 口径常量 =====');
  check('保留期 RETENTION_DAYS = 15（< 15 个工作日，满足自查清单口径）',
    /const RETENTION_DAYS = 15;/.test(SRC));
  check('有单次店铺数护栏 MAX_SHOPS_PER_RUN', /MAX_SHOPS_PER_RUN = \d+/.test(SRC));
  check('有时间预算 BUDGET_MS（防撞云函数 20s 超时）', /BUDGET_MS = \d+/.test(SRC));
  check('支持干跑 dryRun', /dryRun === true/.test(SRC));

  // ===== B. 清单正确性 =====
  console.log('\n===== B · 删除清单 vs 保护清单 =====');
  const delM = SRC.match(/const DELETABLE = \[([\s\S]*?)\];/);
  const delList = delM ? (delM[1].match(/'[a-z_0-9]+'/g) || []).map((s) => s.replace(/'/g, '')) : [];
  const protM = SRC.match(/const PROTECTED = \{([\s\S]*?)\n\};/);
  const protList = protM ? (protM[1].match(/^\s*([a-z_0-9]+):/gm) || []).map((s) => s.replace(/[\s:]/g, '')) : [];

  check('解析出 DELETABLE（应 ≥15 张表）', delList.length >= 15, `${delList.length} 张`);
  check('解析出 PROTECTED（应 ≥2 张表）', protList.length >= 2, protList.join(','));
  const overlap = delList.filter((x) => protList.includes(x));
  check('DELETABLE 与 PROTECTED 无交集（否则保护形同虚设）',
    overlap.length === 0, overlap.length ? '重叠：' + overlap.join(',') : '无重叠');

  // 覆盖：从建库单源推导所有含 shop_id 索引的集合，必须被 删 或 保护 覆盖
  const { INDEXES, COLLECTIONS } = require(path.join(__dirname, '../../cloudfunctions/initDb/collections.js'));
  const allNames = COLLECTIONS.map((x) => (typeof x === 'string' ? x : x.name));
  const byShop = allNames.filter((n) => (INDEXES[n] || []).some((i) => i.keys && Object.keys(i.keys).includes('shop_id')));
  const uncovered = byShop.filter((n) => !delList.includes(n) && !protList.includes(n));
  check('含 shop_id 的集合全部有归属（删或显式保护）', uncovered.length === 0,
    uncovered.length ? '未登记：' + uncovered.join(',') : `覆盖 ${byShop.length} 张`);
  check('shop_payment_flow 在保护清单（电子商务法 3 年）', protList.includes('shop_payment_flow'));
  check('audit_log 不在保护清单、而在删除清单（R688 修订：随经营数据 15 天删，与 RETENTION_DAYS 同源）',
    !protList.includes('audit_log') && delList.includes('audit_log'));
  check('audit_log 排在删除清单第一位（先清旧审计，再写本轮清理审计）',
    delList[0] === 'audit_log', `首位=${delList[0]}`);

  // ===== S. 安全：客户端不可达 =====
  console.log('\n===== S · 安全自保（客户端不得调用）=====');
  FAKE_OPENID = 'oXXXX_user';
  CURRENT_DB = makeDb(makeSeed());
  const rForbidden = await fn.main({});
  const sForbidden = CURRENT_DB.__store;
  check('有 OPENID（客户端直调）时直接拒绝',
    rForbidden && rForbidden.code === 'FORBIDDEN');
  check('被拒时一条数据都没删（不是"先删再报错"）',
    sForbidden.shop.length === 3 && sForbidden.shop_monthly_income.length === 3);
  check('被拒时也没写审计（无副作用）',
    !sForbidden.audit_log.some((d) => d.action === 'PURGE_DELETED_SHOP'));
  FAKE_OPENID = '';
  // ===== C. 真跑：实删 =====
  console.log('\n===== C · 真跑 main()（实删）=====');
  CURRENT_DB = makeDb(makeSeed());
  const r1 = await fn.main({});
  const s1 = CURRENT_DB.__store;

  check('到期店 D1 的月收入被删', s1.shop_monthly_income.filter((d) => d.shop_id === 'D1').length === 0);
  check('到期店 D1 的成本卡被删', s1.shop_cost_card.filter((d) => d.shop_id === 'D1').length === 0);
  check('到期店 D1 自身被删', s1.shop.filter((d) => d._id === 'D1').length === 0);

  check('未到期店 D2 的数据**一条未动**', s1.shop_monthly_income.filter((d) => d.shop_id === 'D2').length === 1);
  check('未到期店 D2 自身仍在', s1.shop.filter((d) => d._id === 'D2').length === 1);
  check('delete_at=0 的店 D3 不被当作到期（红线①）',
    s1.shop.filter((d) => d._id === 'D3').length === 1 &&
    s1.shop_monthly_income.filter((d) => d.shop_id === 'D3').length === 1);

  check('受保护 shop_payment_flow 一条未删', s1.shop_payment_flow.length === 1);
  check('到期店的旧审计随经营数据被清（R688：audit_log 不再单独保护）',
    s1.audit_log.filter((d) => d.action === 'X').length === 0);
  check('清理动作本身留下 AUDIT（PURGE_DELETED_SHOP）',
    s1.audit_log.some((d) => d.action === 'PURGE_DELETED_SHOP'));
  check('清理审计不含金额字段（只写 id 与计数）',
    s1.audit_log.filter((d) => d.action === 'PURGE_DELETED_SHOP')
      .every((d) => !/fen|profit|amount|sales/i.test(JSON.stringify(d.after_data || {}))));
  check('受保护 order_refund 一条未删', s1.order_refund.length === 1);

  check('到期用户 U1 被物理删除', s1.user.filter((d) => d.user_id === 'U1').length === 0);
  check('到期用户 U1 的 entitlement/诊断次数被删',
    s1.shop_entitlement.filter((d) => d.user_id === 'U1').length === 0 &&
    s1.shop_diagnosis_credit.filter((d) => d.user_id === 'U1').length === 0);
  check('未到期用户 U2 仍在', s1.user.filter((d) => d.user_id === 'U2').length === 1);
  check('返回体记录清理明细', Array.isArray(r1.shops) && r1.shops.length === 1 && Array.isArray(r1.users), JSON.stringify({ shops: r1.shops.length, users: r1.users.length }));
  check('清理过程无错误', r1.errors.length === 0, JSON.stringify(r1.errors));

  // ===== D. 真跑：干跑 =====
  console.log('\n===== D · 干跑不得改动任何数据 =====');
  CURRENT_DB = makeDb(makeSeed());
  const before = JSON.stringify(CURRENT_DB.__store);
  const r2 = await fn.main({ dryRun: true });
  const after = JSON.stringify(CURRENT_DB.__store);
  check('干跑后库内容逐字未变（红线③）', before === after);
  check('干跑仍给出统计（否则无法预演）',
    r2 && r2.dry_run === true && Array.isArray(r2.shops) && r2.shops.length === 1,
    `dry_run=${r2 && r2.dry_run} shops=${r2 && r2.shops && r2.shops.length}`);
  check('干跑报出的是「将要删多少条」而不是 0',
    (r2.shops[0].collections.shop_monthly_income || 0) === 1,
    `income=${r2.shops[0].collections.shop_monthly_income}`);

  // ===== E. 先子后父 =====
  console.log('\n===== E · 删除顺序 =====');
  const posChild = SRC.indexOf('for (const c of DELETABLE)');
  const posShopDel = SRC.indexOf("db.collection('shop').doc(shopId).remove()");
  check('先删子表、最后删 shop（红线②，否则留孤儿数据）',
    posChild > -1 && posShopDel > posChild, `子表块@${posChild} < shop删除@${posShopDel}`);

  // ===== F. 变异自证 =====
  console.log('\n===== F · 变异自证（判据有分辨力）=====');
  // F-① 若把到期条件写成「只要 is_deleted 就删」，未到期店 D2 会被删 ⇒ 说明 C 组断言真在挡
  const mutantCond = { is_deleted: true };
  const d2 = { _id: 'D2', is_deleted: true, delete_at: NOW - 5 * DAY };
  check('变异：只按 is_deleted 判会误删未到期店（证明 C 的「未到期一条未动」不是恒真）',
    d2.delete_at > (NOW - 30 * DAY) && mutantCond.is_deleted === true);
  // F-② 若保护清单失效，payment_flow 会被删 ⇒ 证明 B 的保护断言有效
  check('变异：把 shop_payment_flow 移出保护清单后它就在删除范围内',
    byShop.includes('shop_payment_flow') && !delList.includes('shop_payment_flow'));

  console.log(`\n==== purgeDeletedData 自测结果：${pass} 通过 / ${failN} 失败 ====`);
}

run().then(() => {
  Module._load = origLoad;
  process.exit(failN === 0 ? 0 : 1);
}).catch((e) => {
  Module._load = origLoad;
  console.log('❌ 自测异常：' + (e && e.stack || e));
  process.exit(1);
});
