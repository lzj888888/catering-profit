#!/usr/bin/env node
// tools/check_ai_consent_page.js —— R1-5（台账 P1）AI 授权同意页行为守卫
//
// 为什么需要它：`subpkg/biz/ai/consent` 是**合规页**（AI 数据处理授权），
//   全仓 234 个 tools 里对它的提及只有两处**注释**（check_comment_safety / check_release_checklist），
//   **零行为守卫** —— 也就是说「老板点了同意，到底同意了哪几项、同意的是哪版条款」这件事
//   从没有任何机器在看。这比算错钱更严重：算错钱老板能看见，授权错了没人能看见。
//
// 它最容易出的四种静默失效（都不报错、界面还挺正常）：
//   ① 判「已开」去读 `state` 枚举字符串 ⇒ 枚举一改名，页面永远显示「未开」，
//      老板反复点同意、后台其实早已生效（或反之：显示已开、服务端判无授权，AI 全拒）。
//      正解是用**权限本身**（effective_scope 是否有值）作判据。
//   ② grant 不带 `policy_version` ⇒ 服务端无法区分「旧条款的同意」，条款改了也照样放行
//     （合规上等于没有重新同意）；或反过来页面硬编码版本号 ⇒ 条款一升级，页面签的是旧版本。
//   ③ `policy_version_now` 拿不到（接口失败/字段改名）时**仍然发 grant** ⇒ 记录了一条无版本的空同意。
//   ④ busy 不拦 ⇒ 连点两下产生两条授权记录（`idx_ai_consent_user_shop` 是 unique，直接写失败）。
//
// 取证层级：L2 页面桩（真跑页面源码，Page/wx/api 全桩，不复制任何判断逻辑）。
//   ⚠️ 它不能替代真机：验的是「数据怎么决定状态与按钮」，不是「界面好不好看」。
//
// 运行：node tools/check_ai_consent_page.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/ai/consent.js');
const WXML = path.join(ROOT, 'subpkg/biz/ai/consent.wxml');
const GATE = path.join(ROOT, 'cloudfunctions/common/aiGate.js');
const TERMS_SRC = path.join(ROOT, 'miniprogram/i18n/terms.js');
const { TERMS } = require(TERMS_SRC);
const T_AC = TERMS.aiConsent || {};

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 桩：Page / wx / getApp / utils/api ----------
let cfg = null;
let apiCalls = [];
let consentResp = {};
let apiShouldThrow = false;
let lastToast = null;

const mockApi = {
  call: async (name, params) => {
    apiCalls.push({ name: name, params: params });
    if (apiShouldThrow && name === 'getAiConsent') throw new Error('stub: 网络不可用');
    if (name === 'getAiConsent') return consentResp;
    return {};
  },
};

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = {
  showToast: (o) => { lastToast = o; },
  getStorageSync: () => '', setStorageSync: () => {},
  navigateTo: () => {}, cloud: { callFunction: async () => ({}) },
};

const MOCKS = { '../../../utils/api.js': mockApi };
function makeRequire(baseDir) {
  return function (req) {
    if (MOCKS[req]) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
function loadCfg(srcOverride) {
  const src = srcOverride || fs.readFileSync(PAGE, 'utf8');
  cfg = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用，consent.js 结构可能已变');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() { apiCalls = []; consentResp = {}; apiShouldThrow = false; lastToast = null; }

(async () => {
  console.log('[R1-5] AI 授权同意页行为守卫（桩 Page/wx/api，真跑页面源码）');

  const PAGE_SRC = fs.readFileSync(PAGE, 'utf8');
  const WXML_SRC = fs.readFileSync(WXML, 'utf8');

  // ===== A 授权态判定：用权限本身，不认枚举字符串 =====
  sec('A · 授权态判定（判据必须是 effective_scope，不是 state 枚举）');
  loadCfg();

  reset();
  consentResp = { effective_scope: [], policy_version_now: 'v3', policy_stale: false };
  let p = fresh(cfg);
  await p.load();
  check('A-① 未授权（effective_scope=[]）⇒ granted=false / scopeCount=0',
    p.data.granted === false && p.data.scopeCount === 0,
    'granted=' + p.data.granted + ' count=' + p.data.scopeCount);

  reset();
  consentResp = { effective_scope: ['diagnose'], policy_version_now: 'v3', policy_stale: false };
  p = fresh(cfg);
  await p.load();
  check('A-② 已授权一项 ⇒ granted=true / scopeCount=1',
    p.data.granted === true && p.data.scopeCount === 1,
    'granted=' + p.data.granted + ' count=' + p.data.scopeCount);

  reset();
  // 🔴 核心反恒真腿：枚举说「已开」，但权限列表是空的 ⇒ 必须判未授权
  consentResp = { state: 'active', effective_scope: [], policy_version_now: 'v3' };
  p = fresh(cfg);
  await p.load();
  check('A-③ 🔴 state 枚举说已开、但 effective_scope 为空 ⇒ granted 必须 false（不认枚举，只认权限）',
    p.data.granted === false, 'granted=' + p.data.granted);

  reset();
  consentResp = { effective_scope: ['pricing'], policy_version_now: 'v3', policy_stale: true };
  p = fresh(cfg);
  await p.load();
  check('A-④ 有权限 + policy_stale ⇒ 已开且需重新确认（stale=true）',
    p.data.granted === true && p.data.stale === true,
    'granted=' + p.data.granted + ' stale=' + p.data.stale);

  reset();
  consentResp = { effective_scope: null, policy_version_now: 'v3' };
  p = fresh(cfg);
  let aErr = null;
  try { await p.load(); } catch (e) { aErr = e; }
  check('A-⑤ 后端字段缺失/非数组（effective_scope=null）⇒ 不崩，判未授权',
    aErr === null && p.data.granted === false,
    aErr ? (aErr.message || String(aErr)) : 'granted=' + p.data.granted);

  reset();
  apiShouldThrow = true;
  p = fresh(cfg);
  let cErr = null;
  try { await p.load(); } catch (e) { cErr = e; }
  check('A-⑥ 🔴 接口失败 ⇒ 不崩、loading 收起、给一句人话提示（不能白屏）',
    cErr === null && p.data.loading === false && !!lastToast && lastToast.title === T_AC.loadFail,
    cErr ? (cErr.message || String(cErr)) : 'toast=' + (lastToast && lastToast.title));

  // ===== B grant 必须带 policy_version_now（不硬编码） =====
  sec('B · 同意必须回传当前条款版本；拿不到版本就不许发');

  reset();
  // 拿不到版本：接口回空串（字段改名/后端未配）
  consentResp = { effective_scope: [], policy_version_now: '' };
  p = fresh(cfg);
  await p.load();
  reset(); // 清掉 load 的调用记录
  lastToast = null;
  await p.grant();
  const grantCallsWhenNoVer = apiCalls.filter((c) => c.name === 'grantAiConsent');
  check('B-① 🔴 拿不到 policy_version_now ⇒ 绝不发 grant（只提示）',
    grantCallsWhenNoVer.length === 0 && !!lastToast,
    'grant 调用数=' + grantCallsWhenNoVer.length);
  check('B-①b 且 busy 必须复位（否则按钮永久灰）', p.data.busy === false, 'busy=' + p.data.busy);

  reset();
  consentResp = { effective_scope: [], policy_version_now: 'v2026-11' };
  p = fresh(cfg);
  await p.load();
  reset();
  await p.grant();
  const g = apiCalls.filter((c) => c.name === 'grantAiConsent')[0];
  check('B-② 有版本号 ⇒ 调 grantAiConsent 且 policy_version 原样回传',
    !!g && g.params && g.params.policy_version === 'v2026-11',
    g ? JSON.stringify(g.params) : '未调用');

  // 三项口径与云函数 aiGate.PURPOSES 同源（同源=逐项有序比对，不手抄）
  const gateSrc = fs.readFileSync(GATE, 'utf8');
  const gm = /const PURPOSES = \[([^\]]+)\]/.exec(gateSrc);
  const GATE_PURPOSES = gm ? gm[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
  const sent = (g && g.params && Array.isArray(g.params.scope)) ? g.params.scope : [];
  check('B-③ 🔴 送出去的 scope 三项 ≡ 云函数 aiGate.PURPOSES（同源，不另立枚举）',
    sent.length === 3 && GATE_PURPOSES.length === 3 && sent.every((v, i) => v === GATE_PURPOSES[i]),
    '页面=' + JSON.stringify(sent) + ' 云=' + JSON.stringify(GATE_PURPOSES));

  reset();
  consentResp = { effective_scope: ['diagnose'], policy_version_now: 'v2026-11' };
  p = fresh(cfg);
  await p.load();
  reset();
  await p.onToggle(); // granted=true ⇒ 应走 revoke
  check('B-④ 已授权时点主按钮 ⇒ 走 revokeAiConsent（不是再 grant）',
    apiCalls.filter((c) => c.name === 'revokeAiConsent').length === 1
    && apiCalls.filter((c) => c.name === 'grantAiConsent').length === 0,
    apiCalls.map((c) => c.name).join(',') || '无调用');

  reset();
  consentResp = { effective_scope: [], policy_version_now: 'v2026-11' };
  p = fresh(cfg);
  await p.load();
  reset();
  p.data.busy = true;
  await p.onToggle();
  check('B-⑤ 🔴 busy 时点按钮不得再发请求（连点会产生重复授权记录）',
    apiCalls.length === 0, '调用数=' + apiCalls.length);

  reset();
  consentResp = { effective_scope: [], policy_version_now: 'v2026-11' };
  p = fresh(cfg);
  await p.load();
  reset();
  consentResp = { effective_scope: ['diagnose', 'pricing', 'expand'], policy_version_now: 'v2026-11' };
  await p.grant();
  check('B-⑥ 同意成功后重新拉一次状态（按钮/徽标要变，不能停在旧态）',
    p.data.granted === true && p.data.scopeCount === 3,
    'granted=' + p.data.granted + ' count=' + p.data.scopeCount);

  // ===== C 界面契约与文案覆盖 =====
  sec('C · 界面契约（三态文案 / 禁用态 / 文案 key 全覆盖 / 无死引用）');

  const termKeys = Object.keys(TERMS.aiConsent || {});
  const dataTKeys = Object.keys((cfg.data && cfg.data.t) || {});
  const missing = termKeys.filter((k) => !dataTKeys.includes(k));
  const extra = dataTKeys.filter((k) => k !== 'navTitle' && !termKeys.includes(k));
  check('C-① 词条全覆盖：TERMS.aiConsent 的每个 key 都喂进了 data.t（漏登=界面静默空白）',
    missing.length === 0, '缺=' + JSON.stringify(missing) + ' 词条总数=' + termKeys.length);
  check('C-② data.t 没有凭空多出的 key（拼错=永远显示 undefined）',
    extra.length === 0, '多=' + JSON.stringify(extra));

  const tRefs = [];
  const tRe = /\bt\.([A-Za-z0-9_]+)/g;
  let tm;
  while ((tm = tRe.exec(WXML_SRC))) tRefs.push(tm[1]);
  const uniqRefs = Array.from(new Set(tRefs));
  const deadRefs = uniqRefs.filter((k) => !dataTKeys.includes(k));
  check('C-③ WXML 里引用的 t.xxx 全部真实存在于 data.t（死引用=空白）',
    deadRefs.length === 0, '死引用=' + JSON.stringify(deadRefs) + ' 引用数=' + uniqRefs.length);

  check('C-④ 按钮文案三态（已开→撤销 / 条款更新→重新同意 / 未开→同意）',
    /granted\s*\?\s*t\.btnRevoke\s*:\s*\(?\s*stale\s*\?\s*t\.btnReagree\s*:\s*t\.btnGrant/.test(WXML_SRC.replace(/\s+/g, ' ')),
    '');
  check('C-⑤ 按钮 disabled 绑 busy（请求中二次点击必须被拦）',
    /disabled="\{\{\s*busy\s*\}\}"/.test(WXML_SRC));
  check('C-⑥ 徽标三态类（ok / warn / na）',
    /granted\s*\?\s*'ok'\s*:\s*\(\s*stale\s*\?\s*'warn'\s*:\s*'na'\s*\)/.test(WXML_SRC.replace(/\s+/g, ' ')));
  check('C-⑦ 页面源码不得硬编码条款版本号（必须用接口回的 policy_version_now）',
    !/policy_version\s*:\s*['"][^'"]+['"]/.test(PAGE_SRC) && /policy_version:\s*this\._policyNow/.test(PAGE_SRC));

  // ===== D 变异回灌：证明上面每条都有分辨力（必须 exit=1 且点名） =====
  sec('D · 变异回灌（把修复点改坏，A/B 组必须真的转红）');

  async function mutRun(label, from, to, expectFailName, runFn) {
    if (PAGE_SRC.indexOf(from) < 0) {
      console.log('  ❌ ' + label + ' 变异锚点漂移，无法回灌：' + from);
      failN++; return;
    }
    const mutated = PAGE_SRC.replace(from, to);
    if (mutated === PAGE_SRC) {
      console.log('  ❌ ' + label + ' 变异未生效（replace 未改动）');
      failN++; return;
    }
    let mc = null;
    try { mc = loadCfg(mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后页面加载失败（FATAL，非真红）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try {
      const r = await runFn(mc);
      degraded = !!r.degraded; detail = r.detail || '';
    } catch (e) {
      degraded = true; detail = '变异后抛错：' + ((e && e.message) || e);
    }
    check(label + ' ⇒ 检出「' + expectFailName + '」退化', degraded, detail);
    loadCfg(); // 还原全局 cfg
  }

  // D-1：把「认权限」改成「认枚举」 ⇒ A-③ 必须退化
  await mutRun('D-1 判据改回 state 枚举', 'granted: eff.length > 0,', 'granted: !!d.state,',
    'A-③ 枚举态冒充授权', async (mc) => {
      reset();
      consentResp = { state: 'active', effective_scope: [], policy_version_now: 'v3' };
      const mp = fresh(mc);
      await mp.load();
      return { degraded: mp.data.granted === true, detail: 'granted=' + mp.data.granted };
    });

  // D-2：删掉「拿不到版本就不发」 ⇒ B-① 必须退化
  await mutRun('D-2 去掉版本号守卫', 'if (!this._policyNow) {', 'if (false) {',
    'B-① 无版本也发 grant', async (mc) => {
      reset();
      consentResp = { effective_scope: [], policy_version_now: '' };
      const mp = fresh(mc);
      await mp.load();
      reset();
      await mp.grant();
      const n = apiCalls.filter((c) => c.name === 'grantAiConsent').length;
      return { degraded: n > 0, detail: '无版本时 grant 调用数=' + n };
    });

  // D-3：scope 少一项 ⇒ B-③ 必须退化
  await mutRun('D-3 scope 减一项', "const SCOPES = ['diagnose', 'pricing', 'expand'];", "const SCOPES = ['diagnose', 'pricing'];",
    'B-③ scope 与 PURPOSES 不同源', async (mc) => {
      reset();
      consentResp = { effective_scope: [], policy_version_now: 'v2026-11' };
      const mp = fresh(mc);
      await mp.load();
      reset();
      await mp.grant();
      const call = apiCalls.filter((c) => c.name === 'grantAiConsent')[0];
      const sc = (call && call.params && call.params.scope) || [];
      return { degraded: sc.length !== GATE_PURPOSES.length, detail: '送出=' + JSON.stringify(sc) };
    });

  // D-4：去掉 busy 闸 ⇒ B-⑤ 必须退化
  await mutRun('D-4 去掉 busy 闸', 'if (this.data.busy) return;', 'if (false) return;',
    'B-⑤ 连点重复请求', async (mc) => {
      reset();
      consentResp = { effective_scope: [], policy_version_now: 'v2026-11' };
      const mp = fresh(mc);
      await mp.load();
      reset();
      mp.data.busy = true;
      await mp.onToggle();
      return { degraded: apiCalls.length > 0, detail: 'busy 时调用数=' + apiCalls.length };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
