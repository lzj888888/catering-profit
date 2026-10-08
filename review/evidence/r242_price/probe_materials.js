// review/evidence/r242_price/probe_materials.js —— 只读：取原料档案（查「鸡腿肉 16 元/克」根因）
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const r = await mp.evaluate(async () => {
    const ctx = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
    const sid = (ctx && ctx.result && ctx.result.data && ctx.result.data.shop_id) || '';
    const res = await wx.cloud.callFunction({ name: 'getMaterial', data: { shop_id: sid } });
    const out = (res && res.result) || {};
    return { shop_id: sid, list: (out.data && out.data.list) || [], keys: Object.keys(out) };
  });
  fs.writeFileSync(path.join(__dirname, 'materials_raw.json'), JSON.stringify(r, null, 2), 'utf8');
  console.log('shop_id =', r.shop_id, '| 原料数 =', r.list.length);
  r.list.forEach((m) => {
    console.log('  ' + (m.material_id || m.id) + '  ' + m.name
      + '  品牌/规格=' + JSON.stringify(m.brand_spec)
      + '  采购单位=' + JSON.stringify(m.purchase_unit)
      + '  采购价(分)=' + m.purchase_price
      + '  换算=' + m.convert_factor
      + '  出成率=' + m.yield_rate
      + '  净料单位成本(万分)=' + m.net_unit_cost);
  });
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
