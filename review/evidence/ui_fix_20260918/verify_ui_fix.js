// 独立核验：六处 UI 修复是否真的生效（不采信 InsCode 自述）
// 用法：node verify_ui_fix.js <输出目录> [ws]
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const OUT = process.argv[2] || 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_gui/fixsim';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (id, expect, actual, pass, note) => {
  results.push({ id, expect, actual, pass, note: note || '' });
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${id}\n        期望: ${expect}\n        实际: ${actual}${note ? '\n        备注: ' + note : ''}`);
};

async function allText(page) {
  const nodes = await page.$$('view, text, button, label');
  const arr = [];
  for (const n of nodes) {
    try {
      const t = (await n.text()).replace(/\s+/g, ' ').trim();
      if (t) arr.push(t);
    } catch (e) {}
  }
  return arr;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });
  await mp.reLaunch('/pages/index/index');
  await sleep(2500);

  // ── 修 1：month/result 三态 ──
  try {
    await mp.reLaunch('/pages/month/result');
    await sleep(5000);
    const page = await mp.currentPage();
    const d = await page.data();
    await mp.screenshot({ path: path.join(OUT, 'v1_result.png') });
    const txt = await allText(page);
    const flat = txt.join('|');
    const hasEmpty = flat.indexOf('本月还没有账本') >= 0;
    const hasLoading = flat.indexOf('加载中') >= 0;
    const btns = await page.$$('button');
    const btxt = [];
    for (const b of btns) { try { btxt.push((await b.text()).trim()); } catch (e) {} }
    rec('F1-result-空态出现', 'loading=false 且 r=null 时显示空态文案', `loading=${d.loading} r=${d.r === null ? 'null' : 'obj'} 含空态文案=${hasEmpty}`, hasEmpty && !hasLoading,
      `含"加载中"=${hasLoading}；按钮=${JSON.stringify(btxt)}`);
  } catch (e) { rec('F1-result-空态出现', '可读取', 'ERR ' + e.message, false); }

  // ── 修 2：month/amortize 合计显示 0.00 ──
  try {
    await mp.reLaunch('/pages/month/amortize');
    await sleep(5000);
    const page = await mp.currentPage();
    const d = await page.data();
    await mp.screenshot({ path: path.join(OUT, 'v2_amortize.png') });
    let numTxt = '';
    try { const el = await page.$('.result-num'); numTxt = (await el.text()).trim(); } catch (e) { numTxt = '取不到 .result-num'; }
    rec('F2a-摊销合计非空', '显示「¥0.00」而不是裸「¥」', `data.totalYuan=${JSON.stringify(d.totalYuan)} .result-num="${numTxt}"`,
      /¥\s*0\.00/.test(numTxt.replace(/\s/g, '')) || numTxt.indexOf('0.00') >= 0);
  } catch (e) { rec('F2a-摊销合计非空', '可读取', 'ERR ' + e.message, false); }

  // ── 修 3 + 修 5：month/index 月份占位 + 单 tab 不满宽 ──
  try {
    await mp.reLaunch('/pages/month/index');
    await sleep(5000);
    const page = await mp.currentPage();
    const d = await page.data();
    await mp.screenshot({ path: path.join(OUT, 'v3_month_index.png') });
    const txt = await allText(page);
    const flat = txt.join('|');
    const hasPh = flat.indexOf('暂无账本') >= 0;
    rec('F2b-月份占位', 'curMonth 为空时显示占位文案', `curMonth=${JSON.stringify(d.curMonth)} 含"暂无账本"=${hasPh}`, hasPh);

    let single = false, tabN = 0, ruleOk = false;
    const cls = String(await (await page.$('.tabs')).attribute('class'));
    tabN = (await page.$$('.tab')).length;
    single = cls.indexOf('single') >= 0;
    const wxss = fs.readFileSync('C:/Users/lzj/WorkBuddy/Claw/catering-profit/pages/month/index.wxss', 'utf8');
    ruleOk = /\.tabs\.single[^{]*\{[^}]*inline-flex/.test(wxss) && /\.tabs\.single[^{]*\.tab[^{]*\{[^}]*flex:\s*0\s+0\s+auto/.test(wxss);
    rec('L2-单tab不满宽', 'isPaid=false 时 .tabs 带 single、只 1 个 .tab、且 wxss 有「单 tab 不满宽」规则',
      `.tabs class="${cls}" .tab 数=${tabN} wxss规则=${ruleOk} isPaid=${d.isPaid}`, single && ruleOk && tabN === 1);
  } catch (e) { rec('F2b-月份占位', '可读取', 'ERR ' + e.message, false); }

  // ── 修 4：month/input 两处文案不再相同 ──
  try {
    await mp.reLaunch('/pages/month/input');
    await sleep(5000);
    const page = await mp.currentPage();
    await mp.screenshot({ path: path.join(OUT, 'v4_input.png') });
    const secs = [];
    for (const e of await page.$$('.sec')) { try { secs.push((await e.text()).replace(/\s+/g, ' ').trim()); } catch (e2) {} }
    const lbls = [];
    for (const e of await page.$$('.lbl')) { try { lbls.push((await e.text()).replace(/\s+/g, ' ').trim()); } catch (e2) {} }
    const leaf = [];
    for (const e of await page.$$('text')) { try { leaf.push((await e.text()).replace(/\s+/g, ' ').trim()); } catch (e2) {} }
    const cnt = leaf.filter((t) => t === '食材消耗合计（元）').length;
    const hasSec = secs.indexOf('食材消耗') >= 0;
    const hasLbl = lbls.indexOf('食材消耗合计（元）') >= 0;
    rec('L1-标题与标签拆开', '小节标题="食材消耗"、字段标签="食材消耗合计（元）"，叶子节点计数=1',
      `sec列表=${JSON.stringify(secs)} | lbl列表=${JSON.stringify(lbls)} | 叶子计数=${cnt}`,
      hasSec && hasLbl && cnt === 1);
  } catch (e) { rec('L1-标题与标签拆开', '可读取', 'ERR ' + e.message, false); }

  // ── 修 6：mine 注销按钮 class 化 ──
  try {
    await mp.reLaunch('/pages/mine/index');
    await sleep(4500);
    const page = await mp.currentPage();
    await mp.screenshot({ path: path.join(OUT, 'v5_mine.png') });
    const btns = await page.$$('button');
    let found = null;
    for (const b of btns) {
      const t = (await b.text()).trim();
      if (t.indexOf('注销') >= 0) {
        found = { text: t, cls: await b.attribute('class'), style: await b.attribute('style') };
      }
    }
    const clsOk = found && String(found.cls).indexOf('danger') >= 0;
    const styleOk = found && (!found.style || String(found.style).trim() === '');
    rec('L3-注销按钮抽类', 'class 含 danger 且无内联 style', found ? `class="${found.cls}" style="${found.style}"` : '未找到按钮', !!(clsOk && styleOk));
  } catch (e) { rec('L3-注销按钮抽类', '可读取', 'ERR ' + e.message, false); }

  fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(results, null, 2), 'utf8');
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n===== 核验汇总：${pass}/${results.length} 通过 =====`);
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(1); });
