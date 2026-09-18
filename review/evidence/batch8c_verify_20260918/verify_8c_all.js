// 8c 核验 · 单连接跑完 H2(录入页引导) + H1(摊销页多次采购)
// 背景：本机 IDE 自动化通道在多次 connect 后会累积僵尸会话、越来越卡
//      ⇒ 一次连接内顺序做完，每步独立 try/catch，结果无论如何都落盘
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');
const OUT = process.argv[2];
const WS = 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const R = { checks: [], texts: {}, shots: [], errors: [] };
function check(name, ok, note) {
  R.checks.push([name, !!ok, note || '']);
  log(`${ok ? '✅' : '❌'} ${name}${note ? '  (' + note + ')' : ''}`);
}

async function texts(page) {
  const set = new Set();
  let nodes = [];
  try { nodes = await page.$$('view, text, button, input, picker'); } catch (e) { log('  $$ failed', e.message); }
  for (const n of nodes || []) {
    try { const t = await n.text(); if (typeof t === 'string' && t.trim()) set.add(t.trim()); } catch (e) {}
  }
  return Array.from(set);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ONLY = (process.argv[3] || '').replace('--only=', '');
  log('mode =', ONLY || 'all');
  const mp = await automator.connect({ wsEndpoint: WS });
  const shot = async (name) => {
    try { await mp.screenshot({ path: path.join(OUT, name) }); R.shots.push(name); log('  shot', name); }
    catch (e) { log('  shot FAIL', name, e.message); R.errors.push(`shot ${name}: ${e.message}`); }
  };

  // ================= H2 录入页 =================
  if (!ONLY || ONLY === 'h2') try {
    log('== H2 录入页 ==');
    await mp.reLaunch('/pages/month/input');
    await sleep(3200);
    const page = await mp.currentPage();
    check('录入页可达', page && /month\/input/.test(page.path || ''), page && page.path);
    await shot('h2_input_top.png');
    const tx = await texts(page);
    R.texts.input = tx;
    const all = tx.join('\n');
    check('引导·「填写口径」标题渲染', /填写口径/.test(all));
    check('引导·收入总口径', /收入按当月实际到账金额填写/.test(all));
    check('引导·费用总口径', /费用只填本月实际支出/.test(all));
    check('引导·堂食口径（含/不含）', /不包括会员充值预收/.test(all));
    check('引导·外卖口径（佣金记营销）', /平台佣金与配送费不要在这里扣/.test(all));
    check('引导·运营口径（设备装修走摊销）', /不包括设备与装修购置/.test(all));
    check('引导·其他口径（加盟费走摊销资产）', /加盟费\/品牌使用费金额大请走「摊销资产」/.test(all));
    check('费用含「营销」大类', /营销/.test(all));
    check('折叠体默认不渲染（收起）', !/同一笔钱只填一次/.test(all));

    // 点开折叠块
    let tapped = null;
    try {
      const heads = await page.$$('.fill-guide-head');
      if (heads && heads.length) { await heads[0].tap(); tapped = `heads=${heads.length}`; }
    } catch (e) { log('  tap fail', e.message); R.errors.push('tap guide: ' + e.message); }
    log('  tap', tapped);
    await sleep(1800);
    await shot('h2_input_guide_open.png');
    const tx2 = await texts(page);
    R.texts.inputOpen = tx2;
    const all2 = tx2.join('\n');
    check('点开后折叠体渲染（同一笔钱只填一次）', /同一笔钱只填一次/.test(all2), tapped || '');
    check('展开后可见「食材采购不计入费用」', /食材采购不计入费用/.test(all2));
    check('展开后可见「设备、装修、加盟费等一次性投入」', /设备、装修、加盟费等一次性投入/.test(all2));
  } catch (e) {
    log('H2 中断', e.message); R.errors.push('H2: ' + e.message);
    check('H2 录入页核验完成', false, e.message);
  }

  // ================= H1 摊销页 =================
  if (!ONLY || ONLY === 'h1') try {
    log('== H1 摊销页 ==');
    await mp.reLaunch('/pages/month/amortize');
    await sleep(3200);
    const page = await mp.currentPage();
    check('摊销页可达', page && /month\/amortize/.test(page.path || ''), page && page.path);
    await shot('h1_amortize_real.png');
    const tx = await texts(page);
    R.texts.amortize = tx;
    const all = tx.join('\n');
    check('摊销页含「追加采购」入口', /追加采购/.test(all));
    const hasScope = /每笔从各自的采购月起单独摊销|每笔.*独立起摊|从各自的采购月/.test(all);
    check('摊销页含「每笔独立起摊」口径说明', hasScope);

    // 注入两笔采购的组，核验分组渲染路径
    try {
      await page.setData({
        groups: [{
          key: 'amort_x', name: '装修', count: 2, valueFen: 38000000, monthFen: 11668,
          valueYuan: '380000.00', monthYuan: '116.68', multi: true, expanded: true,
          batches: [
            { asset_id: 'a1', name: '装修', value: '300000.00', value_fen: 30000000, start_month: '2026-01', total_months: 36, terminate_month: '', group_id: '', batch_seq: 1, amount_fen: 8334, amountYuan: '83.34' },
            { asset_id: 'a2', name: '装修', value: '80000.00', value_fen: 8000000, start_month: '2026-07', total_months: 24, terminate_month: '', group_id: 'amort_x', batch_seq: 2, amount_fen: 3334, amountYuan: '33.34' },
          ],
        }],
      });
      log('  setData ok');
    } catch (e) { log('  setData fail', e.message); R.errors.push('setData: ' + e.message); }
    await sleep(1500);
    await shot('h1_amortize_group2.png');
    const all2 = (await texts(page)).join('\n');
    R.texts.amortizeInjected = all2 ? all2.split('\n') : [];
    check('组卡片「共 2 笔采购」', /共\s*2\s*笔采购/.test(all2));
    check('组卡片「合计原值」', /合计原值/.test(all2));
    check('逐笔「第 1 笔 / 第 2 笔」', /第\s*1\s*笔/.test(all2) && /第\s*2\s*笔/.test(all2));
    check('每笔各自「提前报废」', /提前报废/.test(all2));
    check('组内「追加采购」按钮', /追加采购/.test(all2));
  } catch (e) {
    log('H1 中断', e.message); R.errors.push('H1: ' + e.message);
    check('H1 摊销页核验完成', false, e.message);
  }

  try { await mp.disconnect(); } catch (e) {}
  fs.writeFileSync(path.join(OUT, 'verify_8c.json'), JSON.stringify(R, null, 2), 'utf8');
  const bad = R.checks.filter((c) => !c[1]);
  console.log(`\n===== 批次 8c 模拟器核验：${R.checks.length - bad.length}/${R.checks.length} 通过 =====`);
  if (R.errors.length) console.log('过程告警：\n  ' + R.errors.join('\n  '));
})().catch((e) => {
  console.error('FATAL', e.message);
  fs.writeFileSync(path.join(OUT, 'verify_8c.json'), JSON.stringify(R, null, 2), 'utf8');
  process.exit(2);
});
