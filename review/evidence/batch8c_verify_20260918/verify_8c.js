// 8c 独立核验（模拟器）：H1 摊销多次采购分组 / H2 填表引导
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');
const OUT = process.argv[2] || 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/batch8c_verify_20260918';
const WS = 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withPage(url, fn) {
  const mp = await automator.connect({ wsEndpoint: WS });
  try {
    await mp.reLaunch(url);
    await sleep(3000);
    let page = null;
    for (let i = 0; i < 5; i++) {
      try { page = await mp.currentPage(); if (page && page.path) break; } catch (e) {}
      await sleep(1200);
    }
    return await fn(mp, page);
  } finally { try { await mp.disconnect(); } catch (e) {} }
}

async function texts(page) {
  const set = new Set();
  const nodes = await page.$$('view, text, button, input, picker');
  for (const n of nodes || []) {
    try { const t = await n.text(); if (typeof t === 'string' && t.trim()) set.add(t.trim()); } catch (e) {}
  }
  return Array.from(set);
}

// 用 tapping 找到包含指定文字的节点并点击
async function tapByText(page, re, maxLen) {
  const els = await page.$$('view, button, text');
  for (const el of els || []) {
    try {
      const t = (await el.text()) || '';
      if (re.test(t) && (!maxLen || t.length <= maxLen)) { await el.tap(); return t.slice(0, 30); }
    } catch (e) {}
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const out = {};

  // ===== H2：录入页（真实渲染，无需数据）=====
  out.input = await withPage('/pages/month/input', async (mp, page) => {
    const r = { path: page && page.path, checks: [] };
    await mp.screenshot({ path: path.join(OUT, 'h2_input_top.png') });
    let tx = await texts(page);
    let all = tx.join('\n');
    r.checks.push(['引导·顶部「填写口径」标题渲染', /填写口径/.test(all)]);
    r.checks.push(['引导·收入总口径渲染', /收入按当月实际到账金额填写/.test(all)]);
    r.checks.push(['引导·费用总口径渲染', /费用只填本月实际支出/.test(all)]);
    r.checks.push(['引导·堂食口径（不包括充值预收）', /不包括会员充值预收/.test(all)]);
    r.checks.push(['引导·外卖口径（佣金记营销）', /平台佣金与配送费不要在这里扣/.test(all)]);
    r.checks.push(['引导·运营口径（设备装修走摊销）', /不包括设备与装修购置/.test(all)]);
    r.checks.push(['引导·其他口径（加盟费走摊销资产）', /加盟费\/品牌使用费金额大请走「摊销资产」/.test(all)]);
    const scopeHits = tx.filter((t) => /包括.*不包括|不包括.*走「摊销资产」|不要在这里扣/.test(t)).length;
    r.scopeHitCount = scopeHits;
    r.checks.push(['引导·7 类口径句均渲染', scopeHits >= 7, `实际 ${scopeHits}`]);
    const pd0 = await page.data();
    r.guideClosedInit = pd0 && pd0.fillGuideOpen === false;
    r.checks.push(['填写口径默认收起', r.guideClosedInit === true]);
    // 点开折叠块
    const tapped = await tapByText(page, /填写口径/, 40);
    await sleep(1000);
    await mp.screenshot({ path: path.join(OUT, 'h2_input_guide_open.png') });
    const pd1 = await page.data();
    r.guideOpened = pd1 && pd1.fillGuideOpen === true;
    r.checks.push(['点开折叠块后 fillGuideOpen=true', !!r.guideOpened, tapped ? `点击「${tapped}」` : '未点中']);
    const tx2 = (await texts(page)).join('\n');
    r.checks.push(['口径 5 条全部展开可见', /同一笔钱只填一次/.test(tx2) && /食材采购不计入费用/.test(tx2) && /设备、装修、加盟费等一次性投入/.test(tx2)]);
    return r;
  });

  // ===== H1：摊销页（真实渲染 + 注入两笔的组渲染核验）=====
  out.amortize = await withPage('/pages/month/amortize', async (mp, page) => {
    const r = { path: page && page.path, checks: [] };
    await mp.screenshot({ path: path.join(OUT, 'h1_amortize_real.png') });
    const tx = await texts(page);
    const all = tx.join('\n');
    r.checks.push(['摊销页口径提示渲染（追加采购/独立起摊）', /追加采购/.test(all) && /每笔从各自的采购月起单独摊销/.test(all)]);
    const pd = await page.data();
    r.realGroupCount = (pd && pd.groups ? pd.groups.length : -1);
    r.realAssetCount = (pd && pd.assets ? pd.assets.length : -1);

    // 注入一个两笔的组，验证「共N笔 + 合计原值 + 展开看每笔 + 追加采购按钮」渲染路径
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
    await sleep(1200);
    await mp.screenshot({ path: path.join(OUT, 'h1_amortize_group2.png') });
    const all2 = (await texts(page)).join('\n');
    r.checks.push(['组卡片显示「共 2 笔采购」', /共2笔采购|共 2 笔采购/.test(all2)]);
    r.checks.push(['组卡片显示「合计原值」', /合计原值/.test(all2)]);
    r.checks.push(['每笔显示「第 1 笔 / 第 2 笔」', /第1笔/.test(all2) && /第2笔/.test(all2)]);
    r.checks.push(['每笔各自有「提前报废」', /提前报废/.test(all2)]);
    r.checks.push(['有「追加采购」按钮', /追加采购/.test(all2)]);
    // 点「追加采购」→ 表单应切到追加模式
    const tapped = await tapByText(page, /追加采购/, 20);
    await sleep(1200);
    await mp.screenshot({ path: path.join(OUT, 'h1_append_form.png') });
    const pd2 = await page.data();
    r.appendGroup = pd2 && pd2.appendGroup;
    r.appendSeq = pd2 && pd2.appendSeq;
    r.checks.push(['点「追加采购」进入追加模式（组键 + 笔次=3）', r.appendGroup === 'amort_x' && r.appendSeq === 3, `${tapped ? '点击命中' : '未点中'} group=${r.appendGroup} seq=${r.appendSeq}`]);
    return r;
  });

  fs.writeFileSync(path.join(OUT, 'verify_8c.json'), JSON.stringify(out, null, 2), 'utf8');
  let pass = 0, total = 0;
  for (const [k, v] of Object.entries(out)) {
    const bad = (v.checks || []).filter((c) => !c[1]);
    total += (v.checks || []).length; pass += (v.checks || []).length - bad.length;
    console.log(`${k}: ${(v.checks || []).length - bad.length}/${(v.checks || []).length} ${bad.length ? '❌ ' + bad.map((b) => b[0]).join(' | ') : '✅'}`);
    (v.checks || []).forEach((c) => console.log(`   ${c[1] ? '✅' : '❌'} ${c[0]}${c[2] ? '  (' + c[2] + ')' : ''}`));
  }
  console.log(`\n===== 批次 8c 模拟器核验：${pass}/${total} 项通过 =====`);
})().catch((e) => { console.error('FATAL', e && (e.stack || e.message)); process.exit(2); });
