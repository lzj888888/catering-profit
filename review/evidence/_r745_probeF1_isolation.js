// _r745_probeF1_isolation.js —— R745 M3 跨店/跨月隔离独立审计探针（只读、真跑、可复现）
// 手法：内存假 db 注入真生产模块（dataAdapter / auth / idempotency / getDishReview.service / shopSwitcher）
// 纪律：不改任何产品文件；只打印机器读数，结论由审计员据此判定。
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

const { makeAdapter } = require(path.join(ROOT, 'cloudfunctions/common/dataAdapter.js'));
const auth = require(path.join(ROOT, 'cloudfunctions/common/auth.js'));
const idem = require(path.join(ROOT, 'cloudfunctions/common/idempotency.js'));
const svc = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));
const ss = require(path.join(ROOT, 'utils/shopSwitcher.js'));

let pass = 0, fail = 0;
function ck(name, cond, evidence) {
  if (cond) { pass++; console.log('[PASS] ' + name + ' :: ' + evidence); }
  else { fail++; console.log('[FAIL] ' + name + ' :: ' + evidence); }
}

// ===== 内存假 db：仅实现 dataAdapter / assertShopOwner 用到的链式 API =====
function fakeDb(store) {
  return {
    collection(coll) {
      const docs = store[coll] || (store[coll] = []);
      function chain(matched) {
        return {
          _m: matched, _s: 0, _n: null,
          limit(n) { this._n = n; return this; },
          skip(s) { this._s = s || 0; return this; },
          async get() { return { data: (this._m || []).slice(this._s, this._n == null ? undefined : this._s + this._n) }; },
          count: async () => ({ total: (this._m || []).length }),
          remove: async () => ({ removed: (this._m || []).length }),
          update: async () => ({}),
        };
      }
      return {
        where(cond) {
          const m = docs.filter(d => Object.keys(cond).every(k => cond[k] === undefined || d[k] === cond[k]));
          return chain(m);
        },
        doc(id) {
          return {
            get: async () => {
              const d = docs.find(x => String(x._id) === String(id));
              if (!d) throw new Error('document does not exist');
              return { data: Object.assign({}, d) };
            },
            update: async (arg) => {
              const d = docs.find(x => String(x._id) === String(id));
              if (d) Object.assign(d, arg.data);
              return { stats: { updated: d ? 1 : 0 } };
            },
            remove: async () => ({}),
            set: async () => ({}),
          };
        },
        add: async (arg) => {
          const d = Object.assign({ _id: 'gen_' + Math.random().toString(36).slice(2) }, arg.data);
          docs.push(d);
          return { _id: d._id };
        },
      };
    },
  };
}

(async function main() {
  // ---------- T1: da.list 强制注入 is_deleted=false，且不接受 where/extra 覆盖 ----------
  {
    const store = { shop_cost_card: [
      { _id: 'd1', shop_id: 'shop_A', name: '活卡1', is_deleted: false },
      { _id: 'd2', shop_id: 'shop_A', name: '活卡2', is_deleted: false },
      { _id: 'd3', shop_id: 'shop_A', name: '软删卡', is_deleted: true },
    ] };
    const da = makeAdapter(fakeDb(store));
    const r = await da.list('shop_cost_card', { shop_id: 'shop_A', is_deleted: true });
    ck('T1 da.list 软删铁律（where 里塞 is_deleted:true 也不能覆盖）',
      r.data.length === 2 && r.data.every(x => !x.is_deleted),
      '返回 ' + r.data.length + ' 行（3 行里含 1 软删 ⇒ 应为 2）');
  }

  // ---------- T2: da.list 带 shop_id 过滤真的生效（跨店读不到） ----------
  {
    const store = { shop_cost_card: [
      { _id: 'd1', shop_id: 'shop_A', name: 'A店卡', is_deleted: false },
      { _id: 'd2', shop_id: 'shop_B', name: 'B店卡', is_deleted: false },
    ] };
    const da = makeAdapter(fakeDb(store));
    const r = await da.list('shop_cost_card', { shop_id: 'shop_A' });
    ck('T2 da.list({shop_id}) 按店隔离', r.data.length === 1 && r.data[0].shop_id === 'shop_A',
      '返回 ' + JSON.stringify(r.data.map(x => x.shop_id)));
  }

  // ---------- T3: da.get(coll, 业务主键) 兜底 where 不带 shop_id ⇒ 跨店命中（R743 同型） ----------
  {
    const store = { shop_material: [
      { _id: 'docA', id: 'mat_x', material_id: 'mat_x', shop_id: 'shop_A', name: 'A店花椒', is_deleted: false },
      { _id: 'docB', id: 'mat_x', material_id: 'mat_x', shop_id: 'shop_B', name: 'B店花椒', is_deleted: false },
    ] };
    const da = makeAdapter(fakeDb(store));
    // 模拟「当前请求是 B 店」：da.get 签名只有 (coll,id)，调用方根本无法传 shop_id
    const got = await da.get('shop_material', 'mat_x');
    ck('T3 da.get 按业务主键直取【不带 shop_id】⇒ 返回别店文档',
      !!got && got.name === 'A店花椒' && got.shop_id === 'shop_A',
      'B 店请求读到 ' + JSON.stringify(got && { name: got.name, shop_id: got.shop_id }) +
      '（主键碰撞时命中先入库的 A 店行；签名无 shop_id 参数，结构上无法隔离）');
  }

  // ---------- T4: da.get 软删行视为不存在 ----------
  {
    const store = { shop_amortize: [
      { _id: 'docA', asset_id: 'a1', id: 'a1', shop_id: 'shop_A', is_deleted: true },
    ] };
    const da = makeAdapter(fakeDb(store));
    const got = await da.get('shop_amortize', 'a1');
    ck('T4 da.get 软删视为不存在', got === null, '返回 ' + JSON.stringify(got));
  }

  // ---------- T5: getDishReview.service.filterByRange 空区间 fail-open（跨月累计） ----------
  {
    const sales = [
      { biz_date: '2026-10-05', dish_key: 'A', amountFen: 1000, qty: 1 },
      { biz_date: '2026-11-05', dish_key: 'A', amountFen: 2000, qty: 2 },
      { biz_date: '2026-12-05', dish_key: 'A', amountFen: 3000, qty: 3 },
    ];
    const open = svc.filterByRange(sales, '', '');
    const oneSide = svc.filterByRange(sales, '2026-11-01', '');
    const closed = svc.filterByRange(sales, '2026-11-01', '2026-11-30');
    ck('T5 filterByRange 两端都空 ⇒ 不过滤（返回全部 3 个月）',
      open.rows.length === 3 && open.from === '' && open.to === '',
      'rows=' + open.rows.length + ' from=' + JSON.stringify(open.from) + ' to=' + JSON.stringify(open.to));
    ck('T5b filterByRange 只给一端 ⇒ 仍不过滤（fail-open）',
      oneSide.rows.length === 3 && oneSide.from === '',
      'rows=' + oneSide.rows.length + ' from=' + JSON.stringify(oneSide.from));
    ck('T5c filterByRange 两端齐全 ⇒ 只按该月过滤',
      closed.rows.length === 1 && closed.rows[0].biz_date === '2026-11-05',
      'rows=' + closed.rows.length + ' from=' + closed.from + ' to=' + closed.to);
  }

  // ---------- T6: 前端 shopKey 单源按店分格 + 无店态 fail-closed ----------
  {
    const saved = global.getApp;
    global.getApp = () => ({ globalData: { shop_id: 'shop_A' } });
    const kA = ss.shopKey('m3_dish_cats');
    global.getApp = () => ({ globalData: { shop_id: 'shop_B' } });
    const kB = ss.shopKey('m3_dish_cats');
    global.getApp = () => ({ globalData: { shop_id: '' } });
    const kNo = ss.shopKey('m3_dish_cats');
    ck('T6 shopKey 按店分格（A≠B）且无店态落 __NO_SHOP__ 独立格',
      kA !== kB && kNo.endsWith('__NO_SHOP__') && kNo !== kA && kNo !== kB,
      'A=' + kA + ' / B=' + kB + ' / no=' + kNo);
    global.getApp = saved;
  }

  // ---------- T7: assertShopOwner 越权拦截真实生效（R194 修复后 owner.error 非空） ----------
  {
    const store = { shop: [
      { _id: 'docB', id: 'shop_B', shop_id: 'shop_B', user_id: 'user_B', is_deleted: false },
    ] };
    const owner = await auth.assertShopOwner(fakeDb(store), 'shop_B', 'user_A');
    ck('T7 assertShopOwner 别店 ⇒ FORBIDDEN 且 owner.error 非空（调用点 if(owner.error) 会拦）',
      !!owner.error && owner.error === 'FORBIDDEN',
      'owner=' + JSON.stringify(owner));
    const okOwner = await auth.assertShopOwner(fakeDb(store), 'shop_B', 'user_B');
    ck('T7b assertShopOwner 本店 ⇒ error:null 放行', okOwner.error === null && !!okOwner.data,
      'owner=' + JSON.stringify({ error: okOwner.error, shop: okOwner.data && okOwner.data.shop_id }));
  }

  // ---------- T8: 幂等键 shopKey 跨店不串 ----------
  {
    const a = idem.shopKey('shop_A', 'req_1');
    const b = idem.shopKey('shop_B', 'req_1');
    const empty = idem.shopKey('shop_A', '');
    ck('T8 幂等键含 shop_id（同 crid 不同店不串）且空 crid 返回空串',
      a === 'shop_A__req_1' && b === 'shop_B__req_1' && a !== b && empty === '',
      'A=' + a + ' / B=' + b + ' / empty=' + JSON.stringify(empty));
  }

  console.log('\n==== R745 F1 汇总: ' + pass + ' PASS / ' + fail + ' FAIL ====');
  if (fail) process.exit(1);
})().catch(e => { console.error('PROBE THREW:', e && e.stack || e); process.exit(2); });
