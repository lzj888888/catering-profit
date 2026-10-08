// review/evidence/r242_price/probe_fix_material.js
// 目的：把「鸡腿肉」档案的 convert_factor 从 10 修正为 20000（对齐同类「件」的鸡胸肉约定）。
// 依据：同为「件」的鸡胸肉 = 18000 分 / 20000 = 0.009 元/克（9 元/公斤，合理）；
//       鸡腿肉 = 16000 分 / 10 = 16 元/克（16000 元/公斤，量级错 2000 倍）。
//       改为 20000 ⇒ 16000/20000 = 0.008 元/克（8 元/公斤，与鸡胸肉同一量级）。
// 🔴 默认**只读**（打印计划）；加 --commit 才真写库。
// 运行：node probe_fix_material.js [--commit]
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const COMMIT = process.argv.indexOf('--commit') >= 0;
const TARGET_ID = 'mat_mu7606ti1psx';      // 鸡腿肉
const NEW_CONVERT = 20000;                  // 目标换算（= 同类「件」鸡胸肉）

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });

  // ---- ① 读：shop_id + 原料档案（2 个云调用，守 R238 定式）----
  const read = await mp.evaluate(async () => {
    const ctx = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
    const sid = (ctx && ctx.result && ctx.result.data && ctx.result.data.shop_id) || '';
    const res = await wx.cloud.callFunction({ name: 'getMaterial', data: { shop_id: sid } });
    const out = (res && res.result) || {};
    return { shop_id: sid, list: (out.data && out.data.list) || [] };
  });
  if (!read.shop_id) { console.error('FATAL 取不到 shop_id'); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, 'fix_material_before.json'), JSON.stringify(read, null, 2), 'utf8');

  const m = read.list.filter((x) => (x.material_id || x.id) === TARGET_ID)[0];
  if (!m) { console.error('FATAL 未找到原料 ' + TARGET_ID); process.exit(1); }

  console.log('=== 改前 ===');
  console.log('  shop_id      =', read.shop_id);
  console.log('  id           =', m.material_id || m.id);
  console.log('  name         =', m.name);
  console.log('  采购单位     =', m.purchase_unit, '| 采购价(分) =', m.purchase_price_fen);
  console.log('  换算         =', m.convert_factor, '→', NEW_CONVERT);
  console.log('  出成率       =', m.yield_rate);
  console.log('  净料成本(万) =', m.net_unit_cost, '→ 预期', Math.round((m.purchase_price_fen / NEW_CONVERT) * 100));
  console.log('  净料折合     =', (m.net_unit_cost / 10000).toFixed(6), '元/克 →',
    ((m.purchase_price_fen / NEW_CONVERT) * 100 / 10000).toFixed(6), '元/克');

  // ---- 构造 saveMaterial 入参（🔴 核实：getMaterial 出参与 saveMaterial 入参**同名** purchase_price_fen）----
  const material = {
    id: m.material_id || m.id,
    name: m.name,
    brand_spec: m.brand_spec || '',
    purchase_unit: m.purchase_unit || '斤',
    purchase_price_fen: m.purchase_price_fen,      // 🔴 同名（R242f 实测：不是 purchase_price）
    convert_factor: NEW_CONVERT,
    yield_rate: m.yield_rate,
    is_virtual: !!m.is_virtual,
    category: m.category || '',
    aliases: m.aliases || '[]',
    remark: m.remark || '',
    std_key: m.std_key || '',
  };

  if (!COMMIT) {
    console.log('\n(只读模式，未写库。加 --commit 执行)');
    console.log(JSON.stringify({ shop_id: read.shop_id, material }, null, 2));
    await mp.disconnect();
    process.exit(0);
  }

  // ---- ② 写：saveMaterial（1 个云调用）----
  const reqId = 'r242fix_mat_' + Date.now();
  const wr = await mp.evaluate(async (sid, mat, rid) => {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saveMaterial',
        data: { shop_id: sid, material: mat, client_request_id: rid },
      });
      return { ok: true, res: (res && res.result) || null };
    } catch (e) { return { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
  }, read.shop_id, material, reqId);
  console.log('\n=== 写入返回 ===');
  console.log(JSON.stringify(wr, null, 2));
  fs.writeFileSync(path.join(__dirname, 'fix_material_write.json'), JSON.stringify(wr, null, 2), 'utf8');

  // ---- ③ 回读（🔴 不以返回值为判据）----
  const after = await mp.evaluate(async (sid) => {
    const res = await wx.cloud.callFunction({ name: 'getMaterial', data: { shop_id: sid } });
    const out = (res && res.result) || {};
    return { list: (out.data && out.data.list) || [] };
  }, read.shop_id);
  fs.writeFileSync(path.join(__dirname, 'fix_material_after.json'), JSON.stringify(after, null, 2), 'utf8');

  const m2 = after.list.filter((x) => (x.material_id || x.id) === TARGET_ID)[0] || {};
  console.log('\n=== 回读云端（判据）===');
  console.log('  换算         =', m2.convert_factor, m2.convert_factor === NEW_CONVERT ? '✅' : '❌');
  console.log('  净料成本(万) =', m2.net_unit_cost, '(预期 80)',
    m2.net_unit_cost === 80 ? '✅' : '❌');
  console.log('  折合         =', ((m2.net_unit_cost || 0) / 10000).toFixed(6), '元/克');
  console.log('  采购价(分)   =', m2.purchase_price_fen, '(未动应为 16000)');

  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
