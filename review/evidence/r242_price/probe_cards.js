// review/evidence/r242_price/probe_cards.js
// R242c —— 模块②「填挂牌价」：读三张菜品卡 → 生产引擎算建议价 → 另存新版本（只 INSERT 的版本模型）。
//
// 纪律：
//   · 挂牌价由**生产引擎**算（cloudfunctions/calcBom/service.js::calcReversePrice），不手写公式
//   · 🔴 版本模型只 INSERT ⇒ 载荷必须**逐字段保真回传**，否则新版本丢数据：
//        calc_mode→mode · loss_rate→loss_pct · aux_fen · specs · batch_output · price_promo_fen→activity_price_fen
//   · 手工行（input_type=2）传 net_unit_cost 快照（validate：与 unit_price_fen+yield_rate 二选一，不两传）
//   · 套餐行（line_type=2）必须传 sub_card_ref
//   · 默认只读；写必须显式 --commit
//   · 🔴 不调 wx.reLaunch（实测会让随后 evaluate 超时）
//
// 运行：
//   node probe_cards.js            # 只读：打印三张卡 + 建议价，并落 cards_raw.json
//   node probe_cards.js --commit   # 按 60% 毛利写新版本

const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const S = require(path.join(ROOT, 'cloudfunctions', 'calcBom', 'service.js'));
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const COMMIT = process.argv.indexOf('--commit') >= 0;
const ONLY = (process.argv.find((a) => a.indexOf('--only=') === 0) || '').split('=')[1] || '';
const MARGIN = 60;
const HERE = __dirname;

function suggest(card) {
  return S.calcReversePrice(card.total_cost_fen, MARGIN);
}

// 明细行：doc → saveCostCard 入参（逐字段保真）
function buildLine(ln) {
  const base = {
    quantity: ln.quantity,
    line_kind: ln.line_kind || 'main',
    group_name: ln.group_name || '',
  };
  // 套餐子卡行
  if (Number(ln.line_type) === 2) {
    return Object.assign(base, { input_type: 1, sub_card_ref: ln.sub_card_ref || '' });
  }
  if (Number(ln.input_type) === 2) {
    // 手工行：快照直落
    return Object.assign(base, {
      input_type: 2,
      name: ln.material_name || '未命名',
      net_unit_cost: ln.net_unit_cost,
    });
  }
  return Object.assign(base, { input_type: 1, material_id: ln.material_id });
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS, '| 目标毛利', MARGIN + '%', '| 模式', COMMIT ? '★写入' : '只读');

  // ---- 1 只读：取三张卡 ----
  const read = await mp.evaluate(async () => {
    const r = { errors: [] };
    const ctx = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
    const sid = (ctx && ctx.result && ctx.result.data && ctx.result.data.shop_id) || '';
    r.shop_id = sid;
    const res = await wx.cloud.callFunction({ name: 'getCostCard', data: { shop_id: sid } });
    r.list = (res && res.result && res.result.data && res.result.data.list) || [];
    return r;
  });
  if (read.errors && read.errors.length) console.log('读错误', read.errors);
  const cards = read.list || [];
  fs.writeFileSync(path.join(HERE, 'cards_raw.json'), JSON.stringify(read, null, 2), 'utf8');

  console.log('\n=== 现状（' + cards.length + ' 张）· shop_id=' + read.shop_id + ' ===');
  cards.forEach((c) => {
    const kinds = (c.lines || []).map((l) => 'type' + (l.line_type || 1) + '/in' + (l.input_type || 1)).join(',');
    console.log('  ' + c.card_code + '  v' + c.version + '  ' + c.name
      + '  card_type=' + c.card_type + ' mode=' + c.calc_mode + ' batch=' + c.batch_output
      + ' specs=' + JSON.stringify(c.specs || [])
      + '\n      成本=' + (c.total_cost_fen / 100).toFixed(2) + '元  现挂牌价=' + (c.price_fen / 100).toFixed(2)
      + '元  现毛利=' + c.gross_margin_pct + '%  建议(' + MARGIN + '%)=' + (suggest(c) / 100).toFixed(2) + '元'
      + '  行=' + (c.lines || []).length + '[' + kinds + ']');
  });

  // ---- 2 组装载荷（逐字段保真）----
  const STAMP = Date.now();
  const targets = ONLY ? cards.filter((c) => c.card_code === ONLY) : cards;
  if (ONLY) console.log('  [--only=' + ONLY + '] 仅处理命中卡：' + targets.length + ' 张');
  const payloads = targets.map((c) => ({
    shop_id: read.shop_id,
    client_request_id: 'r242-price-' + c.card_code + '-' + STAMP,   // 幂等键 + 审计留痕
    card: {
      card_code: c.card_code,
      name: c.name,
      card_type: c.card_type || 1,
      mode: c.calc_mode || 'A',                                  // ★ 保真
      category: c.category || '',
      tags: c.tags || '',
      specs: c.specs || [],                                      // ★ 保真（不硬写 []）
      aux_fen: c.aux_fen || 0,
      loss_pct: c.loss_rate || 0,                                // ★ 字段名换算
      batch_output: c.batch_output || 0,                         // ★ 保真
      price_fen: c.card_type === 3 ? (c.price_fen || 0) : suggest(c),  // ★ 挂牌价 = 生产引擎反算
      target_margin_pct: c.card_type === 3 ? 0 : MARGIN,
      activity_price_fen: c.price_promo_fen || 0,
      lines: (c.lines || []).map(buildLine),
    },
  }));

  console.log('\n=== 将写入（每张卡各 +1 个新版本，不 UPDATE）===');
  payloads.forEach((p) => {
    console.log('  ' + p.card.card_code + '  ' + p.card.name
      + '  card_type=' + p.card.card_type + ' mode=' + p.card.mode
      + '  挂牌价 ' + (p.card.price_fen / 100).toFixed(2) + '元  目标毛利 ' + p.card.target_margin_pct + '%'
      + '  行 ' + p.card.lines.length + '  载荷=' + JSON.stringify(p.card).length + 'B');
  });

  if (!COMMIT) { console.log('\n(只读模式，未写入；加 --commit 才写)'); await mp.disconnect(); process.exit(0); }

  // ---- 3 写入：一卡一次 evaluate（每次 1 个云函数调用）----
  console.log('\n=== 写入 ===');
  const results = [];
  for (const p of payloads) {
    const res = await mp.evaluate(async (pload) => {
      try {
        const r = await wx.cloud.callFunction({ name: 'saveCostCard', data: pload });
        return (r && r.result) || null;
      } catch (e) { return { err: (e && (e.errMsg || e.message)) || String(e) }; }
    }, p);
    results.push({ card_code: p.card.card_code, res });
    const r = (res && res.data) || res || {};   // ok() 把结果包在 data 里
    console.log('  ' + p.card.card_code + ' → code=' + ((res && res.code) || '?') + ' ver=' + r.version
      + ' 成本=' + r.total_cost_fen + ' 毛利=' + r.gross_margin_pct + ' 反算价=' + r.reverse_price_fen
      + (res && res.err ? '  ERR=' + res.err : '') + ((res && res.msg) ? '  MSG=' + res.msg : ''));
  }
  fs.writeFileSync(path.join(HERE, 'write_results.json'), JSON.stringify(results, null, 2), 'utf8');

  // ---- 4 复验：重新读一遍（独立于返回值，以库为准）----
  const after = await mp.evaluate(async (sid) => {
    const res = await wx.cloud.callFunction({ name: 'getCostCard', data: { shop_id: sid } });
    const list = (res && res.result && res.result.data && res.result.data.list) || [];
    return list.map((c) => ({
      card_code: c.card_code, version: c.version, name: c.name,
      price_fen: c.price_fen, total_cost_fen: c.total_cost_fen, gross_margin_pct: c.gross_margin_pct,
      card_type: c.card_type, mode: c.calc_mode, lines: (c.lines || []).length,
    }));
  }, read.shop_id);
  fs.writeFileSync(path.join(HERE, 'after_reread.json'), JSON.stringify(after, null, 2), 'utf8');
  console.log('\n=== 复验（重读云端，以库为准）===');
  (after || []).forEach((c) => {
    console.log('  ' + c.card_code + '  v' + c.version + '  ' + c.name
      + '  card_type=' + c.card_type + ' mode=' + c.mode + '  行=' + c.lines
      + '  成本=' + (c.total_cost_fen / 100).toFixed(2) + '元'
      + '  挂牌价=' + (c.price_fen / 100).toFixed(2) + '元  毛利=' + c.gross_margin_pct + '%');
  });

  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
