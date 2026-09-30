// probe_pagewalk_r181n.js —— 小程序逐页走查（模拟器自动化通道）
// 用法: NODE_PATH=<mpauto>/node_modules node probe_pagewalk_r181n.js <outDir> <wsEndpoint> <repoRoot>
// 纪律：每页独立 connect（技能 §「每页独立 connect」）；页清单从 app.json 读，不手抄。
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const ROOT = process.argv[4];
const PREFLIGHT_ONLY = process.argv[5] === '--preflight';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const PAGES = appJson.pages;

function writeReport(report) {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1), 'utf8');
}

async function collect(mp, page) {
  const out = { buttons: [], leafTexts: [], cls: [] };
  try {
    const btns = await page.$$('button');
    for (const b of btns) {
      let t = '', c = '', d = '';
      try { t = await b.text(); } catch (e) {}
      try { c = await b.attribute('class'); } catch (e) {}
      try { d = await b.attribute('disabled'); } catch (e) {}
      out.buttons.push({ text: String(t == null ? '' : t).trim(), cls: String(c == null ? '' : c), disabled: String(d == null ? '' : d) });
    }
  } catch (e) { out.buttonsErr = String(e && e.message || e); }
  try {
    const texts = await page.$$('text');
    for (const t of texts.slice(0, 60)) {
      try { out.leafTexts.push(String((await t.text()) || '').trim()); } catch (e) {}
    }
  } catch (e) { out.textsErr = String(e && e.message || e); }
  return out;
}

async function withPage(url, fn) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let mp = null;
    try {
      mp = await automator.connect({ wsEndpoint: WS });
      await mp.reLaunch(url);
      await sleep(1900);
      const r = await fn(mp);
      try { await mp.disconnect(); } catch (e) {}
      return r;
    } catch (e) {
      lastErr = String(e && e.message || e);
      try { if (mp) await mp.disconnect(); } catch (e2) {}
      await sleep(1300);
    }
  }
  return { error: lastErr };
}

(async () => {
  const report = { ws: WS, pages: [], startedAt: new Date().toISOString() };

  // ---- 预检：通道是否真能用（避免整轮 21 页全废）----
  try {
    const mp = await automator.connect({ wsEndpoint: WS });
    await mp.reLaunch('/' + PAGES[0]);
    await sleep(3000);
    const p = await mp.currentPage();
    report.preflight = 'ok path=' + p.path;
    try { await mp.disconnect(); } catch (e) {}
  } catch (e) {
    report.preflight = 'FAIL: ' + String(e && e.message || e);
    writeReport(report);
    console.log('PREFLIGHT_FAIL: ' + report.preflight);
    console.log('=> 先修通道（重跑 cli auto），不要盲跑整轮。');
    process.exit(4);
  }
  console.log('[preflight] ' + report.preflight);
  if (PREFLIGHT_ONLY) { writeReport(report); process.exit(0); }

  for (let i = 0; i < PAGES.length; i++) {
    const url = '/' + PAGES[i];
    const name = PAGES[i].replace(/\//g, '_');
    const rec = { idx: i + 1, url, name };
    const r = await withPage(url, async (mp) => {
      const page = await mp.currentPage();
      let actualPath = '';
      try { actualPath = page.path; } catch (e) {}
      const got = await collect(mp, page);
      let shot = null;
      try {
        shot = path.join(OUT, String(i + 1).padStart(2, '0') + '_' + name + '.png');
        await mp.screenshot({ path: shot });
      } catch (e) { rec.shotErr = String(e && e.message || e); }
      return { actualPath, got, shot };
    });
    if (r.error) { rec.error = r.error; }
    else {
      rec.actualPath = r.actualPath;
      rec.buttons = r.got.buttons;
      rec.leafTexts = r.got.leafTexts.slice(0, 30);
      rec.leafTextCount = r.got.leafTexts.length;
      rec.shot = r.shot ? path.basename(r.shot) : null;
    }
    report.pages.push(rec);
    writeReport(report);   // 增量落盘：进程被杀也能看到已跑部分
    console.log('[' + rec.idx + '/' + PAGES.length + '] ' + url +
      (rec.error ? '  ERROR: ' + rec.error : '  actual=' + rec.actualPath + '  buttons=' + (rec.buttons || []).length));
  }

  // ===== 专项：takeaway 第二 tab（导入）=====
  const tt = { url: '/pages/takeaway/index' };
  const r2 = await withPage(tt.url, async (mp) => {
    const page = await mp.currentPage();
    let shot1 = path.join(OUT, '16b_takeaway_tab_calc.png');
    try { await mp.screenshot({ path: shot1 }); } catch (e) {}
    // 切换到导入 tab（页面上下文写操作，技能实测零超时）
    let evOut = null;
    try {
      evOut = await mp.evaluate(() => {
        const ps = getCurrentPages();
        const p = ps[ps.length - 1];
        p.setData({ tab: 'import' });
        return { tab: p.data.tab, stackLen: ps.length };
      });
    } catch (e) { tt.evalErr = String(e && e.message || e); }
    await sleep(1600);
    const imported = await collect(mp, page);
    let shot2 = path.join(OUT, '16c_takeaway_tab_import.png');
    try { await mp.screenshot({ path: shot2 }); } catch (e) {}
    return { evOut, imported, shot1: path.basename(shot1), shot2: path.basename(shot2) };
  });
  if (r2.error) tt.error = r2.error; else Object.assign(tt, r2);
  report.takeawayTab = tt;
  console.log('[takeaway tab] ' + JSON.stringify(tt.error ? tt.error : { eval: tt.evOut, btns: (tt.imported || {}).buttons }));

  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.log('REPORT -> ' + path.join(OUT, 'report.json'));
  // 🔴 必须显式退出：automator 的连接句柄会让事件循环挂住（实测上一轮跑完不退出）
  process.exit(0);
})();
