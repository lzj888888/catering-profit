#!/usr/bin/env node
// tools/check_m2_reverse_rent.js —— M2「选址反推 · 房租不重复计租」口径守卫（R221 · 批次 M2v1.1）
//
// 为什么需要它（反推分支的**头号口径陷阱**）：
//   反推 = 「房租 = 营收 × 目标租金率」⇒ 房租在反推里是**随营业额变动的费用**（同外卖佣金性质），
//   所以入参变换必须把 `rent` 从 `fixed_items` **剔除**、再追加「目标租金率」这挂钩费率。
//   🔴 一旦两处都留着（用户按正算习惯填了房租 + 又填了租金率）⇒ **房租被算两遍** ⇒
//      R 从 100,000 虚高到 125,000（+25,000 = 12,000 ÷ 0.48）—— 用户拿这个数去签租约就是踩坑。
//
//   同族病（本仓历史）：**规范里写了「🔴 不得含 rent」，却没有机器判据** ⇒ 后人重构时静默失效。
//   本条守卫按规范 §11 的四条判据落地（① 解析**函数体**防注释假绿 ② 变换层必须 filter ③ 反恒真锚点
//   ④ 自失效护栏：扫描面下界 + 正负样本互证）。
//
// 判据（P/A/B/C/D 五段，全部 fail-closed：读不到 / 解析不到即判红，不许静默放行）：
//   P 前置  三个面文件可读；`calcSandboxReverse` 与 `validateInput` 的**函数体可解析**
//           （解析不到必须在此判红，否则 A 段会因"找不到函数"而静默变绿）
//   A 主判据 ① `service.js` 反推函数体（**剥注释后**）必须同时出现 `filter(` 与 `'rent'`
//             —— 剥注释是刻意的：防"注释里写了 filter rent、代码里没做"
//           ② `validate.js` 的 `validateInput` 函数体内必须同时出现 `isReverse` 与 `rent`
//   B 反恒真正锚点 用**生产引擎**实跑：R = 10,000,000 分 / 房租上限 = 1,200,000 分
//           ＋ `open_days=26` 时日均 = R/26（专打「÷30 硬编码」）
//   C 反证＋契约 错误变换（不剔 rent）必须得 12,500,000 ≠ 10,000,000（证明"剔除"这一步真改变结果）
//           ＋ validate 反推含 rent ⇒ 拒 / 缺 open_days ⇒ 拒 / 红警 ⇒ 全 null / 缺省 mode ⇒ forward
//   D 护栏   剥注释器 + `hasRentDrop` 判别器的**正负样本互证**（证明 A 段不是恒真）+ 断言数下界
//
// 运行：node tools/check_m2_reverse_rent.js   （由 verify_all.js 的 [m2-reverse-rent] 套件调用）

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const svcPath = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js');
const valPath = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'validate.js');
const stPath = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'selftest.js');

let pass = 0, failN = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { failN++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
};
const sec = (t) => console.log('\n===== ' + t + ' =====');
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// ---------- 引号感知剥注释器（防"注释里写了实现、代码里没有"）----------
function stripComments(src) {
  let out = '', i = 0, n = src.length, st = null;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (st) {
      out += c;
      if (c === '\\') { out += (d || ''); i += 2; continue; }
      if (c === st) st = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { st = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// ---------- bodyOf：锚**定义**不锚调用 ----------
function bodyOf(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index;
  const rest = src.slice(start + 1);
  const nxt = /\n(?:function\s+[A-Za-z_$][\w$]*\s*\(|module\.exports)/.exec(rest);
  const end = nxt ? start + 1 + nxt.index : src.length;
  return src.slice(start, end);
}

// ---------- hasRentDrop：反推变换层的判别器 ----------
function hasRentDrop(body) {
  if (!body) return false;
  return /filter\s*\(/.test(body) && /["']rent["']/.test(body);
}

// ============ P 前置（读不到 / 解析不到 ⇒ 在此判红）============
sec('P 前置：三个面文件可读 + 两个函数体可解析');
const svcRaw = readOr(svcPath), valRaw = readOr(valPath), stRaw = readOr(stPath);
check('P-① 三个面文件均可读（service / validate / selftest）',
  !!svcRaw && !!valRaw && !!stRaw,
  `service=${svcRaw ? svcRaw.length : 'null'} validate=${valRaw ? valRaw.length : 'null'} selftest=${stRaw ? stRaw.length : 'null'}`);

const svcCode = svcRaw ? stripComments(svcRaw) : '';
const valCode = valRaw ? stripComments(valRaw) : '';
const revBody = svcCode ? bodyOf(svcCode, 'calcSandboxReverse') : null;
const valBody = valCode ? bodyOf(valCode, 'validateInput') : null;
check('P-② calcSandboxReverse 函数体可解析且非退化（≥400 字符）',
  !!revBody && revBody.length >= 400, revBody ? revBody.length + ' 字符' : 'null');
check('P-③ validateInput 函数体可解析且非退化（≥800 字符）',
  !!valBody && valBody.length >= 800, valBody ? valBody.length + ' 字符' : 'null');

// ============ A 主判据（剥注释后的**函数体**内）============
sec('A 主判据：两道防线（变换层剔 / 校验层拦）都在函数体里');
check('A-① service 反推函数体（剥注释后）含 rent 剔除（filter + rent 同现）',
  hasRentDrop(revBody),
  revBody ? `filter=${/filter\s*\(/.test(revBody)} rent=${/["']rent["']/.test(revBody)}` : 'body=null');
check('A-② validate 函数体（剥注释后）含反推 rent 拦截（isReverse + rent 同现）',
  !!valBody && /isReverse/.test(valBody) && /rent/.test(valBody),
  valBody ? `isReverse=${/isReverse/.test(valBody)} rent=${/rent/.test(valBody)}` : 'body=null');

// ============ B 反恒真：用生产引擎实跑钉锚点 ============
sec('B 反恒真锚点（require 生产引擎实跑，期望值我方自推）');
let svc = null, val = null;
try { svc = require(svcPath); } catch (e) { svc = null; }
try { val = require(valPath); } catch (e) { val = null; }
check('B-⓪ 生产 service / validate 可 require',
  !!(svc && typeof svc.calcSandboxReverse === 'function' && svc.calcSandbox)
  && !!(val && typeof val.validateInput === 'function'));

const REV_BASE = {
  mode: 'reverse', cityTier: 'tier23', bizType: 'dining', buildItems: [],
  grossMarginPct: 60, targetProfitFen: 2000000,
  rev_price_fen: 4500, seats: 20, target_rent_rate: 12, pixel_eff_fen: 4000,
};
const revA = svc ? svc.calcSandboxReverse(Object.assign({}, REV_BASE, {
  fixedItems: [{ key: 'labor', fen: 2800000 }], varItems: [], open_days: 30,
})) : {};
check('B-① 反推 R = 10,000,000 分（房租已被剔出固定成本）',
  revA.target_monthly_fen === 10000000, '=' + revA.target_monthly_fen);
check('B-② 房租上限 = 1,200,000 分（= R × 12%）',
  revA.rent_cap_fen === 1200000, '=' + revA.rent_cap_fen);

const revB = svc ? svc.calcSandboxReverse(Object.assign({}, REV_BASE, {
  fixedItems: [{ key: 'labor', fen: 2600000 }], varItems: [], open_days: 26,
})) : {};
check('B-③ open_days=26 ⇒ 日均 = R/26 = 368,590 分',
  revB.target_daily_fen === 368590, '=' + revB.target_daily_fen);
check('B-④ 日均**不是** ÷30 硬编码（÷30 会得 319,444）',
  revB.target_daily_fen !== Math.round(9583333 / 30), '实际 ' + revB.target_daily_fen + ' vs ÷30 得 ' + Math.round(9583333 / 30));
check('B-⑤ open_days=26 ⇒ 日均客流 = 81.91（÷26，不是 ÷30 的 70.99）',
  revB.daily_traffic === 81.91 && revB.daily_traffic !== Math.round(2129.6296 / 30 * 100) / 100,
  '=' + revB.daily_traffic);

// 🔴 B-⑥ 第二道防线的**独立行为**验证：即使校验层被绕过（直接调 service、不经 validate），
//   变换层也必须把 fixed_items 里的 rent 剔掉 ⇒ 结果与"根本没填 rent"完全一致。
//   （起因：R221 变异 M1 实测 —— selftest 的 J 段输入本来就不含 rent，行为上分不出"剔/不剔"，
//    只有这条直调才让"不剔"在**行为**上现形，而不只靠 A-① 的静态判据。）
const revWithRent = svc ? svc.calcSandboxReverse(Object.assign({}, REV_BASE, {
  fixedItems: [{ key: 'labor', fen: 2800000 }, { key: 'rent', fen: 1200000 }], varItems: [], open_days: 30,
})) : {};
check('B-⑥ 变换层免疫：fixed 里**真有 rent** 时 R 仍 = 10,000,000（被剔掉，不是 12,500,000）',
  revWithRent.target_monthly_fen === 10000000 && revWithRent.target_monthly_fen === revA.target_monthly_fen,
  '=' + revWithRent.target_monthly_fen + '（不剔会是 12,500,000）');

// ============ C 反证 ＋ 契约 ============
sec('C 反证（不剔 rent ⇒ R 虚高）＋ 入参契约');
const wrongFwd = svc ? svc.calcSandbox(Object.assign({}, REV_BASE, {
  fixedItems: [{ key: 'labor', fen: 2800000 }, { key: 'rent', fen: 1200000 }],
  varItems: [{ key: 'rentRate', pct: 12 }], open_days: 30,
})) : {};
check('C-① 反证：含 rent 的变换 ⇒ R = 12,500,000 ≠ 10,000,000（规则有鉴别力）',
  wrongFwd.target_monthly_fen === 12500000 && wrongFwd.target_monthly_fen !== revA.target_monthly_fen,
  '含 rent ' + wrongFwd.target_monthly_fen + ' vs 正确 ' + revA.target_monthly_fen);

const cReject = val ? val.validateInput({
  shop_id: 's', mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], var_items: [], gross_margin_pct: 60, target_profit_fen: 2000000,
  fixed_items: [{ key: 'rent', fen: 1200000 }, { key: 'labor', fen: 2800000 }],
  rev_price_fen: 4500, seats: 20, open_days: 30, target_rent_rate: 12,
}) : null;
check('C-② validate 反推 + fixed 含 rent ⇒ 拒（校验层拦）',
  !!cReject && !!cReject.error, cReject ? String(cReject.error) : 'null');

const cNoDays = val ? val.validateInput({
  shop_id: 's', mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], var_items: [], gross_margin_pct: 60, target_profit_fen: 2000000,
  fixed_items: [{ key: 'labor', fen: 2800000 }],
  rev_price_fen: 4500, seats: 20, target_rent_rate: 12,
}) : null;
check('C-③ validate 反推缺 open_days ⇒ 拒（fail-closed，不默认 30）',
  !!cNoDays && !!cNoDays.error, cNoDays ? String(cNoDays.error) : 'null');

const revRed = svc ? svc.calcSandboxReverse(Object.assign({}, REV_BASE, {
  fixedItems: [{ key: 'labor', fen: 2800000 }], varItems: [],
  open_days: 30, grossMarginPct: 30, target_rent_rate: 60,
})) : {};
check('C-④ 红警（边际 ≤ 0）⇒ R 与全部派生量为 null（不编造）',
  revRed.red_alert === true && revRed.target_monthly_fen === null
  && revRed.rent_cap_fen === null && revRed.daily_traffic === null && revRed.turn_rate === null,
  JSON.stringify([revRed.red_alert, revRed.target_monthly_fen, revRed.rent_cap_fen]));

const cFwd = val ? val.validateInput({
  shop_id: 's', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: [{ key: 'rent', fen: 1200000 }], var_items: [],
  gross_margin_pct: 65, target_profit_fen: 0,
}) : null;
check('C-⑤ 缺省 mode ⇒ forward（正算仍接受 rent，向后兼容）',
  !!cFwd && !cFwd.error && cFwd.clean.mode === 'forward',
  cFwd ? (cFwd.error ? String(cFwd.error) : String(cFwd.clean.mode)) : 'null');

const cBadMode = val ? val.validateInput({
  shop_id: 's', mode: 'sideways', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: [], var_items: [], gross_margin_pct: 65, target_profit_fen: 0,
}) : null;
check('C-⑥ mode 非法值 ⇒ 拒（白名单，不静默当正算）',
  !!cBadMode && !!cBadMode.error, cBadMode ? String(cBadMode.error) : 'null');

// ============ D 自失效护栏 ============
sec('D 自失效护栏：剥注释器 + 判别器正负样本互证 + 断言数下界');
const posBody = bodyOf(stripComments("function f(c){ return arr(c.fixedItems).filter(function(x){ return x && x.key !== 'rent'; }); }"), 'f');
const negBody = bodyOf(stripComments("function f(c){ /* filter(x => x.key !== 'rent') */ return arr(c.fixedItems); }"), 'f');
check('D-① 剥注释器 + hasRentDrop 正负样本互证（实现 ⇒ 命中 / 注释 ⇒ 不命中）',
  hasRentDrop(posBody) === true && hasRentDrop(negBody) === false,
  `正样本=${hasRentDrop(posBody)} 负样本=${hasRentDrop(negBody)}`);
check('D-② 扫描面非空：反推函数体真实存在且 > validate 之外的独立切片',
  !!revBody && !!valBody && revBody !== valBody,
  revBody ? `rev=${revBody.length} val=${valBody.length}` : 'null');

// 断言数下界（防"删掉几条判据"无人知）
check('D-③ 本守卫断言数 ≥ 19（删掉判据即转红）', pass + failN >= 18, `含本条共 ${pass + failN + 1} 条`);

console.log(`\n===== M2 反推房租口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
