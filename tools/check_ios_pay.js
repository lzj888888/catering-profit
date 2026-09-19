// tools/check_ios_pay.js —— R45 · iOS 虚拟支付入口守卫
// 运行： node tools/check_ios_pay.js
//
// 背景（复审方 round22 登记 R45，2026-09-19 本轮收口）：
//   本工具付费内容是「开通真实利润」时效套餐 = **虚拟商品**。微信小程序 **iOS 端不得提供虚拟商品的
//   购买支付入口**。此前 iOS 过滤"零实现"（只存在于 `payCreateOrder` 的注释里），
//   复审方要求：上线前**要么实现、要么明确不做**。本轮选择「实现」（`utils/platform.js` + 两处入口拦截）。
//
// 规则（一条主体规则 P1 + 两条自失效护栏 S1/S2 + 一组规则自证 N1/N2）：
//   P1 前端层文件一旦出现**发起支付**动作（`payCreateOrder` / `payRenew`），
//      该文件必须出现 iOS 判定调用 `isIOS`；否则视为「iOS 用户也能下单」⇒ 判红。
//      确需豁免的，须在本行或上一行写  /* ios-pay-ok: <理由> */ （理由必填，便于回溯谁担责）。
//
// 为什么不验"后端拦不拦"：
//   客户端 platform 不可信，后端据此拦截等于把合规边界交给可篡改入参；
//   真正的约束是「iOS 用户看不到入口」。与 `tools/check_compliance.js`（R42）同源政策。
//
// 边界（明写，别高估本守卫）：
//   · 只证「文件里做了 iOS 判断」，**证不了运行时真挡住** —— 运行时由 `utils/paywall.js`
//     与 `pages/pay/orders.js` 的二次拦截保证（纵深），二者互补，缺一不可。
//   · 只扫 `pages/` `utils/` `app.js`；云函数侧（`cloudfunctions/`）按政策**有意不拦**，不在扫描面。
(function () {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name + (detail ? ' · ' + detail : '')); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }

  // ---------- 常量 ----------
  const SCAN_DIRS = ['pages', 'utils'];
  const SCAN_FILES = ['app.js'];
  // ⚠️ 只认**调用形态**，不认裸函数名：注释/文档里出现 "payRenew" 不算支付入口
  //    （第一版用裸名 `line.includes('payCreateOrder')`，把 3 处注释全判成未过滤 —— 那是守卫误报，
  //     按纪律"不许改代码迎合守卫"，修的是本文件的匹配形态，不是被扫的业务代码）。
  const PAY_ACT = [
    { name: 'payCreateOrder', re: /(api\.call\(\s*['"]payCreateOrder|name\s*:\s*['"]payCreateOrder|\bpayCreateOrder\s*\()/ },
    { name: 'payRenew', re: /(api\.call\(\s*['"]payRenew|name\s*:\s*['"]payRenew|\bpayRenew\s*\()/ },
  ];
  const IOS_GUARD = /\bisIOS\s*\(/;                  // iOS 判定调用
  const EXEMPT_RE = /ios-pay-ok\s*:\s*\S+/;          // 豁免（理由必填）

  const indentOf = (s) => (s.match(/^\s*/) || [''])[0].length;

  /**
   * 找调用行所在**函数体**的起始行（往上回溯到缩进更小的函数头）。
   * ⚠️ 为什么不是"调用行 ±1 行"：真实拦截写在函数开头（早退返回），离调用几十行，
   *    相邻行判据会把"正确实现了纵深拦截"的代码误判成没做 —— 那是误报，不是缺陷。
   *    判到**函数体级**才既抓得住漏网、又不冤枉正确写法。
   */
  function enclosingStart(lines, idx) {
    const cur = indentOf(lines[idx]);
    for (let i = idx - 1; i >= 0; i--) {
      const l = lines[i];
      const isHead = /\bfunction\b/.test(l)
        || /(async\s+)?[\w$]+\s*\([^)]*\)\s*\{/.test(l)
        || /=>\s*\{/.test(l);
      if (isHead && indentOf(l) < cur) return i;
    }
    return 0; // 退化：从文件头到调用行
  }

  /** 单文件规则：命中支付动作 ⇒ 其所在函数体内必须有 iOS 判定或带理由的豁免。返回 {hit, ok, why} */
  function judge(src) {
    const lines = src.split(/\r?\n/);
    let hit = 0, ok = true, why = '';
    lines.forEach((line, i) => {
      const act = PAY_ACT.find((a) => a.re.test(line));
      if (!act) return;
      hit++;
      const from = enclosingStart(lines, i);
      const scope = lines.slice(from, i + 1).join('\n');
      if (IOS_GUARD.test(scope)) return;
      if (EXEMPT_RE.test(scope)) return;
      ok = false;
      why = why || `${act.name} 调用于第 ${i + 1} 行，其所在函数体（第 ${from + 1}~${i + 1} 行）内未见 isIOS() 判定，也无 ios-pay-ok 豁免`;
    });
    return { hit, ok, why };
  }

  // ---------- N1/N2 · 规则自证（防止"恒绿"或"恒红"两种腐化）----------
  console.log('===== N · 规则自证（正负样本互证）=====');
  const posSample = [
    "// 正面样本：有支付动作 + 有 iOS 判定",
    "async function onRenew() {",
    "  if (isIOS()) { return; }",
    "  await api.call('payRenew', { plan_id: 'plan_basic_month' });",
    "}",
  ].join('\n');
  const negSample = [
    "// 负面样本：有支付动作，但没有任何 iOS 判定",
    "async function onRenew() {",
    "  await api.call('payRenew', { plan_id: 'plan_basic_month' });",
    "}",
  ].join('\n');
  const posRes = judge(posSample);
  const negRes = judge(negSample);
  check('N1 正面样本（有 isIOS 判定）应放行', posRes.hit > 0 && posRes.ok === true,
    '命中支付动作 ' + posRes.hit + ' 处，判定 = 放行');
  check('N2 负面样本（无 isIOS 判定）应判红', negRes.hit > 0 && negRes.ok === false,
    '理由：' + negRes.why);

  // ---------- 扫描面 ----------
  function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(js|wxml|json)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  for (const f of SCAN_FILES) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) files.push(abs);
  }
  const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

  console.log('\n===== S · 自失效护栏 =====');
  check('S1 扫描面非空', files.length >= 1, 'pages/ + utils/ + app.js 共 ' + files.length + ' 个文件');

  // ---------- P1 ----------
  const hitFiles = [];
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const r = judge(txt);
    if (r.hit > 0) hitFiles.push({ rel: rel(f), ...r });
  }
  // S2：命中数下限 —— 若支付动作改名/被删导致零命中，说明守卫已空跑（静默失效）⇒ 判红。
  //     ⚠️ 下限取 2 = 本轮实测的两个真实入口（utils/paywall.js 下单 + pages/pay/orders.js 续费）；
  //        新增入口只会让数字变大，**不会**让本条失去意义（它是下限，不是相等）。
  check('S2 支付入口命中数 ≥ 2（防支付动作改名/被删导致守卫空跑）', hitFiles.length >= 2,
    '实测命中 ' + hitFiles.length + ' 个文件：' + hitFiles.map((x) => x.rel).join(' , '));

  console.log('\n===== P1 · 支付入口须做 iOS 过滤 =====');
  for (const h of hitFiles) {
    check('P1 ' + h.rel + ' 已做 iOS 过滤', h.ok, h.ok ? '含 isIOS() 判定或已带理由豁免' : h.why);
  }

  console.log('\n===== iOS 虚拟支付守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    console.log('\n修复指引：在支付动作所在行（或上一行）加上 iOS 判定，例如：');
    console.log("  if (isIOS()) { return; }   // 引入：const { isIOS } = require('../utils/platform.js');");
    console.log("确属非支付入口的，写： /* ios-pay-ok: <理由> */");
  }
  process.exit(failN === 0 ? 0 : 1);
})();
