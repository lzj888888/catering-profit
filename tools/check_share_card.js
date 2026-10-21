#!/usr/bin/env node
// tools/check_share_card.js —— 分享卡片「标题真的带结论」守卫（R395 · 队列 #11）
//
// 为什么必须机器守（这个缺口有多大）：
//   小程序**不写 `onShareAppMessage` 时，微信拿小程序名当分享标题** —— 不报错、不警告，
//   对方的卡片只剩「店算」两个字。R395 之前全仓**零 `onShareAppMessage`**：功能不是坏了，
//   是**从来没存在过**，而 189 个套件一个都没发现（与 R124「术语键引用即存在」同族：
//   页面这层没有套件读它）。补上三页之后，真正的风险变成**回归**：
//     · 谁把 `onShareAppMessage` 删了（或注释掉）⇒ 分享又变回小程序名，门禁该红；
//     · 谁把标题改回写死的一句话（如「店算 · 餐饮算账」）⇒ 卡片又读不懂，门禁该红；
//     · 谁在页面里**自己拼**标题（绕过 utils/shareCard.js）⇒ 三套口径开始漂，门禁该红。
//
// 判据（三条腿，方向不同、缺一不可）：
//   ① **行为面**：真 require `utils/shareCard.js`，真调三个 builder，喂真数字，
//      看标题里**真的有那个数**（9,160 元 → 含 "9160"）。防「函数存在但拼错」。
//   ② **接线面**：三个页面必须有**真定义**的 `onShareAppMessage`，其函数体内**真调用** shareCard
//      的对应 builder，且**不自己写 title / path**（页面一旦自己拼，单源就废了）。
//      ⚠️ 判据按**剥注释后**的源码 + **函数体窗口**，不是全文 grep 词出现 —— 本仓踩过
//      「注释里写着函数名 ⇒ 删掉 require 判据照绿」（R299 恒真第③型）。
//   ③ **反恒真**：改入参数字，标题必须跟着变；有数/无数两支文案必须不同；三页必须都在扫描面内。
//      没有这一条，把 builder 写成 `return '固定一句话'` 也能让 ① 之外的一切全绿。
//
// ⚠️ 本文件**不用正则**（本机环境会把反斜杠转成斜杠，落盘即语法错）—— 一律 indexOf + 切片。
//
// 运行：node tools/check_share_card.js   （由 verify_all.js 的 [share-card] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARE = path.join(ROOT, 'utils', 'shareCard.js');
const TERMS_A = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');
const TERMS_B = path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js');

// 必须接线的页面（顺序 = 队列 #11 点名的三个入口）
const PAGES = [
  { rel: 'subpkg/biz/month/result.js', fn: 'm1Share', why: 'M1 月度结果页' },
  { rel: 'subpkg/tools/sandbox/index.js', fn: 'm2Share', why: 'M2 开店测算页' },
  { rel: 'subpkg/biz/card/index.js', fn: 'm3Share', why: 'M3 菜品成本列表' },
];

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}

// ================= 基础工具（全部 indexOf / 切片，无正则） =================

/**
 * 去掉 `//` 与 `/* *\/` 注释，**保留字符串内容**。
 * 为什么要保留字符串：接线面要判 `require('../../utils/shareCard.js')` 这个字面量。
 * 为什么必须剥注释：注释里写着 `onShareAppMessage` 也能让全文 grep 恒真（R299 恒真第③型）。
 */
function stripComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    const c2 = i + 1 < n ? s.charAt(i + 1) : '';
    if (c === '/' && c2 === '/') {
      while (i < n && s.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s.charAt(i) === '*' && s.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        out += d;
        i++;
        if (d === '\\') { if (i < n) { out += s.charAt(i); i++; } continue; }
        if (d === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 取某函数**定义体**的源码（从 `name(` 起，到与第一个 `{` 配平的 `}` 止）。
 * 找不到 ⇒ 返回 ''（调用方据此判红，fail-closed）。
 */
function bodyOf(src, name) {
  const s = String(src || '');
  const k = s.indexOf(name + '(');
  if (k < 0) return '';
  let i = s.indexOf('{', k);
  if (i < 0) return '';
  const start = i;
  let depth = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        if (d === '\\') { i += 2; continue; }
        i++;
        if (d === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
    i++;
  }
  return '';
}

function readOr(p, dflt) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return dflt; }
}

// ================= ① 行为面：真调 builders =================
let card = null;
try { card = require(SHARE); } catch (e) { card = null; }
ok('①-0 utils/shareCard.js 可被 require', !!card, card ? '' : String(e && e.message));
if (!card) {
  console.log('❌ 分享卡片守卫：模块加载失败，后续判据无法执行（fail-closed）');
  process.exit(1);
}
const has = (t, sub) => String(t == null ? '' : t).indexOf(sub) >= 0;

let T = {};
try { T = require(TERMS_A).TERMS || {}; } catch (e) { T = {}; }

// 真实量级：9160 元保本 / 8400 元净剩（与 MEMORY 的口径锁同一个量级）
const win = card.m1Share({ hasLedger: true, breakEvenFen: 916000, profitFen: 840000, month: '2026-10' });
ok('①-1 M1 赚钱月：标题含保本额 9160', has(win.title, '9160'), String(win.title));
ok('①-2 M1 赚钱月：标题含净剩 8400', has(win.title, '8400'), String(win.title));
ok('①-3 M1 路径带月份', has(win.path, '2026-10'), String(win.path));

const loss = card.m1Share({ hasLedger: true, breakEvenFen: 916000, profitFen: -120000 });
ok('①-4 M1 亏损月：说「亏」且金额取绝对值 1200', has(loss.title, '亏') && has(loss.title, '1200'), String(loss.title));

const m1Empty = card.m1Share({ hasLedger: false });
ok('①-5 M1 无账本：退回通用句，不出现任何金额', m1Empty.title === T.share.m1Empty, String(m1Empty.title));

const m2 = card.m2Share({ ready: true, breakEvenFen: 5000000 });
ok('①-6 M2 有结果：标题含保本额 50000', has(m2.title, '50000'), String(m2.title));
const m2Empty = card.m2Share({ ready: false, breakEvenFen: 5000000 });
ok('①-7 M2 没结果：不得泄露「算过」的保本额', m2Empty.title === T.share.m2Empty && !has(m2Empty.title, '50000'), String(m2Empty.title));

const m3 = card.m3Share({ priced: 12, low: 3, band: 40 });
ok('①-8 M3：标题含张数 12 与偏低 3', has(m3.title, '12') && has(m3.title, '3'), String(m3.title));
ok('①-9 M3：偏低张数按**张**而不是按分（不得出现 0.12）', !has(m3.title, '0.12'), String(m3.title));
const m3Ok = card.m3Share({ priced: 5, low: 0, band: 40 });
ok('①-10 M3 全达标：不再说「偏低」', !has(m3Ok.title, '偏低') && has(m3Ok.title, '5'), String(m3Ok.title));
const m3Empty = card.m3Share({});
ok('①-11 M3 无卡：退回通用句', m3Empty.title === T.share.m3Empty, String(m3Empty.title));

// 垃圾入参：不能把 undefined / NaN / 未替换占位符漏到用户眼前
const junk = [
  card.m1Share(null), card.m1Share({}), card.m1Share({ hasLedger: true, breakEvenFen: NaN, profitFen: NaN }),
  card.m2Share(undefined), card.m3Share(null), card.m3Share({ priced: 3 }),
];
const junkBad = junk.filter((r) => {
  const t = String((r && r.title) || '');
  return t === '' || has(t, 'undefined') || has(t, 'NaN') || has(t, '{a}') || has(t, '{b}') || has(t, '{c}');
});
ok('①-12 垃圾入参不得产出 undefined / NaN / 未替换占位符', junkBad.length === 0,
  junkBad.map((r) => String(r && r.title)).join(' | '));

// 禁词回归（TERMS.forbidden 的红线，分享文案同样不许越）
const banned = ['盈利', '赚钱', '躺赚', '投资', '回本周期', '收益率', '利润率'];
const allTitles = [win, loss, m1Empty, m2, m2Empty, m3, m3Ok, m3Empty].map((r) => String(r.title));
const bans = [];
for (const t of allTitles) for (const w of banned) if (has(t, w)) bans.push(w + ' → ' + t);
ok('①-13 分享标题无禁词', bans.length === 0, bans.join(' | '));

// ================= ③ 反恒真（先于②，用来证明判据本身不是恒真） =================
const alt = card.m1Share({ hasLedger: true, breakEvenFen: 1234500, profitFen: 990000 });
ok('③-1 反恒真：入参一变，标题必须跟着变', alt.title !== win.title && has(alt.title, '12345'), String(alt.title));
ok('③-2 反恒真：有数/无数两支文案不同', win.title !== m1Empty.title && m2.title !== m2Empty.title);
ok('③-3 三个 builder 都在导出面', typeof card.m1Share === 'function'
  && typeof card.m2Share === 'function' && typeof card.m3Share === 'function');
ok('③-4 TERMS.share 文案组未被缩水（≥9 键）', Object.keys(T.share || {}).length >= 9,
  String(Object.keys(T.share || {}).length));
ok('③-5 双副本 terms.js 逐字节一致（K11）', readOr(TERMS_A, 'A') === readOr(TERMS_B, 'B'));

// ================= ② 接线面：三页真定义 + 真调用 + 不自己拼 =================
for (const p of PAGES) {
  const fp = path.join(ROOT, p.rel.split('/').join(path.sep));
  const raw = readOr(fp, null);
  if (raw === null) { ok('② 可读 ' + p.rel, false, '文件读不到 ⇒ fail-closed'); continue; }
  const src = stripComments(raw);

  // R423 分包化：页面在 subpkg/ 下时相对深度多一级 ⇒ 不绑死 `../` 级数
  ok('②-a ' + p.rel + ' 真 require shareCard',
    /require\((['"])\.\.\/(?:\.\.\/)*utils\/shareCard\.js\1\)/.test(src));

  const body = bodyOf(src, 'onShareAppMessage');
  ok('②-b ' + p.rel + ' 有 onShareAppMessage 定义（剥注释后）', body.length > 20,
    body.length > 20 ? '' : '未定义 ⇒ 微信会用小程序名当标题');
  if (body.length > 20) {
    ok('②-c ' + p.rel + ' 函数体真调用 shareCard.' + p.fn,
      has(body, 'shareCard.' + p.fn + '('));
    ok('②-d ' + p.rel + ' 不在页面内自己拼标题（无 title: 字面量）', !has(body, 'title:'));
    ok('②-e ' + p.rel + ' 不在页面内自己拼路径（无 /pages/ 字面量）', !has(body, '/pages/'));
    ok('②-f ' + p.rel + ' 真的 return（不是只算不返）', has(body, 'return '));
  }

  // 取数侧：分享用的数字必须是**原始值**（页面里落成 `shareFacts`），不是从展示串反解
  ok('②-g ' + p.rel + ' 落库 shareFacts 取数', has(src, 'shareFacts'));
}

// ================= 扫描面自失效护栏 =================
ok('S1 扫描面三页齐全', PAGES.length === 3 && PAGES.every((p) => fs.existsSync(path.join(ROOT, p.rel.split('/').join(path.sep)))));
ok('S2 断言数下界（≥30）', pass + problems.length >= 30, String(pass + problems.length));

// ================= 结论 =================
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 分享卡片校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ 分享卡片校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 分享卡片校验通过（三页接线 M1/M2/M3，标题走 utils/shareCard.js 单源）');
console.log('✅ 分享卡片校验：' + total + ' 通过 / 0 失败');
