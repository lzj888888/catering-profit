// tools/check_card_unit_roundtrip.js —— 「手工行单价原单位」五层链路端到端守卫（R642）
//
// 为什么写它：这条链（提交 → 校验 → 快照 → 落库 → 出参投影 → 读回）我改了三轮
// 都自以为改完，结果每轮都要李老师真机帮我发现「还是克数」。
// 根因是**我一直用 grep 判「有没有这个字段」，从没真跑过一遍**。
// 本探针用**生产源码**跑完整链路，不猜：
//   ① page-stub 真跑 edit.js 的 onSave → 截获前端真正送出的 payload
//   ② 真 require saveCostCard/validate.js → 校验层是否放行
//   ③ 真 require getCostCard/service.js::lineToOutput → 出参投影是否吐出
//   ④ 把出参喂回 page-stub 的 load() → 页面最终显示什么
//
// 已登记为门禁套件（verify_all 第 254 个）：这条链我修了三轮都自以为改完，
// 每轮都要老板真机帮忙发现——**机器能验的，不该让人跑**。

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---------- 云端依赖桩（wx-server-sdk）----------
const stubbedLoad = function (req) {
  if (req === 'wx-server-sdk') {
    const mkDb = () => ({
      command: { inc: () => 1 },
      collection: () => ({
        doc: () => ({ update: async () => ({ stats: { updated: 1 } }), get: async () => ({ data: { count: 1 } }) }),
        add: async () => ({ _id: 'x' }),
        where: () => ({ get: async () => ({ data: [] }), update: async () => ({ stats: { updated: 0 } }) }),
      }),
    });
    return { init() {}, database: () => mkDb(), DYNAMIC_CURRENT_ENV: 'test' };
  }
  return Module.prototype.require.apply(this, arguments);
};

// ---------- ① page-stub 真跑 onSave ----------
function loadPage(captured) {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  const store = {};
  global.wx = {
    getStorageSync: (k) => store[k] || '',
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    showToast: (o) => { captured.__toast = (captured.__toast||[]).concat([o && o.title]); }, showModal: (o) => { captured.__toast = (captured.__toast||[]).concat(['MODAL:' + (o && o.content)]); }, showLoading: () => {}, hideLoading: () => {},
    navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, switchTab: () => {},
    vibrateShort: () => {}, getSystemInfoSync: () => ({ windowWidth: 375 }),
    setNavigationBarTitle: () => {}, pageScrollTo: () => {},
    cloud: {
      callFunction: async ({ name, data }) => {
        captured.push({ name, data });
        // 让 load() 能拿到一张"刚保存完的卡"：出参由 ③ 的结果注入
        if (name === 'getCostCard') return { result: { code: 'SUCCESS', data: captured.__card || { list: [] } } };
        if (name === 'getMaterial') return { result: { code: 'SUCCESS', data: { list: [] } } };
        return { result: { code: 'SUCCESS', data: {} } };
      },
      uploadFile: async () => ({ fileID: 'x' }),
    },
  };
  delete require.cache[require.resolve(path.join(ROOT, 'subpkg/biz/card/edit.js'))];
  require(path.join(ROOT, 'subpkg/biz/card/edit.js'));
  return cfg;
}

(async () => {
  console.log('\n===== ① 前端提交：onSave 到底送出了什么 =====');
  const captured = [];
  const cfg = loadPage(captured);
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p._liveTimer = null; p._liveBusy = false;

  // 造一份"老板填的东西"：临时手工录入，单价 8 元/公斤，出成率 100，用量 500 克
  p.setData({
    name: '酱爆鸭', calcMode: 'A', cardType: '1',
    yieldRate: '', lossRate: '', auxYuan: '', priceYuan: '38',
    lines: [{
      rid: 'r1', input_type: 2, material_id: '', material_name: '板鸭',
      qty: '500', qty_unit: '克', qtyUnitIdx: 0,
      price_unit: '公斤', priceUnitIdx: 1,
      unit_price_yuan: '8', yield_rate: '100', line_kind: 'main',
    }],
  });
  try { await p.doSave(); } catch (e) { console.log('  (onSave 抛错：' + e.message + ')'); }
  if (captured.__toast) console.log('  ⚠️ onSave 期间弹过：', JSON.stringify(captured.__toast));
  if (!captured.find((c) => c.name === 'saveCostCard')) console.log('  期间调用过的云函数：', JSON.stringify(captured.map((c) => c.name)));
  const saveCall = captured.find((c) => c.name === 'saveCostCard');
  const sentLine = saveCall && saveCall.data && saveCall.data.card && saveCall.data.card.lines && saveCall.data.card.lines[0];
  ok('①-a 前端真的调了 saveCostCard', !!saveCall);
  ok('①-b 送出的行带原单位 price_unit=公斤', !!sentLine && sentLine.price_unit === '公斤', sentLine ? 'price_unit=' + sentLine.price_unit : '无行');
  ok('①-c 送出的行带原单价（分）=800', !!sentLine && sentLine.manual_price_fen === 800, sentLine ? 'manual_price_fen=' + sentLine.manual_price_fen : '无');
  ok('①-d 送出的行带原出成率=100', !!sentLine && sentLine.manual_yield === 100, sentLine ? 'manual_yield=' + sentLine.manual_yield : '无');

  console.log('\n===== ② 云端校验：validate 是否放行这三个字段 =====');
  const V = require(path.join(ROOT, 'cloudfunctions/saveCostCard/validate.js'));
  const vRes = V.validateInput({
    shop_id: 'shop_test',
    card: { name: '酱爆鸭', mode: 'A', lines: [{
      input_type: 2, name: '板鸭', qty: 500, qty_unit: '克',
      net_unit_cost: 1600, line_kind: 'main',
      price_unit: '公斤', manual_price_fen: 800, manual_yield: 100,
    }] },
  });
  const vLine = (vRes && vRes.input && vRes.input.card && vRes.input.card.lines && vRes.input.card.lines[0]) || (vRes && vRes.card && vRes.card.lines && vRes.card.lines[0]);
  ok('②-a validate 通过', !vRes.error || vRes.error === undefined, vRes.error || 'OK');
  ok('②-b 校验后仍带 price_unit', !!vLine && vLine.price_unit === '公斤', vLine ? 'price_unit=' + vLine.price_unit : '无行');
  ok('②-c 校验后仍带 manual_price_fen=800', !!vLine && vLine.manual_price_fen === 800, vLine ? 'manual_price_fen=' + vLine.manual_price_fen : '无');

  console.log('\n===== ③ 出参投影：lineToOutput 会不会把它吐出去 =====');
  const G = require(path.join(ROOT, 'cloudfunctions/getCostCard/service.js'));
  const outLine = G.lineToOutput({
    material_id: '', material_name: '板鸭', quantity: 500, net_unit_cost: 1600,
    line_net_cost: 800, input_type: 2, line_kind: 'main',
    price_unit: '公斤', manual_price_fen: 800, manual_yield: 100,
  });
  ok('③-a 出参含 price_unit', outLine.price_unit === '公斤', 'price_unit=' + outLine.price_unit);
  ok('③-b 出参含 manual_price_fen=800', outLine.manual_price_fen === 800, 'manual_price_fen=' + outLine.manual_price_fen);
  ok('③-c 出参含 manual_yield=100', outLine.manual_yield === 100, 'manual_yield=' + outLine.manual_yield);

  console.log('\n===== ④ 前端读回：页面最终显示什么 =====');
  const cfg2 = loadPage(captured);
  const p2 = Object.assign({}, cfg2);
  p2.data = JSON.parse(JSON.stringify(cfg2.data));
  p2.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p2._liveTimer = null; p2._liveBusy = false;
  // 注入"云端刚返回的卡"：行就是 ③ 的产物
  captured.__card = {
    list: [{
      card_code: 'C1', name: '酱爆鸭', calc_mode: 'A', version: 1,
      total_cost_fen: 800, unit_cost_fen: 800, price_fen: 3800,
      lines: [outLine],
    }],
    truncated: false,
  };
  // 必须先进入**编辑态**（isEdit 由 onLoad 的 card_code 决定）—— 否则 load 走新建分支、不填 lines
  if (typeof p2.onLoad === 'function') { p2.onLoad({ card_code: 'C1' }); }
  try { await p2.load(); } catch (e) { console.log('  (load 抛错，可忽略：' + e.message + ')'); }
  const dl = (p2.data.lines || [])[0];
  ok('④-a 页面读到了这一行', !!dl, dl ? 'material_name=' + dl.material_name : '无行');
  ok('④-b 🔴 单价单位显示为「公斤」（不是克）', !!dl && dl.price_unit === '公斤', dl ? 'price_unit=' + dl.price_unit : '无');
  ok('④-c 🔴 单价数字显示为 8.00（不是 0.0016）', !!dl && dl.unit_price_yuan === '8.00', dl ? 'unit_price_yuan=' + dl.unit_price_yuan : '无');
  ok('④-d 出成率回填 100', !!dl && dl.yield_rate === '100', dl ? 'yield_rate=' + dl.yield_rate : '无');

  // ============ U 切单价单位：数值必须跟着换算（R650）============
  // 李老师两次提到「把克改成千克，前面那数不跟着变」。
  // 改前是"故意不换算"——后果是 6 元/斤 切到克还显示 6 ⇒ 6 元/克 = 3000 元/斤，
  // 成本凭空放大 500 倍且零提示。这个错会直接算错菜价。
  console.log('\n===== U 切单位数值联动 =====');
  const U = require(path.join(ROOT, 'utils/units.js'));
  const IDX_JIN = U.QTY_UNITS.indexOf('斤');
  const IDX_KE = U.QTY_UNITS.indexOf('克');
  const IDX_KG = U.QTY_UNITS.indexOf('公斤');

  function pageWith(price, unit) {
    const captured2 = [];
    const cfgU = loadPage(captured2);
    const pU = Object.assign({}, cfgU);
    pU.data = JSON.parse(JSON.stringify(cfgU.data));
    pU.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
    pU.data.lines = [{ rid: 'u1', input_type: 2, material_id: '', material_name: '板鸭',
      qty: '500', qty_unit: '克', price_unit: unit, unit_price_yuan: String(price), yield_rate: '100', line_kind: 'main' }];
    pU.data.priceUnits = U.QTY_UNITS.slice();
    return pU;
  }

  // U-① 6 元/斤 → 切到克 ⇒ 0.012（不是 6）
  const u1 = pageWith(6, '斤');
  u1.onManualPriceUnit({ currentTarget: { dataset: { idx: 0 } }, detail: { value: String(IDX_KE) } });
  ok('U-① 6 元/斤 切到「克」⇒ 数值变 0.012（不是原样 6）',
    u1.data.lines[0].unit_price_yuan === '0.012' && u1.data.lines[0].price_unit === '克',
    u1.data.lines[0].unit_price_yuan + ' 元/' + u1.data.lines[0].price_unit);

  // U-② 可逆：0.012 元/克 → 切回斤 ⇒ 6
  const u2 = pageWith(0.012, '克');
  u2.onManualPriceUnit({ currentTarget: { dataset: { idx: 0 } }, detail: { value: String(IDX_JIN) } });
  ok('U-② 可逆：0.012 元/克 切回「斤」⇒ 回到 6（换算无损）',
    Number(u2.data.lines[0].unit_price_yuan) === 6, u2.data.lines[0].unit_price_yuan + ' 元/斤');

  // U-③ 3 元/公斤 → 克 ⇒ 0.003
  const u3 = pageWith(3, '公斤');
  u3.onManualPriceUnit({ currentTarget: { dataset: { idx: 0 } }, detail: { value: String(IDX_KE) } });
  ok('U-③ 3 元/公斤 切到「克」⇒ 0.003（不是 3）',
    u3.data.lines[0].unit_price_yuan === '0.003', u3.data.lines[0].unit_price_yuan);

  // U-④ 空值不换算、不报错（老板还没填数就改单位，很常见）
  const u4 = pageWith('', '斤');
  let threw = false;
  try { u4.onManualPriceUnit({ currentTarget: { dataset: { idx: 0 } }, detail: { value: String(IDX_KE) } }); } catch (e) { threw = true; }
  ok('U-④ 单价为空时切单位 ⇒ 不报错、只改单位', !threw && u4.data.lines[0].price_unit === '克' && u4.data.lines[0].unit_price_yuan === '',
    'unit=' + u4.data.lines[0].price_unit + ' val=' + JSON.stringify(u4.data.lines[0].unit_price_yuan));

  // U-⑤ 选了同一个单位 ⇒ 数值不动（不能把 6 变成 6.00000001）
  const u5 = pageWith(6, '斤');
  u5.onManualPriceUnit({ currentTarget: { dataset: { idx: 0 } }, detail: { value: String(IDX_JIN) } });
  ok('U-⑤ 选同一个单位 ⇒ 数值原样不动', u5.data.lines[0].unit_price_yuan === '6', u5.data.lines[0].unit_price_yuan);

  // U-⑥ 换算要走单源 factorOf，不许页面自己写 500/1000
  const EDIT_U = require('fs').readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
  ok('U-⑥ 换算系数走单源 units.factorOf（页面不许硬编码 500/1000）',
    /units\.factorOf\(next\)/.test(EDIT_U) && /units\.factorOf\(cur\)/.test(EDIT_U)
    && !/num \* \(500 \/ 1000\)/.test(EDIT_U));

  // U-⑦ 换算后要告诉老板（否则他以为"我填的数被改了"）
  ok('U-⑦ 换算后给出提示文案（走 terms 单源）',
    /TERMS\.card\.priceUnitConv/.test(EDIT_U) && !!require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.card.priceUnitConv);

  console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})();
