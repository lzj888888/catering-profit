// tools/check_money_fmt.js —— R411 · 金额展示**单源**守卫
//
// 守的是什么（R411 改前实测）：
//   同一批金额格式化在仓里躺着 **7 份**手写实现，而且彼此不一样：
//     · `subpkg/tools/sandbox/index.js:725` 用 `String(Math.abs(n))` + 千分位 ⇒ **不做 round**，
//       遇到 `9160.000000000002` 会输出 `9,160.000,000,000,002`（千分位正则切到了小数位）
//     · 同页 1200 行「万」用 `toFixed(1)`，1281 行用 `toFixed(2)`
//       ⇒ 紧挨着的两张卡一个「1.2万」一个「1.23万」，老板会当成两个对不上的数
//     · `matrix.js` 另有 3 份（收元 / 收分两种口径）
//   ⇒ 收敛到 `utils/moneyFmt.js` 后，本守卫负责**不让第 8 份长出来**。
//
// 🔴 三条判据原则（本仓踩出来的）：
//   ① **剥注释再扫**：R299 实证——页面注释里写着函数名/模式串时，纯 grep 会被注释喂成恒真。
//   ② **只判"手写实现"，不判"出现过 toFixed"**：页面里 `margin_rate * 100).toFixed(1)` 是**百分比**，
//      不是金额 ⇒ 判据必须锚到「千分位正则」或「与 万/元 单位拼接的 toFixed」这两种**具体形态**。
//   ③ **反恒真腿**：把一份手写实现喂给扫描函数，必须判红；否则"扫不到"和"没有"分不清。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('✅ ' + name);
    return true;
  }
  fail++;
  console.log('❌ ' + name + (detail ? ' —— ' + detail : ''));
  return false;
}

// 剥掉注释（不剥字符串：判据要扫的正是字符串里的正则/字面量）
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charAt(i);
    const c2 = src.charAt(i + 1);
    if (c === '/' && c2 === '/') {
      while (i < n && src.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const d = src.charAt(i);
        out += d;
        i++;
        if (d === '\\') {
          if (i < n) { out += src.charAt(i); i++; }
          continue;
        }
        if (d === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// 手写金额格式化的两种**具体形态**（剥注释后匹配）
const PATTERNS = [
  { id: 'P1 千分位正则', re: /\\B\(\?=\(\\d\{3\}\)/ },
  { id: 'P2 手写万单位', re: /toFixed\(\s*[12]\s*\)\s*\+\s*[A-Za-z_.]*(?:Wan|wan)/ },
  { id: 'P3 手写万阈值', re: /toFixed\(\s*[12]\s*\)\s*\+\s*[^;\n]*['"][^'"]*万['"]/ },
];

function scanHandwritten(src) {
  const code = stripComments(src);
  const hits = [];
  for (const p of PATTERNS) {
    if (p.re.test(code)) hits.push(p.id);
  }
  return hits;
}

function read(f) {
  return fs.readFileSync(path.join(ROOT, f), 'utf8');
}

// ── S1 模块与导出 ─────────────────────────────────────────────
let M = null;
try {
  M = require(path.join(ROOT, 'utils/moneyFmt.js'));
} catch (e) {
  M = null;
}
ok('S1 单源模块 utils/moneyFmt.js 可加载', M !== null);
ok('S1 导出四个能力（groupDigits/formatYuan/formatFen/WAN_FLOOR）',
  M && typeof M.groupDigits === 'function' && typeof M.formatYuan === 'function'
  && typeof M.formatFen === 'function' && M.WAN_FLOOR === 10000);

// ── S2 行为面 ─────────────────────────────────────────────────
if (M) {
  ok('S2-1 整数千分位：9160 → 9,160', M.groupDigits(9160) === '9,160');
  ok('S2-2 大数分组：1234567 → 1,234,567', M.groupDigits(1234567) === '1,234,567');
  // 核心修复：浮点尾巴不许被切成"千分位小数"
  ok('S2-3 浮点先取整再加逗号（不会输出 9,160.000,000,000,002）',
    M.groupDigits(9160.000000000002) === '9,160',
    '实际 = ' + M.groupDigits(9160.000000000002));
  ok('S2-4 负号保留：-1234.6 → -1,235', M.groupDigits(-1234.6) === '-1,235');
  ok('S2-5 万门槛 1 位：12345 → 1.2万', M.formatYuan(12345) === '1.2万');
  ok('S2-6 万门槛边界：9999 → 9,999 以下不加万（9999元）', M.formatYuan(9999) === '9999元');
  ok('S2-7 万门槛边界：10000 → 1.0万', M.formatYuan(10000) === '1.0万');
  ok('S2-8 不足 1 万**不加千分位**（与旧实现一字不差：9160元）', M.formatYuan(9160) === '9160元');
  ok('S2-9 负数带符号：-12345 → -1.2万', M.formatYuan(-12345) === '-1.2万');
  ok('S2-10 缺数不编 0：null → —', M.formatYuan(null) === '—');
  ok('S2-11 缺数不编 0：undefined → —', M.formatYuan(undefined) === '—');
  ok('S2-12 非有限值不显示数字：Infinity → —', M.formatYuan(Infinity) === '—');
  ok('S2-13 非有限值不显示数字：NaN → —', M.formatYuan(NaN) === '—');
  ok('S2-14 分→元→万：1234567 分 → 1.2万', M.formatFen(1234567) === '1.2万');
  ok('S2-15 分→元：123456 分 → 1235元', M.formatFen(123456) === '1235元');
  ok('S2-16 单位可换（i18n）：wanUnit/yuanUnit 生效',
    M.formatYuan(12345, { wanUnit: '万元', yuanUnit: '块钱' }) === '1.2万元'
    && M.formatYuan(9160, { wanUnit: '万元', yuanUnit: '块钱' }) === '9160块钱');
}

// ── S3 接线面：两页走单源，且页面内无手写实现 ─────────────────
const PAGES = ['subpkg/tools/sandbox/index.js', 'subpkg/tools/sandbox/matrix.js'];
for (const f of PAGES) {
  const src = read(f);
  ok('S3 ' + f + ' 已 require utils/moneyFmt.js',
    // R423 分包化：页面在 subpkg/ 下时深度多一级 ⇒ 不绑死级数
    /require\(['"](?:\.\.\/){2,3}utils\/moneyFmt\.js['"]\)/.test(stripComments(src)));
  ok('S3 ' + f + ' 无手写金额格式化残留',
    scanHandwritten(src).length === 0,
    '命中：' + scanHandwritten(src).join(','));
}

// 全 pages 面扫一遍（防别处再长一份）
const pageFiles = [];
(function walk(dir) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = dir + '/' + name;
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel);
    else if (/\.js$/.test(name)) pageFiles.push(rel);
  }
})('pages');
const offenders = pageFiles.filter((f) => scanHandwritten(read(f)).length > 0);
ok('S3-3 全 pages/**（' + pageFiles.length + ' 个 js）零手写金额格式化',
  offenders.length === 0, '命中：' + offenders.join(','));

// ── S4 反恒真：判据本身必须抓得到 ─────────────────────────────
ok('S4-1 反恒真：注入千分位正则必须被判红',
  scanHandwritten('const m = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");').length > 0);
ok('S4-2 反恒真：注入手写「万」toFixed 必须被判红',
  scanHandwritten('const m = (y) => (y / 10000).toFixed(1) + T.profitWan;').length > 0);
ok('S4-3 反恒真：注释里的同样代码**不算**命中（防被注释喂成恒真）',
  scanHandwritten('// const m = (y) => (y / 10000).toFixed(1) + T.profitWan;').length === 0);
ok('S4-4 反恒真：百分比 toFixed 不得误判（`(rate * 100).toFixed(1)`）',
  scanHandwritten("const s = (d.margin_rate_ratio * 100).toFixed(1) + '%';").length === 0);
ok('S4-5 反恒真：合法的单源调用不误判',
  scanHandwritten("const money = (y) => MoneyFmt.formatYuan(y, { wanUnit: T.profitWan });").length === 0);

// ── S5 断言数下界（防"扫空恒绿"） ────────────────────────────
ok('S5 断言数下界（≥25）', pass + fail >= 25, '实际 ' + (pass + fail));

console.log('\n===== R411 金额格式化单源守卫：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
