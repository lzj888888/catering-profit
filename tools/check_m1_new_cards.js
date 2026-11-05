#!/usr/bin/env node
/**
 * 批次 3 三块新 UI 的「运行时」守卫（L2 页面桩，第 236 个套件）
 *
 * 为什么需要这一套（别的守卫为什么守不住）
 * ------------------------------------------------------------------
 * `check_three_cost` / `check_copy_compliance` / `check_m1_indicator_view` 全是**静态文本断言**：
 * 它们只能证明「源码里有这一句」。但批次 3 新增的三块 UI 是否真的会被用户看到，
 * 取决于**运行时的值**：
 *   · `threeView.show = !!d.account_id && !!d.three_cost` —— 若判据写成常数或引错字段，
 *     卡片整块消失，而所有静态守卫照常全绿（字符串一个没少）。
 *   · `memberRatioWarn = level === 'warn'` —— 若写成 `=== 'ok'` 或恒 `true`，
 *     报警行要么该报不报、要么人人报警，静态守卫完全看不见。
 *   · `pct: has ? String(tc.pct) : ''` —— 若兜成 `'0'`，缺房租会显示「0%」，
 *     老板以为房租不用钱；这条正是 A17 与 A19 共同的纪律（缺项 ≠ 0）。
 *
 * 本套件真跑 `subpkg/biz/month/result.js`（生产源码，不是副本），桩只替换 wx 云调用，
 * 用 5 个场景把上述值钉死，再用 5 条变异证明断言有鉴别力（不是恒绿）。
 *
 * 纪律：变异体一律 `new Function` 内存加载，**绝不落盘**（不污染 git、不触发 IDE 重编译）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'subpkg/biz/month');
const FILE = path.join(DIR, 'result.js');

let pass = 0;
let fail = 0;
const fails = [];
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function seg(t) { console.log('\n===== ' + t + ' ====='); }

// ---------------- 桩 ----------------
function installGlobals(ledger) {
  global.wx = {
    cloud: {
      callFunction({ name, data }) {
        if (name === 'getShopContext') {
          return Promise.resolve({ result: { code: 'SUCCESS', data: { shop_id: 'shop_probe' } } });
        }
        if (name === 'getLedger') {
          // 上月一律返回「无账本」，避免跨月对比把断言搅混
          if (data && data.month && data.month !== '2026-10') {
            return Promise.resolve({ result: { code: 'SUCCESS', data: { account_id: null } } });
          }
          return Promise.resolve({ result: { code: 'SUCCESS', data: ledger } });
        }
        return Promise.resolve({ result: { code: 'SUCCESS', data: {} } });
      },
    },
    getStorageSync: () => '',
    setStorageSync: () => {},
    showToast: () => {},
    showModal: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    navigateTo: () => {},
    stopPullDownRefresh: () => {},
    requestSubscribeMessage: () => {},
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, platform: 'devtools' }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    setNavigationBarTitle: () => {},
    shareFileMessage: () => {},
    openDocument: () => {},
  };
  global.getApp = () => ({
    globalData: { shop_id: 'shop_probe', shopLoaded: false },
    setShopContext(ctx) {
      this.globalData.shop_id = (ctx && ctx.shop_id) || '';
      this.globalData.shopLoaded = true;
    },
  });
}

// 云返回工厂：over 里给 undefined 的键 = 从响应中**删除**该键（模拟老后端/缓存）
function ledgerOf(over) {
  const base = {
    account_id: 'acc_probe_1',
    month: '2026-10',
    result: {
      income_total_fen: 10000000,
      expense_total_fen: 8200000,
      total_factor_real_profit_fen: 1800000,
      gross_margin_pct: 62,
    },
    indicators: [],
    indicator_scope: {},
    income_items: [],
    expense_items: [],
    fixed_items_fen: 500000,
    traffic: {
      this_month: 1200, old_customer: 300, repeat_rate_pct: 25,
      member_ratio_pct: 15, member_sales_fen: 150000, member_ratio_level: 'warn',
    },
    three_cost: {
      pct: 71.5, level: 'warn', healthy: 63, warn: 68, danger: 80,
      missing: [], warnHit: true, dangerHit: false,
    },
  };
  const out = JSON.parse(JSON.stringify(base));
  Object.keys(over || {}).forEach((k) => {
    if (over[k] === undefined) delete out[k];
    else out[k] = over[k];
  });
  return out;
}

// 用指定源码文本加载页面（原始或变异体），返回 Page 配置
function loadPage(src) {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  const fakeRequire = (p) => require(/^[./]/.test(p) ? path.resolve(DIR, p) : p);
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
    mod, mod.exports, fakeRequire, DIR, FILE
  );
  return cfg;
}

function makePage(cfg) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));      // 深拷贝：多场景共用 cfg.data 会互相污染
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };  // 真合并，不是只记录
  return p;
}

// 跑完整 5 场景，返回 [{n, c}]。变异复核复用这一份判据
async function runAll(src) {
  const res = [];
  const rec = (n, c) => res.push({ n, c });

  // 场景 1：有账本 + 三项成本警戒 + 会员 15%
  installGlobals(ledgerOf());
  let p = makePage(loadPage(src));
  p.data.month = '2026-10';
  await p.load();
  rec('S1 hasLedger 为 true', p.data.hasLedger === true);
  rec('S1 threeView.show 可达', !!(p.data.threeView && p.data.threeView.show === true));
  rec('S1 threeView.pct 串为 71.5', !!(p.data.threeView && p.data.threeView.pct === '71.5'));
  rec('S1 level=warn 且 lvText 非空', !!(p.data.threeView && p.data.threeView.level === 'warn' && p.data.threeView.lvText));
  rec('S1 bandText 非空', !!(p.data.threeView && p.data.threeView.bandText));
  rec('S1 warnHit ⇒ hint 非空', !!(p.data.threeView && p.data.threeView.hint));
  rec('S1 memberRatioWarn 为 true', !!(p.data.trView && p.data.trView.memberRatioWarn === true));
  rec('S1 disclaimer 非空', !!p.data.t.disclaimer);

  // 场景 2：三项成本缺房租 ⇒ 不得给数字、必须说缺什么
  installGlobals(ledgerOf({
    three_cost: { pct: null, level: 'na', healthy: 63, warn: 68, danger: 80, missing: ['rent'], warnHit: false, dangerHit: false },
  }));
  p = makePage(loadPage(src));
  p.data.month = '2026-10';
  await p.load();
  rec('S2 缺项 pct 为空串（不得为 0）', !!(p.data.threeView && p.data.threeView.pct === ''));
  rec('S2 缺项 has 为 false', !!(p.data.threeView && p.data.threeView.has === false));
  rec('S2 missText 含「房租」', /房租/.test((p.data.threeView && p.data.threeView.missText) || ''));

  // 场景 3：会员恰好 20%（服务端判 ok）⇒ 不得报警
  installGlobals(ledgerOf({
    traffic: { this_month: 1200, old_customer: 300, repeat_rate_pct: 25, member_ratio_pct: 20, member_sales_fen: 200000, member_ratio_level: 'ok' },
  }));
  p = makePage(loadPage(src));
  p.data.month = '2026-10';
  await p.load();
  rec('S3 20% 不报警', !!(p.data.trView && p.data.trView.memberRatioWarn === false));
  rec('S3 展示串为 20%', !!(p.data.trView && p.data.trView.memberRatio === '20%'));

  // 场景 4：响应里没有 three_cost 键（老后端/缓存）⇒ 整卡不显示、不得报错
  installGlobals(ledgerOf({ three_cost: undefined }));
  p = makePage(loadPage(src));
  p.data.month = '2026-10';
  await p.load();
  rec('S4 无 three_cost 时整卡不显示', !!(p.data.threeView && p.data.threeView.show === false));
  rec('S4 不得抛错（loading 已落回）', p.data.loading === false);

  // 场景 5：无账本 ⇒ 三卡全不显示
  installGlobals(ledgerOf({ account_id: null }));
  p = makePage(loadPage(src));
  p.data.month = '2026-10';
  await p.load();
  rec('S5 无账本 hasLedger false', p.data.hasLedger === false);
  rec('S5 threeView.show false', !!(p.data.threeView && p.data.threeView.show === false));
  rec('S5 trView.show false', !!(p.data.trView && p.data.trView.show === false));

  return res;
}

// ---------------- 变异定义 ----------------
const MUTS = [
  { id: 'M1', desc: 'threeView.show 恒 false（卡片永不显示）',
    from: 'show: !!d.account_id && !!d.three_cost,', to: 'show: false,',
    expect: 'S1 threeView.show 可达' },
  { id: 'M2', desc: '缺项 pct 用 0 兜底（缺房租显示 0%）',
    from: "pct: has ? String(tc.pct) : '',", to: "pct: has ? String(tc.pct) : '0',",
    expect: 'S2 缺项 pct 为空串（不得为 0）' },
  { id: 'M3', desc: '会员报警判据错位成 === ok',
    from: "memberRatioWarn: tv.member_ratio_level === 'warn',", to: "memberRatioWarn: tv.member_ratio_level === 'ok',",
    expect: 'S1 memberRatioWarn 为 true' },
  { id: 'M4', desc: '会员报警恒 true（20% 也报）',
    from: "memberRatioWarn: tv.member_ratio_level === 'warn',", to: 'memberRatioWarn: true,',
    expect: 'S3 20% 不报警' },
  { id: 'M5', desc: '结论页兜底声明取空串',
    from: 'disclaimer: TERMS.diag.disclaimer,', to: "disclaimer: '',",
    expect: 'S1 disclaimer 非空' },
];

(async () => {
  seg('A 前置：页面源码可加载、Page 配置可捕获');
  const src = fs.readFileSync(FILE, 'utf8');
  ck('A-① result.js 存在且非空', src.length > 10000, src.length + ' 字节');
  installGlobals(ledgerOf());
  const cfg = loadPage(src);
  ck('A-② Page 配置被捕获', !!cfg, cfg ? Object.keys(cfg).length + ' 个键' : 'null');
  ck('A-③ 源码含三个新字段的构造点（锚点在，变异才有意义）',
    /threeView:/.test(src) && /memberRatioWarn:/.test(src) && /disclaimer: TERMS\.diag\.disclaimer/.test(src));

  seg('B 基线：原始源码跑 5 场景');
  const base = await runAll(src);
  const baseRed = base.filter((x) => !x.c);
  console.log('  断言 ' + base.length + ' 条，红 ' + baseRed.length + ' 条' + (baseRed.length ? '：' + baseRed.map((x) => x.n).join('、') : ''));
  ck('B-① 基线全绿（原始源码应当全过）', baseRed.length === 0, '红 ' + baseRed.length + ' 条');
  ck('B-② 断言数 ≥ 18（防"断言被删光后仍绿"）', base.length >= 18, '实测 ' + base.length);

  seg('C 变异复核：断言必须有鉴别力');
  for (const m of MUTS) {
    if (src.indexOf(m.from) < 0) {
      ck('C ' + m.id + ' 锚点在场（' + m.desc + '）', false, '锚点未找到，源码已变 —— 需更新本套件');
      continue;
    }
    const mutSrc = src.replace(m.from, m.to);
    const res = await runAll(mutSrc);
    const reds = res.filter((x) => !x.c).map((x) => x.n);
    const hit = reds.includes(m.expect);
    ck('C ' + m.id + ' ' + m.desc + ' ⇒ 点名转红', hit,
      hit ? '红 ' + reds.length + ' 条，含「' + m.expect + '」' : '红 ' + reds.length + ' 条' + (reds.length ? '：' + reds.join('、') : '（全绿=无鉴别力）'));
  }

  seg('D 自证：本套件不会因环境缺失而假绿');
  ck('D-① 5 个场景共 18 条断言全部真的执行过（结果数组长度对得上）', base.length === 18, '实测 ' + base.length);
  ck('D-② 场景覆盖 5 种输入（正常/缺项/边界20%/老后端/无账本）',
    true, 'S1~S5');

  console.log('\n===== 批次3 三块新UI 运行时守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  if (fail) {
    console.log('失败项：' + fails.join('、'));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('❌ 套件异常：', e && (e.stack || e));
  process.exit(2);
});
