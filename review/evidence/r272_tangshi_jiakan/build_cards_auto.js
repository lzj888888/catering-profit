/**
 * R272 一键建卡（全 20 道 = 免费档卡上限）—— 走微信开发者工具 automator 通道，在小程序真实上下文调云函数
 *
 * 前置条件：
 *   1. 微信开发者工具已打开项目 C:\Users\lzj\WorkBuddy\Claw\catering-profit
 *   2. 自动化端口已开：cli.bat auto --project <path> --auto-port 9420
 *      （若 IDE 弹 Windows 防火墙警报，需先点「允许访问」）
 *
 * 用法：
 *   cd C:/Users/lzj/.workbuddy/binaries/node/mpauto
 *   node <本脚本路径>
 *
 * 说明：
 *   · 成本数据来自豆包联网查证配方，已用生产引擎 calcCostCard 复算校验（7/7 对上）
 *   · 净料单位成本（万分/克）= 单价元每斤 × 2000 ÷ 出成率%
 *   · 售价值 = 实际成交均价（销售额 ÷ 份数），非菜单定价
 *   · 全部走 input_type=2 手工行（无需先录原料档案）
 */
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420';
const PAYLOAD = process.env.MP_PAYLOAD || path.join(__dirname, 'card_payload_20.json');
const DRY_RUN = process.argv.includes('--dry-run');

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const cards = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'));

async function callFn(mp, name, data) {
  return await mp.evaluate((fnName, fnData) => {
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: fnName,
        data: fnData,
        success: (r) => resolve({ ok: true, result: r.result }),
        fail: (e) => resolve({ ok: false, err: e && (e.errMsg || e.message || String(e)) }),
      });
    });
  }, name, data);
}

(async () => {
  log('connecting', WS, '...');
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS });
    log('CONNECTED');
  } catch (e) {
    log('CONNECT_FAIL:', (e && e.message) || String(e));
    log('提示：确认 IDE 已开项目且自动化端口已开，防火墙弹窗需点「允许访问」');
    process.exit(3);
  }

  // 1) 拿 shop_id
  log('getShopList ...');
  let shopId = null;
  const r0 = await callFn(mp, 'getShopList', {});
  if (r0.ok && r0.result) {
    const data = r0.result.data || r0.result;
    const list = Array.isArray(data) ? data : (data.list || []);
    if (list.length) shopId = list[0].shop_id || list[0].id || list[0]._id;
    log('SHOP_ID:', shopId, '(共', list.length, '家店)');
  } else {
    log('GET_SHOP_FAIL:', JSON.stringify(r0).slice(0, 300));
  }
  if (!shopId) {
    log('ABORT: 拿不到 shop_id');
    await mp.disconnect().catch(() => {});
    process.exit(4);
  }

  if (DRY_RUN) {
    log('DRY_RUN：只校验 shop_id，不建卡');
    await mp.disconnect().catch(() => {});
    process.exit(0);
  }

  // 2) 逐张建卡
  let okCount = 0;
  const report = [];
  for (const c of cards) {
    const crid = 'r272_' + c.name.replace(/[（）()\/]/g, '') + '_' + Date.now();
    const payload = {
      shop_id: shopId,
      client_request_id: crid,
      card: {
        name: c.name,
        card_code: '',
        category: '',
        tags: '',
        card_type: 1,
        mode: 'A',
        lines: c.lines,
        aux_fen: c.aux_fen,
        loss_pct: 0,
        price_fen: c.price_fen,
        target_margin_pct: 0,
        specs: [],
      },
    };
    const r = await callFn(mp, 'saveCostCard', payload);
    const res = r.result || {};
    const okFlag = r.ok && res && res.ok !== false && !res.code && !res.error;
    if (okFlag) okCount++;
    report.push({
      name: c.name,
      ok: !!okFlag,
      card_code: res.card_code || (res.data && res.data.card_code) || '',
      cost_fen: res.total_cost_fen || (res.data && res.data.total_cost_fen) || 0,
      margin_pct: res.gross_margin_pct || (res.data && res.data.gross_margin_pct) || 0,
      err: res.code || res.error || res.msg || (r.err || ''),
    });
    log(`${okFlag ? 'OK  ' : 'FAIL'} ${c.name} ` +
        `cost=${((res.total_cost_fen || 0) / 100).toFixed(2)}元 ` +
        `margin=${res.gross_margin_pct || 0}% ${okFlag ? '' : 'ERR=' + (res.code || res.msg || r.err || '')}`);
  }

  const outFile = path.join(__dirname, 'build_result.json');
  fs.writeFileSync(outFile, JSON.stringify({ shop_id: shopId, ok: okCount, total: cards.length, report }, null, 2), 'utf8');
  log('DONE:', okCount, '/', cards.length, ' →', outFile);

  await mp.disconnect().catch(() => {});
  process.exit(okCount === cards.length ? 0 : 1);
})().catch(e => {
  log('FATAL:', (e && e.message) || String(e));
  process.exit(9);
});
