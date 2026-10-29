// R567-C 走查（单连接 · 零截图）：导入 → 解析 → 三色 → 去补价 → 预填 → 燃料开关 → 造卡保存 → 列表亏本筛选 → 清理
// 为什么零截图：本轮实测 mp.screenshot() 在模拟器重启后**必 timeout 且会毒化整条通道**
//   （症状：截图超时后后续 evaluate 全部 timeout，甚至页面栈变 0）；
//   而纯逻辑层 evaluate 连续 3 跳全通（_r567_min.js 实测）⇒ 先拿行为证据，画面证据另途。
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'review/evidence/r567_device';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { startedAt: new Date().toISOString(), checks: [], notes: [], fails: [] };
const save = () => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'report_c.json'), JSON.stringify(report, null, 1)); };
const chk = (id, expect, actual, pass) => {
  report.checks.push({ id, expect, actual, pass: !!pass });
  console.log(pass ? 'PASS' : 'NG  ', id, '|', expect, '|', String(actual).slice(0, 300));
  save();
};
const note = (s) => { report.notes.push(s); save(); console.log('NOTE', String(s).slice(0, 400)); };

async function ev(mp, fn, arg, tries) {
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const r = await mp.evaluate(fn, arg);
      if (r && r.__noPage) { await sleep(1200); continue; }
      return r;
    } catch (e) { console.log('ev retry', i, e.message); await sleep(1200); }
  }
  return null;
}

async function goto(mp, url) {
  const expect = url.replace(/^\//, '');
  for (let round = 0; round < 3; round++) {
    try { await mp.evaluate((u) => { wx.reLaunch({ url: u, fail: () => {} }); return 1; }, url); } catch (e) { /* 可忽略 */ }
    for (let i = 0; i < 8; i++) {
      await sleep(1500);
      const r = await ev(mp, () => { const s = getCurrentPages(); return { n: s.length, route: s.length ? s[s.length - 1].route : null }; }, null, 1);
      if (r && r.route === expect) return r;
    }
  }
  return null;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  report.notes.push('ws=' + WS + ' at ' + new Date().toISOString());

  // ---------- A. 导入页 ----------
  if (!(await goto(mp, '/subpkg/biz/card/import'))) { report.fails.push({ name: 'goto:import' }); save(); process.exit(4); }
  const a = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const t = p.data.t || {};
    return { title: t.title, emptyKeys: Object.keys(t).filter((k) => !t[k]), parsed: p.data.parsed, rows: (p.data.rows || []).length, intro: t.intro, noAuto: t.noAuto };
  });
  chk('A-title', '标题=批量导入菜品', a && a.title, a && a.title === '批量导入菜品');
  chk('A-tkeys', 't 文案无空键', a && JSON.stringify(a.emptyKeys), a && a.emptyKeys.length === 0);
  chk('A-empty', '首进不出空态提示', a && `parsed=${a.parsed} rows=${a.rows}`, a && a.parsed === false && a.rows === 0);
  chk('A-noAuto', '页内明说「不直接算毛利」', a && (a.noAuto || '').slice(0, 20), a && /不会直接算毛利/.test(a.noAuto || ''));

  // ---------- B. 解析 ----------
  const SAMPLE = ['鱼香肉丝 热炒荤菜 38', '凉拌黄瓜 凉拌 16', '可乐 饮品 8', '招牌狮子头 1,280', '秘制私房菜 26'].join('\n');
  const b = await ev(mp, (txt) => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    p.onInput({ detail: { value: txt } });
    p.onParse();
    return { summary: p.data.summaryText, rows: (p.data.rows || []).map((r) => ({ n: r.name, p: r.price, c: r.catLabel, s: r.status, st: r.statusText, why: r.reason, th: r.thousands })) };
  }, SAMPLE);
  const R = (b && b.rows) || [];
  chk('B-rows', '5 行全部解析', R.length, R.length === 5);
  chk('B-name', '菜名正确', R[0] && R[0].n, R[0] && R[0].n === '鱼香肉丝');
  chk('B-price', '售价 38', R[0] && R[0].p, R[0] && R[0].p === '38.00');
  chk('B-cat', '品类识别（热炒荤菜）', R[0] && R[0].c, R[0] && R[0].c === '热炒荤菜');
  chk('B-orange', '认出品类的=待补价', R[0] && R[0].st, R[0] && R[0].s === 'orange');
  chk('B-thousands', '1,280 报千分位', R[3] && R[3].why, R[3] && R[3].th === true && /千分位/.test(R[3].why || ''));
  chk('B-noCat', '未识别=缺信息', R[4] && R[4].why, R[4] && /没认出来/.test(R[4].why || ''));
  chk('B-summary', '汇总含 5 道', b && b.summary, b && /5/.test(b.summary || ''));

  // ---------- C. 行内编辑 ----------
  const c = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const out = {};
    p.onPickCat({ currentTarget: { dataset: { idx: 4 } }, detail: { value: 1 } });
    out.pick = { c: p.data.rows[4].catLabel, s: p.data.rows[4].status };
    p.data.rows[2].price = '';
    p.onPriceBlur({ currentTarget: { dataset: { idx: 2 } }, detail: { value: '' } });
    out.clear = { s: p.data.rows[2].status, why: p.data.rows[2].reason };
    p.data.rows[2].price = '8';
    p.onPriceBlur({ currentTarget: { dataset: { idx: 2 } }, detail: { value: '8' } });
    out.refill = { s: p.data.rows[2].status };
    return out;
  });
  chk('C-pickCat', '手选品类→待补价', c && JSON.stringify(c.pick), c && c.pick.c === '热炒荤菜' && c.pick.s === 'orange');
  chk('C-clear', '清空售价→缺售价标红', c && JSON.stringify(c.clear), c && c.clear.s === 'red' && /缺售价/.test(c.clear.why || ''));
  chk('C-refill', '填回→待补价', c && JSON.stringify(c.refill), c && c.refill.s === 'orange');

  // ---------- D. 去补价 → 预填 ----------
  await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    p.onGoFill({ currentTarget: { dataset: { idx: 0 } } });
    return 1;
  }, null, 2);
  let d = null;
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    d = await ev(mp, () => {
      const s = getCurrentPages(); const top = s.length ? s[s.length - 1] : null;
      if (!top) return { __noPage: 1 };
      let stash = null; try { stash = wx.getStorageSync('DISH_IMPORT_DRAFT_ONE') || null; } catch (e) {}
      return {
        route: top.route, name: top.data.name, price: top.data.priceYuan, cat: top.data.catLabel, loss: top.data.lossRate,
        lineN: (top.data.lines || []).length, lines: (top.data.lines || []).map((l) => l.material_name), stash: stash && stash.name,
      };
    }, null, 1);
    if (d && d.route === 'subpkg/biz/card/edit') break;
  }
  chk('D-route', '跳编辑页', d && d.route, d && d.route === 'subpkg/biz/card/edit');
  chk('D-stash', '草稿进暂存', d && d.stash, d && d.stash === '鱼香肉丝');
  chk('D-name', '菜名预填', d && d.name, d && d.name === '鱼香肉丝');
  chk('D-price', '售价预填 38', d && String(d.price), d && String(d.price) === '38');
  chk('D-cat', '品类预填', d && d.cat, d && d.cat === '热炒荤菜');
  chk('D-lines', '示例主料带过来', d && (d.lineN + ':' + (d.lines || []).join('/')), d && d.lineN >= 1);

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
  chk('E-high', '烧烤炸物 energyFen=40', e && e.high.e, e && e.high.e === 40);
  chk('E-defaultOff', '默认不入卡', e && (e.high.lines || []).map((l) => l.n).join('/'), e && !(e.high.lines || []).some((l) => l.n === '燃气燃料分摊'));
  chk('E-on', '开启→燃料行 0.40', JSON.stringify(eLine), !!eLine && eLine.p === '0.40');
  chk('E-kind', 'line_kind 合法', eLine && eLine.k, eLine && ['main', 'aux', 'season', 'semi', 'pack'].indexOf(eLine.k) >= 0);
  chk('E-off', '关闭→移除', e && JSON.stringify(e.off), e && e.off.has === false);
  chk('E-low', '热炒荤菜 energyFen=0', e && e.low.e, e && e.low.e === 0);

  // ---------- F. 造两张真卡 ----------
  const mk = async (name, price, mainPrice, catIdx) => {
    if (!(await goto(mp, '/subpkg/biz/card/edit'))) return { err: 'no edit page' };
    const prep = await ev(mp, (cfg) => {
      const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
      if (!p) return { __noPage: 1 };
      p.onPickCategory({ detail: { value: cfg.catIdx } });
      const lines = (p.data.lines || []).map((l) => Object.assign({}, l));
      let filled = false;
      for (let i = 0; i < lines.length; i++) {
        const nm = lines[i].material_name || '';
        if (nm && nm.indexOf('调料') < 0 && !filled) { lines[i].unit_price_yuan = cfg.mainPrice; filled = true; }
      }
      p.setData({ name: cfg.name, priceYuan: String(cfg.price) });
      p.setData({ lines });
      return { filled, hasPreset: p.data.hasPreset, lines: lines.map((l) => ({ n: l.material_name, p: l.unit_price_yuan })) };
    }, { name, price, mainPrice, catIdx });
    await sleep(1000);
    const called = await ev(mp, () => {
      const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
      if (!p) return { __noPage: 1 };
      p.doSave();
      return { ok: 1 };
    }, null, 2);
    await sleep(5000);
    const after = await ev(mp, () => { const s = getCurrentPages(); return { n: s.length, route: s.length ? s[s.length - 1].route : null }; });
    return { prep, called, after };
  };
  const m1 = await mk('【走查】亏本菜A', 10, '15.00', 0);
  note('造卡A ' + JSON.stringify(m1));
  const m2 = await mk('【走查】正常菜B', 30, '6.00', 0);
  note('造卡B ' + JSON.stringify(m2));

  // ---------- G. 列表校验 ----------
  if (!(await goto(mp, '/subpkg/biz/card/index'))) { report.fails.push({ name: 'goto:list' }); save(); process.exit(4); }
  await sleep(5000);
  const g1 = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    return { loading: p.data.loading, len: (p.data.all || []).length, shown: (p.data.list || []).length,
      loseCount: p.data.loseCount, loseWarn: p.data.loseWarn,
      rows: (p.data.all || []).map((c) => ({ n: c.name, m: c.margin, p: c.price, cost: c.total_cost })) };
  });
  note('列表态 ' + JSON.stringify(g1));
  const GG = g1 || {};
  chk('G-loaded', '列表加载完成', `loading=${GG.loading} all=${GG.len}`, GG.loading === false && GG.len >= 2);
  const loseRow = (GG.rows || []).find((r) => r.n === '【走查】亏本菜A');
  const normRow = (GG.rows || []).find((r) => r.n === '【走查】正常菜B');
  chk('G-costA', '亏本卡成本≈15.5 元', loseRow && loseRow.cost, loseRow && Math.abs(Number(loseRow.cost) - 15.5) < 0.02);
  chk('G-marginA', '亏本卡毛利为负', loseRow && loseRow.m, loseRow && Number(loseRow.m) < 0);
  chk('G-marginB', '正常卡毛利为正', normRow && normRow.m, normRow && Number(normRow.m) > 0);
  chk('G-loseCount', '亏本计数=1', GG.loseCount, GG.loseCount === 1);
  chk('G-warn', '提示条出现', GG.loseWarn, !!GG.loseWarn);

  const g2 = await ev(mp, () => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p) return { __noPage: 1 };
    const before = (p.data.list || []).length;
    p.onToggleLossOnly();
    const out = { before, after: (p.data.list || []).length, lossOnly: p.data.lossOnly, warn: p.data.loseWarn, names: (p.data.list || []).map((c) => c.name) };
    p.onToggleLossOnly();
    out.back = (p.data.list || []).length;
    out.lossOnlyBack = p.data.lossOnly;
    return out;
  });
  chk('G-filter', '点提示条只剩 1 张亏本卡', g2 && JSON.stringify(g2), g2 && g2.after === 1 && g2.lossOnly === true && (g2.names || [])[0] === '【走查】亏本菜A');
  chk('G-restore', '再点恢复全量', g2 && JSON.stringify(g2), g2 && g2.back === g2.before && g2.lossOnlyBack === false);

  // ---------- H. 清理 ----------
  if (GG.rows) {
    const codes = await ev(mp, () => {
      const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
      if (!p) return { __noPage: 1 };
      return { codes: (p.data.all || []).filter((c) => (c.name || '').indexOf('【走查】') === 0).map((c) => c.card_code) };
    });
    note('待删 ' + JSON.stringify(codes));
    for (const cc of ((codes && codes.codes) || [])) {
      const del = await ev(mp, (code) => {
        const app = getApp(); const g = (app && app.globalData) || {};
        return wx.cloud.callFunction({ name: 'saveCostCard', data: { shop_id: g.shop_id || '', card: { _delete: true, card_code: code }, client_request_id: 'ccd_' + Date.now() } })
          .then((x) => ({ ok: 1, r: JSON.stringify(x.result).slice(0, 200) })).catch((e) => ({ ok: 0, e: e && (e.errMsg || e.message) }));
      }, cc, 2);
      note('删除 ' + cc + ' => ' + JSON.stringify(del));
    }
    // 复核：重载列表确认已清
    if (await goto(mp, '/subpkg/biz/card/index')) {
      await sleep(4000);
      const h = await ev(mp, () => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
        if (!p) return { __noPage: 1 };
        return { left: (p.data.all || []).filter((c) => (c.name || '').indexOf('【走查】') === 0).length, total: (p.data.all || []).length };
      });
      chk('H-clean', '走查卡已清理（列表回到原状）', JSON.stringify(h), h && h.left === 0);
    }
  }

  const ng = report.checks.filter((x) => !x.pass);
  console.log('DONE checks=' + report.checks.length + ' ng=' + ng.length);
  save();
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('FATAL', e && e.stack); report.fails.push({ name: 'fatal', why: String(e && e.message) }); save(); process.exit(3); });
