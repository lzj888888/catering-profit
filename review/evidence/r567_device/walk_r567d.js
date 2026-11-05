// R567-D 走查第二段：去补价预填（拦截 navigateTo，避免导航毒化通道）→ 燃料开关 → 保存取证 → 列表亏本筛选
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'review/evidence/r567_device';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { startedAt: new Date().toISOString(), checks: [], notes: [], fails: [] };
const save = () => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'report_d.json'), JSON.stringify(report, null, 1)); };
const chk = (id, expect, actual, pass) => {
  report.checks.push({ id, expect, actual, pass: !!pass });
  console.log(pass ? 'PASS' : 'NG  ', id, '|', expect, '|', String(actual).slice(0, 320));
  save();
};
const note = (s) => { report.notes.push(s); save(); console.log('NOTE', String(s).slice(0, 500)); };

async function ev(mp, fn, arg, tries) {
  for (let i = 0; i < (tries || 5); i++) {
    try {
      const r = await mp.evaluate(fn, arg);
      if (r && r.__noPage) { await sleep(1500); continue; }
      return r;
    } catch (e) { console.log('ev retry', i, e.message); await sleep(1500); }
  }
  return null;
}

async function goto(mp, url) {
  const expect = url.replace(/^\//, '').split('?')[0];
  for (let round = 0; round < 3; round++) {
    try { await mp.evaluate((u) => { wx.reLaunch({ url: u, fail: () => {} }); return 1; }, url); } catch (e) { /* ignore */ }
    for (let i = 0; i < 8; i++) {
      await sleep(1500);
      const r = await ev(mp, () => { const s = getCurrentPages(); return { n: s.length, route: s.length ? s[s.length - 1].route : null, q: s.length ? (s[s.length - 1].options || {}) : {} }; }, null, 1);
      if (r && r.route === expect) return r;
    }
  }
  return null;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });

  // ---------- D1. 导入页：拦 navigateTo，只取「写入的跳转地址 + 暂存草稿」 ----------
  if (!(await goto(mp, '/subpkg/biz/card/import'))) { report.fails.push({ name: 'goto:import' }); save(); process.exit(4); }
  const d1 = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const out = {};
    p.onInput({ detail: { value: '鱼香肉丝 热炒荤菜 38' } });
    p.onParse();
    out.row0 = { name: p.data.rows[0].name, price: p.data.rows[0].price, cat: p.data.rows[0].catLabel, status: p.data.rows[0].status };
    const origNav = wx.navigateTo;
    wx.navigateTo = (o) => { wx.__navUrl = o && o.url; };   // 只记录，不真跳（导航会毒化通道）
    p.onGoFill({ currentTarget: { dataset: { idx: 0 } } });
    wx.navigateTo = origNav;
    out.navUrl = wx.__navUrl || null;
    let stash = null; try { stash = wx.getStorageSync('DISH_IMPORT_DRAFT_ONE') || null; } catch (e) {}
    out.stash = stash ? { name: stash.name, priceYuan: stash.priceYuan, lineN: (stash.lines || []).length, cat: stash.category } : null;
    return out;
  });
  note('D1 ' + JSON.stringify(d1));
  chk('D-navUrl', '去补价跳编辑页且带 from_draft=1', d1 && d1.navUrl, d1 && d1.navUrl === '/subpkg/biz/card/edit?from_draft=1');
  chk('D-stash', '草稿写入本地暂存', d1 && JSON.stringify(d1.stash), d1 && d1.stash && d1.stash.name === '鱼香肉丝' && Number(d1.stash.priceYuan) === 38);

  // ---------- D2. 直接按该 URL 进编辑页，验预填 ----------
  const d2 = await goto(mp, '/subpkg/biz/card/edit?from_draft=1');
  await sleep(2500);
  const pre = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    return {
      route: p.route, isEdit: p.data.isEdit, name: p.data.name, price: p.data.priceYuan, cat: p.data.catLabel,
      loss: p.data.lossRate, lineN: (p.data.lines || []).length, lines: (p.data.lines || []).map((l) => ({ n: l.material_name, p: l.unit_price_yuan })),
    };
  });
  note('D2 预填 ' + JSON.stringify(pre));
  chk('D-route', '进入编辑页', pre && pre.route, pre && pre.route === 'subpkg/biz/card/edit');
  chk('D-name', '菜名预填', pre && pre.name, pre && pre.name === '鱼香肉丝');
  chk('D-price', '售价预填 38', pre && String(pre.price), pre && String(pre.price) === '38');
  chk('D-cat', '品类预填（热炒荤菜）', pre && pre.cat, pre && pre.cat === '热炒荤菜');
  chk('D-lines', '示例主料行带过来（≥1 行且有主料名）', pre && (pre.lineN + ':' + (pre.lines || []).map((l) => l.n).join('/')), pre && pre.lineN >= 1 && (pre.lines || []).some((l) => l.n && l.n.indexOf('调料') < 0));

  // ---------- E. 燃料开关 ----------
  const e = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const out = {};
    p.onPickCategory({ detail: { value: 6 } });
    out.high = { cat: p.data.catLabel, e: p.data.energyFen, on: p.data.energyOn, lines: (p.data.lines || []).map((l) => ({ n: l.material_name, p: l.unit_price_yuan })) };
    p.onToggleEnergy({ detail: { value: true } });
    out.on = { on: p.data.energyOn, lines: (p.data.lines || []).map((l) => ({ n: l.material_name, p: l.unit_price_yuan, k: l.line_kind })) };
    p.onToggleEnergy({ detail: { value: false } });
    out.off = { on: p.data.energyOn, has: (p.data.lines || []).some((l) => l.material_name === '燃气燃料分摊') };
    p.onPickCategory({ detail: { value: 0 } });
    out.low = { cat: p.data.catLabel, e: p.data.energyFen };
    return out;
  });
  const eLine = e && (e.on.lines || []).find((l) => l.n === '燃气燃料分摊');
  note('E ' + JSON.stringify(e));
  chk('E-high', '烧烤炸物 energyFen=40', e && e.high.e, e && e.high.e === 40);
  chk('E-defaultOff', '默认不入卡', e && (e.high.lines || []).map((l) => l.n).join('/'), e && !(e.high.lines || []).some((l) => l.n === '燃气燃料分摊'));
  chk('E-on', '开启→燃料行 0.40', JSON.stringify(eLine), !!eLine && eLine.p === '0.40');
  chk('E-kind', 'line_kind 合法', eLine && eLine.k, eLine && ['main', 'aux', 'season', 'semi', 'pack'].indexOf(eLine.k) >= 0);
  chk('E-off', '关闭→燃料行移除', e && JSON.stringify(e.off), e && e.off.has === false);
  chk('E-low', '热炒荤菜 energyFen=0（开关不出现）', e && e.low.e, e && e.low.e === 0);

  // ---------- F. 保存取证（记录 toast/modal 原文） ----------
  const f = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const logs = [];
    const oldToast = wx.showToast; const oldModal = wx.showModal;
    wx.showToast = (o) => { logs.push('toast:' + (o && o.title)); };
    wx.showModal = (o) => { logs.push('modal:' + (o && (o.title || '') + '|' + (o.content || ''))); if (o && o.success) o.success({ confirm: false }); };
    p.onPickCategory({ detail: { value: 0 } });
    const lines = (p.data.lines || []).map((l) => Object.assign({}, l));
    let filled = false;
    for (let i = 0; i < lines.length; i++) {
      const nm = lines[i].material_name || '';
      if (nm && nm.indexOf('调料') < 0 && !filled) { lines[i].unit_price_yuan = '15.00'; filled = true; }
    }
    p.setData({ name: '【走查】亏本菜A', priceYuan: '10', lines });
    const snapshot = { name: p.data.name, price: p.data.priceYuan, lines: lines.map((l) => ({ n: l.material_name, p: l.unit_price_yuan })), badAmount: p.data.badAmountCount, hasPreset: p.data.hasPreset };
    const ret = p.doSave();
    const after = { name: p.data.name, price: p.data.priceYuan, saving: p.data.saving, badAmount: p.data.badAmountCount };
    return { snapshot, logs, after, isPromise: !!(ret && ret.then) };
  });
  note('F 保存 ' + JSON.stringify(f));
  await sleep(6000);
  const afterSave = await ev(mp, () => { const s = getCurrentPages(); return { n: s.length, route: s.length ? s[s.length - 1].route : null }; });
  note('F 保存后路由 ' + JSON.stringify(afterSave));

  // ---------- G. 列表：看卡是否真落库 ----------
  if (await goto(mp, '/subpkg/biz/card/index')) {
    await sleep(5000);
    const g = await ev(mp, () => {
      const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
      if (!p) return { __noPage: 1 };
      return { loading: p.data.loading, len: (p.data.all || []).length, loseCount: p.data.loseCount, loseWarn: p.data.loseWarn,
        rows: (p.data.all || []).map((c) => ({ n: c.name, m: c.margin, p: c.price, cost: c.total_cost })) };
    });
    note('G 列表 ' + JSON.stringify(g));
    chk('G-save', '保存后列表出现走查卡', g && g.len, g && g.len >= 1 && (g.rows || []).some((r) => r.n === '【走查】亏本菜A'));
    if (g && (g.rows || []).some((r) => r.n === '【走查】亏本菜A')) {
      const row = (g.rows || []).find((r) => r.n === '【走查】亏本菜A');
      chk('G-cost', '成本≈15.5 元（15 主料 + 0.5 调料）', row && row.cost, row && Math.abs(Number(row.cost) - 15.5) < 0.05);
      chk('G-margin', '毛利为负（卖 10 亏本）', row && row.m, row && Number(row.m) < 0);
      chk('G-loseCount', '亏本计数=1', g.loseCount, g.loseCount === 1);
      chk('G-warn', '亏本提示条出现', g.loseWarn, !!g.loseWarn);
      const g2 = await ev(mp, () => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
        if (!p) return { __noPage: 1 };
        const before = (p.data.list || []).length;
        p.onToggleLossOnly();
        const out = { before, after: (p.data.list || []).length, lossOnly: p.data.lossOnly, names: (p.data.list || []).map((c) => c.name) };
        p.onToggleLossOnly();
        out.back = (p.data.list || []).length; out.lossOnlyBack = p.data.lossOnly;
        return out;
      });
      chk('G-filter', '点提示条只剩 1 张亏本卡', g2 && JSON.stringify(g2), g2 && g2.after === 1 && g2.lossOnly === true);
      chk('G-restore', '再点恢复全量', g2 && JSON.stringify(g2), g2 && g2.back === g2.before && g2.lossOnlyBack === false);

      // 清理
      const cc = await ev(mp, () => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
        if (!p) return { __noPage: 1 };
        return (p.data.all || []).filter((c) => (c.name || '').indexOf('【走查】') === 0).map((c) => c.card_code);
      });
      note('待删 ' + JSON.stringify(cc));
      for (const code of (cc || [])) {
        const del = await ev(mp, (k) => {
          const app = getApp(); const gd = (app && app.globalData) || {};
          return wx.cloud.callFunction({ name: 'saveCostCard', data: { shop_id: gd.shop_id || '', card: { _delete: true, card_code: k }, client_request_id: 'ccd_' + Date.now() } })
            .then((x) => ({ ok: 1, r: JSON.stringify(x.result).slice(0, 160) })).catch((e) => ({ ok: 0, e: e && (e.errMsg || e.message) }));
        }, code, 2);
        note('删除 ' + code + ' => ' + JSON.stringify(del));
      }
    } else {
      chk('G-save', '保存后列表出现走查卡', '列表仍 0 张 ⇒ 保存未落库', false);
    }
  }

  const ng = report.checks.filter((x) => !x.pass);
  console.log('DONE checks=' + report.checks.length + ' ng=' + ng.length);
  save();
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('FATAL', e && e.stack); report.fails.push({ name: 'fatal', why: String(e && e.message) }); save(); process.exit(3); });
