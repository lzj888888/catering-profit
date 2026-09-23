#!/usr/bin/env node
// tools/check_m2_no_cost_rate.js —— 对外文案面「零食材成本率」守卫（R127 · round111 承诺兑现）
//
// 为什么需要它（2026-09-23 round111 李老师拍板）：
//   李老师原话：「尽量咱们指标统一到 **毛利率**，避免 **食材成本率**，**客户看不懂**」。
//   这是**产品口径要求**——改错了**不会让任何数字出错**，只会让文案退回老说法
//   ⇒ 全部数字类判据（selftest / indicator-ref 的 A/B/C 段）**一个都抓不到**。
//   round111 当时只在 `tools/check_indicator_ref.js` 的 E 段做了**四个文件**的扫描面，
//   而「五个页面目录 + 全仓任意页面」这层**零覆盖**：谁在新页面里写一句「食材成本率」，
//   门禁全绿。本守卫把 E 段的 4 个文件面**升级为全前端面**，并补上 E 段无法表达的一条**正向要求**。
//
// 本守卫比 E 段多做的三件事（否则就是重复造轮子）：
//   ① **面**：`pages/**`（60 个）+ `miniprogram/**` + `utils/**` + 术语双副本 —— 不只 sandbox 四个文件。
//   ② **正确的剥注释**：E 段只剥「整行 `//`」，**剥不掉行尾注释**（实证：`calcSandbox/service.js:67`
//      那段 `// 食材成本率 = 100 − 菜品毛利率` 就是行尾注释，E 段扫不到它）。
//      而"为了剥行尾注释就把 `//` 一律切掉"会把 `"http://…"` 切坏 ⇒ **漏网**（更坏）。
//      ⇒ 本守卫按**扩展名**派发正确的注释语法（见 STRIPPERS）：
//        `.js` 引号感知的 `//` + `/* */`；`.wxml`/`.html` 只认 `<!-- -->`；`.wxss`/`.css` 只认 `/* */`。
//        ⚠️ wxml **没有** `//` 注释 —— 拿 js 规则去剥 wxml，`url(https://…)` 会把后半行切掉。
//   ③ **反向护栏（一对互斥事实）**：round111 的口径决策是「**保留**引擎内部中间量 `foodCostPct`、
//      **不出**前端」。只查"文案里没有"是**一半**判据 —— 有人"顺手清理"把它从引擎删掉，
//      保本点会算错，而文案面守卫只会更绿。⇒ B 段把它钉成一对：引擎**必须留**、前端**必须无**。
//
// 判据（P/A/B/C/D 五段，全部 fail-closed；读不到 / 解析不到即判红，不许静默放行）：
//   P 前置   terms 单源可 require / 硬面可枚举且非空
//   A 主判据 三面剥注释后**零**「食材成本率 / 食材成本占… / 食材成本比… / 食材占比」类表述
//            + 术语双副本逐字节一致
//   B 反向   引擎中间量 foodCostPct **必须仍在**（且仍是综合变动成本率的加数、仍出参）
//            / 它在前端硬面**零出现** / 「100 −」那层桥**不得回到指标层**
//   C 正向   口径必须**正面**叫「菜品毛利率」（术语键 + 两张方向表）—— 禁令之外的正向要求
//   D 护栏   剥注释器正负样本互证 5 例（含 URL 不误切、wxml 属性保留）/ 词族正负样本互证 5 例 /
//            扫描面下界 / 锚点文件在面内 / 断言数下界
//   W 弱面   引擎与设计文档里正当提及的地方（只明示，不判红）
//
// 运行：node tools/check_m2_no_cost_rate.js   （由 verify_all.js 的 [no-cost-rate] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERMS_REL = 'miniprogram/i18n/terms.js';
const TERMS_MIRROR_REL = 'specs/dev-specs/i18n/terms.js';   // K11 双副本单源
const SERVICE_REL = 'cloudfunctions/calcSandbox/service.js';
const INDREF_REL = 'cloudfunctions/common/indicatorRef.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

// ============ 剥注释：按扩展名派发正确语法 ============
// 🔴 判据必须是**词族，不是单词**（此条由 round111 回灌 A9 实测抓出，初版判据面写窄了）：
//   初版只查「食材成本率」5 个字；而 A9 把滑杆小字改回「食材成本**占**售价 35%」——
//   一个"率"字都没有 ⇒ **漏网**。而那句话恰恰是 round111 从 UI 上删掉的原话。
//   ⚠️ 但**不能**裸禁「食材成本」四个字：terms 的 `m2.marginTip` **正当**写着
//   「不用另填食材成本，它会随毛利率自动折算」（解释为什么没有食材输入框）⇒ 会误杀。
//   词族恰好把两者分开 —— marginTip 的「食材成本」后跟「，」，不匹配 `[率占比]`（D-② 第 5 例守着）。
const BANNED_RE = /食材成本[率占比]|食材占比/;

// 引号感知剥 `//` 与 `/* */`：**字符串字面量里的一律不碰**（否则 `"http://…"` 会被切坏而漏网）。
function stripJs(src) {
  let out = '', i = 0, st = null;                     // st: null | 'sq' | 'dq' | 'tpl' | 'block' | 'line'
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (st === 'line') { if (c === '\n') { st = null; out += c; } i++; continue; }
    if (st === 'block') { if (c === '*' && c2 === '/') { st = null; i += 2; } else i++; continue; }
    if (st === 'sq' || st === 'dq' || st === 'tpl') {
      const q = st === 'sq' ? "'" : st === 'dq' ? '"' : '`';
      if (c === '\\') { out += c + (c2 === undefined ? '' : c2); i += 2; continue; }
      out += c;
      if (c === q) st = null;
      i++; continue;
    }
    if (c === '/' && c2 === '/') { st = 'line'; i += 2; continue; }
    if (c === '/' && c2 === '*') { st = 'block'; i += 2; continue; }
    if (c === "'") { st = 'sq'; out += c; i++; continue; }
    if (c === '"') { st = 'dq'; out += c; i++; continue; }
    if (c === '`') { st = 'tpl'; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}
const stripMarkupComment = (s) => s.replace(/<!--[\s\S]*?-->/g, '');     // wxml / html
const stripBlockOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');        // wxss / css

// 按扩展名选剥法 —— ⚠️ 这一步是"判据正确性"的一部分，不是实现细节（见文件头 ②）
function stripByExt(rel, src) {
  const e = path.extname(rel).toLowerCase();
  if (e === '.wxml' || e === '.html') return stripMarkupComment(src);   // 只认 <!-- -->
  if (e === '.wxss' || e === '.css') return stripBlockOnly(src);        // 只认 /* */
  if (e === '.json') return src;                                        // json 无注释
  return stripJs(src);                                                  // .js / .ts / 其它
}
const hitsOf = (text) => {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => { if (BANNED_RE.test(l)) out.push(`${i + 1}: ${l.trim().slice(0, 90)}`); });
  return out;
};

// ============ 扫描面枚举 ============
const EXT_OK = new Set(['.js', '.wxml', '.json', '.wxss', '.html', '.css']);
function walk(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (['node_modules', '.git'].includes(e.name)) continue; walk(abs, out); }
    else if (EXT_OK.has(path.extname(e.name).toLowerCase())) out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
  }
}
const HARD_ROOTS = ['pages', 'miniprogram', 'utils'];
let hardFiles = [];
for (const r of HARD_ROOTS) { const d = path.join(ROOT, r); if (fs.existsSync(d)) walk(d, hardFiles); }
if (fs.existsSync(path.join(ROOT, TERMS_MIRROR_REL))) hardFiles.push(TERMS_MIRROR_REL);
hardFiles = [...new Set(hardFiles)].sort();

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============ P 前置 ============
sec('P 前置：术语单源可读 / 硬面可枚举');
let termsMod = null;
try { termsMod = require(path.join(ROOT, TERMS_REL)); } catch (e) { termsMod = null; }
check('P-① ' + TERMS_REL + ' 可 require', !!termsMod,
  termsMod ? 'ok' : 'require 失败（缺文件或语法错）');
check('P-② 硬判据面可枚举且非空', hardFiles.length > 0,
  hardFiles.length + ' 个文件 · 根 [' + HARD_ROOTS.join(' / ') + '] + 术语镜像');

// ============ A 主判据：三面零命中 ============
sec('A 主判据：对外文案面剥注释后零「食材成本率」类表述');
const pageFiles = hardFiles.filter((f) => f.startsWith('pages/'));
const otherFiles = hardFiles.filter((f) => !f.startsWith('pages/'));
function scanFace(files) {
  const bad = [], unreadable = [];
  for (const rel of files) {
    let raw = '';
    try { raw = readRel(rel); } catch (e) { unreadable.push(rel); continue; }
    for (const h of hitsOf(stripByExt(rel, raw))) bad.push(`${rel}:${h}`);
  }
  return { bad, unreadable };
}
{
  const a = scanFace(pageFiles);
  check('A-① pages/ 全面（' + pageFiles.length + ' 个 .js/.wxml/.json/.wxss）零命中',
    a.bad.length === 0 && a.unreadable.length === 0,
    a.bad.length ? a.bad.slice(0, 3).join('；') : (a.unreadable.length ? '读不到：' + a.unreadable.join(',') : '0 命中'));

  const b = scanFace(otherFiles);
  check('A-② miniprogram/ + utils/ + 术语镜像 零命中',
    b.bad.length === 0 && b.unreadable.length === 0,
    b.bad.length ? b.bad.slice(0, 3).join('；') : (b.unreadable.length ? '读不到：' + b.unreadable.join(',') : otherFiles.length + ' 个文件 0 命中'));

  // A-③ 术语双副本逐字节一致（K11 同族）—— 只在两份术语上判「文案面」是不够的：
  //      单源改了而镜像没改 ⇒ 规范和机器面各说各话，两边单看都"干净"。
  const ta = fs.readFileSync(path.join(ROOT, TERMS_REL));
  const tb = fs.existsSync(path.join(ROOT, TERMS_MIRROR_REL)) ? fs.readFileSync(path.join(ROOT, TERMS_MIRROR_REL)) : null;
  check('A-③ 术语双副本逐字节一致（K11 同族）', !!tb && ta.equals(tb),
    tb ? (ta.equals(tb) ? `identical ${ta.length}B` : `DRIFT ${ta.length}B vs ${tb.length}B`) : '镜像缺失 ' + TERMS_MIRROR_REL);
}

// ============ B 反向护栏：中间量"必须留 / 不得出前端" ============
sec('B 反向护栏：引擎中间量必须留、前端必须无');
{
  let svc = '';
  try { svc = readRel(SERVICE_REL); } catch (e) { svc = ''; }
  const svcCode = stripJs(svc);
  // B-① 中间量必须仍在 —— 且必须仍是「综合变动成本率」的加数（这是"为什么必须留"的因果证据，
  //      只断言"存在"会被"留个没人用的变量"骗过）
  const hasDecl = /const\s+foodCostPct\s*=\s*100\s*-\s*grossMarginPct/.test(svcCode);
  const isAddend = /compositeVarRatePct\s*=\s*round1\(\s*foodCostPct\s*\+/.test(svcCode);
  const inOutParam = /food_cost_pct\s*:/.test(svcCode);
  check('B-① 引擎内部中间量 foodCostPct 仍声明 = 100 − 毛利率、仍是综合变动成本率的加数、仍出参',
    hasDecl && isAddend && inOutParam,
    `声明[${hasDecl ? '有' : '无'}] 作加数[${isAddend ? '是' : '否'}] 出参[${inOutParam ? '有' : '无'}]（删了保本点会算错）`);

  // B-② 该中间量不得出前端（剥注释后 —— 注释里记录"我删掉了它"是正当的，见 pages/sandbox/index.js 的删除说明）
  const frontBad = hardFiles.filter((rel) => {
    let raw = ''; try { raw = readRel(rel); } catch (e) { return false; }
    return stripByExt(rel, raw).includes('foodCostPct');
  });
  check('B-② 中间量 foodCostPct 在前端硬面（剥注释后）零出现', frontBad.length === 0,
    frontBad.length ? '出现在 ' + frontBad.join('、') : '0 处（注释里的历史说明不计）');

  // B-③ 「100 − 毛利率」那层桥不得回到指标层：指标层必须回**直填值**
  let indMod = null;
  try { indMod = require(path.join(ROOT, INDREF_REL)); } catch (e) { indMod = null; }
  let gmPct = null, oldKey = false, gainKeys = '';
  if (indMod) {
    try {
      const got = indMod.evaluateIndicators({
        bizKey: 'dining', cityKey: 'tier23', revenueFen: 1000000,
        fixedFen: { rent: 100000 }, grossMarginPct: 65, platformPct: 0,
      });
      const gm = got.find((r) => r.key === 'grossMargin');
      gmPct = gm ? gm.pct : null;
      oldKey = got.some((r) => r.key === 'food');
      gainKeys = indMod.INDICATORS.filter((i) => i.dir === 'gain').map((i) => i.key).join('/');
    } catch (e) { gmPct = 'ERR:' + (e.message || e); }
  }
  check('B-③ 指标层回直填 65（不是 100−65=35）· 无 food 键 · gain 项仅 grossMargin',
    gmPct === 65 && oldKey === false && gainKeys === 'grossMargin',
    `grossMargin.pct=${gmPct}（应 65）· 旧键 food ${oldKey ? '仍在 ⚠️' : '已废'} · gain 项 [${gainKeys}]`);
}

// ============ C 正向要求：口径必须正面叫「菜品毛利率」 ============
sec('C 正向要求：术语必须正面用「毛利率」且方向分表');
{
  const T = (termsMod && termsMod.TERMS) || {};
  const m2 = T.m2 || {};
  const names = m2.indNames || {};
  check('C-① 术语 indNames 含 grossMargin=菜品毛利率 且**无 food 键**',
    names.grossMargin === '菜品毛利率' && !Object.prototype.hasOwnProperty.call(names, 'food'),
    `grossMargin=${JSON.stringify(names.grossMargin)} · food 键=${Object.prototype.hasOwnProperty.call(names, 'food') ? '仍存在 ⚠️' : '无'} · 键集 [${Object.keys(names).join('/')}]`);

  check('C-② 术语 marginName = 菜品毛利率（滑杆主标签）', m2.marginName === '菜品毛利率',
    `实得 ${JSON.stringify(m2.marginName)}`);

  // 方向分表：成本类"高"是坏（偏高/过高），毛利率"低"才是坏（偏低/过低）。
  //   用一张表会把"毛利率偏低"渲染成「偏高」—— 方向相反，客户读反（terms.js 里已立注释说明）。
  const L = m2.indLevels || {}, G = m2.indLevelsGain || {};
  check('C-③ 两张方向表：成本类 warn/bad=偏高/过高 · gain 类 warn/bad=偏低/过低 · indGainKey=grossMargin',
    L.warn === '偏高' && L.bad === '过高' && G.warn === '偏低' && G.bad === '过低' && m2.indGainKey === 'grossMargin',
    `cost[${L.warn}/${L.bad}] gain[${G.warn}/${G.bad}] indGainKey=${m2.indGainKey}`);
}

// ============ D 自失效护栏 ============
sec('D 自失效护栏（证明本守卫既不恒真、也不恒红）');
{
  // D-① 剥注释器正负样本互证 5 例 —— 按扩展名各举一例，两个方向都钉：
  //      正面（必须剥掉）与负面（必须保留 = 真命中 / 或不许切坏）。
  const c1 = stripByExt('a.js', 'const a = 1; // 食材成本率');            // 行尾注释 ⇒ 剥
  const c2 = stripByExt('a.js', 'const u = "http://x/食材成本率";');      // 字符串 + URL ⇒ 保留
  const c3 = stripByExt('a.wxml', '<!-- 食材成本率 --><view/>');           // html 注释 ⇒ 剥
  const c4 = stripByExt('a.wxml', '<view placeholder="食材成本率"/>');     // 属性值是文案 ⇒ 保留
  const c5 = stripByExt('a.wxss', '/* 食材成本率 */ .a{color:red}');       // 块注释 ⇒ 剥
  const ok1 = !c1.includes('食材成本率') && BANNED_RE.test(c1) === false;
  const ok2 = c2.includes('食材成本率') && c2.includes('http://');         // URL 未被切坏
  const ok3 = !c3.includes('食材成本率');
  const ok4 = c4.includes('食材成本率');
  const ok5 = !c5.includes('食材成本率') && c5.includes('.a{color:red}');
  check('D-① 剥注释器正负样本互证 5 例（js 行尾剥 / js URL 不切坏 / wxml 注释剥 / wxml 属性保留 / wxss 块注释剥）',
    ok1 && ok2 && ok3 && ok4 && ok5,
    // ⚠️ detail 里**不得出现 ✅ 字符** —— verify_all 的 R66 审计按 ✅ 计数，写进去会凭空多出断言数
    //    （首版踩过：实跑 17 条而审计行报「✅ 19 条」，复审方对不上）。
    `js行尾[${ok1 ? '剥' : '漏⚠️'}] jsURL[${ok2 ? '保留(未切坏)' : '切坏⚠️'}] wxml注释[${ok3 ? '剥' : '漏⚠️'}]`
    + ` wxml属性[${ok4 ? '保留(真命中)' : '误剥⚠️'}] wxss块[${ok5 ? '剥' : '漏⚠️'}]`);

  // D-② 词族判据正负样本互证 5 例（证明判据面既没写窄、也没写宽）
  const cases = [
    ['「食材成本率」命中', BANNED_RE.test('食材成本率')],
    ['「食材成本占售价 35%」命中（= round111 回灌 A9 漏网的那种写法）', BANNED_RE.test('食材成本占售价')],
    ['「食材占比」命中', BANNED_RE.test('食材占比')],
    ['「食材成本比例」命中', BANNED_RE.test('食材成本比例')],
    ['正当表述「不用另填食材成本，它会随毛利率自动折算」**不**命中',
      !BANNED_RE.test('不用另填食材成本，它会随毛利率自动折算')],
  ];
  const badC = cases.filter((c) => !c[1]).map((c) => c[0]);
  check('D-② 词族判据正负样本互证 5 例（4 命中 + 1 不误杀）', badC.length === 0,
    badC.length ? '不符：' + badC.join('；') : '5/5 如期');

  // D-③ 扫描面下界（防有人把 walk 的根砍掉 ⇒ 守卫变"扫了个空壳"却仍全绿）
  check('D-③ 扫描面下界：硬面文件 ≥ 70 个（砍根即转红）', hardFiles.length >= 70,
    `实得 ${hardFiles.length} 个（pages ${pageFiles.length} + 其它 ${otherFiles.length}）`);

  // D-④ 锚点文件必须在面内（含本轮事故现场 + 反向护栏要读的两个引擎文件）
  const need = ['pages/sandbox/index.wxml', 'pages/sandbox/index.js', TERMS_REL, TERMS_MIRROR_REL];
  const miss = need.filter((x) => !hardFiles.includes(x));
  const engOk = fs.existsSync(path.join(ROOT, SERVICE_REL)) && fs.existsSync(path.join(ROOT, INDREF_REL));
  check('D-④ 锚点文件在面内（sandbox wxml/js + 双术语）+ 两个引擎文件可读', miss.length === 0 && engOk,
    miss.length ? '缺：' + miss.join('、') : `4 个锚点全在 · 引擎文件 ${engOk ? '可读' : '缺失 ⚠️'}`);

  // D-⑤ 断言数下界（防"删掉几组正负样本"把守卫悄悄改小）
  //      ⚠️ 下界取**实测值的保守下沿**（本行执行时刻实测 16 条 —— 取 14）。
  //      改它就等于改守卫强度，故同步登记进重启键「套件断言数口径」唯一声明处。
  check('D-⑤ 本守卫断言数 ≥ 14（非恒真证明力下界）', pass >= 14, `当前累计 ${pass} 条`);
}

// ============ W 弱面（只明示不判红）============
sec('W 弱面（引擎自测 / 设计文档 / 守卫自身 里的正当提及）');
{
  const WEAK_ROOTS = ['cloudfunctions', 'specs', 'tools'];
  let wf = 0, wh = 0; const samples = [];
  for (const r of WEAK_ROOTS) {
    const d = path.join(ROOT, r);
    if (!fs.existsSync(d)) continue;
    const acc = []; walk(d, acc);
    for (const rel of acc) {
      if (!/\.(js|md|json)$/.test(rel)) continue;
      let raw = ''; try { raw = readRel(rel); } catch (e) { continue; }
      wf++;
      const hs = hitsOf(stripByExt(rel, raw));
      wh += hs.length;
      if (hs.length && samples.length < 3) samples.push(rel);
    }
  }
  // 恒真明示（不判红）——正当理由逐条：引擎自测名在断言"内部量 = 35%"；设计文档在讨论口径本身；
  //    守卫自己必须写出被禁的词族才能守它。这三类都**不该**判红，故落弱面只明示。
  check('W-① 弱面明示完成（不论命中多少均不判红）', true,
    `${wf} 个文件 · ${wh} 处命中${samples.length ? '（例：' + samples.join('、') + '）' : ''}`
    + ' —— 三类正当面：引擎自测(内部量) / 设计文档(讨论口径) / 守卫自身(判据本体)');
}

console.log(`\n===== 零成本率文案面守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
