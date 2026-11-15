// _r745_probeF2_crossshop_write.js —— R745：真跑 saveMaterial.exports.main，实证「da.get 按业务主键直取 ⇒ 跨店改写」
// 手法：stub wx-server-sdk（内存假 db）+ 真 require 生产 index.js + 真调 exports.main（不是复制逻辑）
// 不改任何产品文件；只打印机器读数。
'use strict';
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '../..');

// ===== 假 db =====
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
          async count() { return { total: (this._m || []).length }; },
          async remove() { return { removed: (this._m || []).length }; },
          async update() { return {}; },
        };
      }
      return {
        where(cond) {
          const m = docs.filter(d => Object.keys(cond).every(k => cond[k] === undefined || d[k] === cond[k]));
          return chain(m);
        },
        doc(id) {
          return {
            async get() {
              const d = docs.find(x => String(x._id) === String(id));
              if (!d) throw new Error('document does not exist');
              return { data: Object.assign({}, d) };
            },
            async update(arg) {
              const d = docs.find(x => String(x._id) === String(id));
              if (d) Object.assign(d, arg.data);
              return { stats: { updated: d ? 1 : 0 } };
            },
            async remove() { return {}; },
            async set() { return {}; },
          };
        },
        async add(arg) {
          const d = Object.assign({ _id: 'gen_' + Math.random().toString(36).slice(2) }, arg.data);
          docs.push(d);
          return { _id: d._id };
        },
      };
    },
  };
}

let pass = 0, fail = 0;
function ck(name, cond, ev) {
  if (cond) { pass++; console.log('[PASS] ' + name + ' :: ' + ev); }
  else { fail++; console.log('[FAIL] ' + name + ' :: ' + ev); }
}

(async function main() {
  // ===== 场景：当前微信用户 user_A 拥有 shop_B（自己的店）；shop_A 是别人的店 =====
  const store = {
    user: [{ _id: 'u1', user_id: 'user_A', openid: 'openid_A', is_deleted: false }],
    shop: [
      { _id: 'docB', id: 'shop_B', shop_id: 'shop_B', user_id: 'user_A', name: 'B店', is_deleted: false },
      { _id: 'docA', id: 'shop_A', shop_id: 'shop_A', user_id: 'user_OTHER', name: 'A店', is_deleted: false },
    ],
    shop_material: [
      // 别人的店的原料，业务主键 mat_x（正常由 genId('mat_') 生成，此处模拟「已知/碰撞」）
      { _id: 'docMatA', id: 'mat_x', material_id: 'mat_x', shop_id: 'shop_A',
        name: 'A店花椒', purchase_price: 500, net_unit_cost: 500, is_deleted: false, is_virtual: false },
    ],
  };
  const db = fakeDb(store);

  // ===== stub wx-server-sdk（在 require 生产 index.js 之前装好）=====
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        init() {}, DYNAMIC_CURRENT_ENV: 'probe',
        database() { return db; },
        getWXContext() { return { OPENID: 'openid_A' }; },
      };
    }
    return origLoad.apply(this, arguments);
  };
  const idx = require(path.join(ROOT, 'cloudfunctions/saveMaterial/index.js'));
  const common = require(path.join(ROOT, 'cloudfunctions/saveMaterial/common.js'));
  Module._load = origLoad;

  // ===== 前置：确认越权拦截本体生效（传别店 shop_id 应被 assertShopOwner 拒）=====
  const probeNo = await idx.main({
    shop_id: 'shop_A',
    material: { id: 'mat_x', name: '不该成功', purchase_price_fen: 1, convert_factor: 1, yield_rate: 100 },
  });
  ck('F0 传别店 shop_id（不属于 user_A）⇒ assertShopOwner 拒（FORBIDDEN），越权拦截本体有效',
    probeNo.code === 'FORBIDDEN',
    'code=' + JSON.stringify(probeNo.code));

  // ===== 主实验：传【自己的】shop_B，但 material.id 指向别店的 mat_x =====
  const before = JSON.stringify(store.shop_material[0]);
  const res = await idx.main({
    shop_id: 'shop_B',                       // 自己的店 ⇒ assertShopOwner 放行
    client_request_id: '',                   // 空 ⇒ 不触发幂等登记（排除干扰）
    material: {
      id: 'mat_x',                           // ← 别店原料的业务主键
      name: '被B店跨店改了',
      purchase_price_fen: 999,
      convert_factor: 1,
      yield_rate: 100,
    },
  });
  const after = store.shop_material[0];
  ck('F1 编辑【自己的店】+ 别店 material_id ⇒ 接口回 SUCCESS',
    res.code === 'SUCCESS', 'code=' + JSON.stringify(res.code) + ' data=' + JSON.stringify(res.data));
  ck('F2 🔴 真缺口：别店(shop_A)的原料文档被跨店改写（name/进价都变了）',
    after.name === '被B店跨店改了' && after.purchase_price === 999 && after.shop_id === 'shop_A',
    'before=' + before + '\n         after =' + JSON.stringify(after));
  ck('F3 写入目标 _id 是别店文档的 _id（docMatA），不是本店任何行',
    String(res.data && res.data.id) === 'mat_x' && store.shop_material.length === 1,
    '返回 id=' + JSON.stringify(res.data && res.data.id) + ' / shop_material 行数=' + store.shop_material.length);

  // ===== 可达性诚实定级：正常新增分支的 id 由 genId 随机生成，不可猜 =====
  const g1 = common.genId('mat_'), g2 = common.genId('mat_');
  ck('F4 可达性：正常主键 genId 随机且互不相同 ⇒ 触发需「已知/猜到别店业务主键」或主键碰撞',
    g1 !== g2 && g1.indexOf('mat_') === 0 && g2.indexOf('mat_') === 0,
    'g1=' + g1 + ' / g2=' + g2);

  console.log('\n==== R745 F2 汇总: ' + pass + ' PASS / ' + fail + ' FAIL ====');
  if (fail) process.exit(1);
})().catch(e => { console.error('PROBE THREW:', e && e.stack || e); process.exit(2); });
