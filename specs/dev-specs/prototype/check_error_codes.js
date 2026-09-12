/**
 * 规范层一致性机械门禁 · check_error_codes.js
 *
 * 用途：把"新增了东西但没同步到另一侧"这类**靠人眼必漏**的问题变成 CI/本地一条命令就能挂的红线。
 * 运行：node prototype/check_error_codes.js   （退出码 0=全绿，1=有断裂）
 *
 * 覆盖三组断言：
 *   A. 错误码三向一致：core/09 §1 的 code 列 ↔ §3 的 i18n key 列 ↔ i18n/terms.js 的键集合
 *      —— 拦住「新增了 wire code 但 terms.js 没键」（前端每次查表 miss → 提示全被吞成"系统异常"）
 *        与「core/09:107 那类 wire code 当 i18n key 直接用」的写法回潮。
 *   B. wire code → i18n key 映射完整：CODE_TO_I18N 必须覆盖全部 wire code，且值必须真实存在。
 *   C. 云函数登记一致：core/16 引入的 admin 函数必须已登记进 core/10 §6 契约表
 *      —— 拦住「新文档引了函数但契约表没有」（函数名依赖"契约表唯一性"）。
 *
 * ⚠️ 新增错误码必须三处同步：core/09 §1 表 + core/09 §3 表 + i18n/terms.js（ERROR_MESSAGES 键 + CODE_TO_I18N 条目）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

/** 取一行表格中第 idx 个单元格里的首个 `反引号包裹内容` */
function backticked(row, idx) {
  const cells = row.split('|');
  if (cells.length <= idx) return null;
  const m = cells[idx].match(/`([^`]+)`/);
  return m ? m[1] : null;
}

/** 抽取两个标题之间的正文 */
function section(text, startHeading, endHeading) {
  const s = text.indexOf(startHeading);
  if (s < 0) return '';
  const rest = text.slice(s + startHeading.length);
  const e = endHeading ? rest.indexOf(endHeading) : -1;
  return e < 0 ? rest : rest.slice(0, e);
}

const fails = [];
const notes = [];

// ===================== A / B. 错误码三向一致 =====================
const ecText = read('core/09_统一错误码表.md');
const { ERROR_MESSAGES, CODE_TO_I18N, msgOf } = require(path.join(ROOT, 'i18n/terms.js'));

// §1：wire code 列 → i18n key 列
const sec1 = section(ecText, '## 1. 错误码全集', '## 2. 使用铁律');
const specWire = new Map(); // wire -> i18nKey
for (const line of sec1.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const wire = backticked(line, 1);
  const key = backticked(line, 4);
  if (wire && key) specWire.set(wire, key);
}

// §3：i18n key 列
const sec3 = section(ecText, '## 3. 前端文案映射表', null);
const specI18n = new Set();
for (const line of sec3.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const key = backticked(line, 1);
  if (key) specI18n.add(key);
}

const termsKeys = new Set(Object.keys(ERROR_MESSAGES));
const mapCodes = new Set(Object.keys(CODE_TO_I18N));

notes.push(`core/09 §1 wire code: ${specWire.size} 个`);
notes.push(`core/09 §3 i18n key : ${specI18n.size} 个`);
notes.push(`terms.js ERROR_MESSAGES 键: ${termsKeys.size} 个`);
notes.push(`terms.js CODE_TO_I18N 条目: ${mapCodes.size} 个`);

// A1. §1 的每个 wire code 都必须在 CODE_TO_I18N 里有映射
for (const wire of specWire.keys()) {
  if (!mapCodes.has(wire)) fails.push(`[B1] wire code \`${wire}\` 在 core/09 §1 存在，但 terms.js 的 CODE_TO_I18N 缺该条目`);
}
for (const wire of mapCodes) {
  if (!specWire.has(wire)) fails.push(`[B2] CODE_TO_I18N 里的 \`${wire}\` 不在 core/09 §1 表中（多出未登记的 wire code）`);
}

// A2. CODE_TO_I18N 的映射关系必须与 §1 声明完全一致
for (const [wire, expectKey] of specWire) {
  const actual = CODE_TO_I18N[wire];
  if (actual && actual !== expectKey) {
    fails.push(`[B3] \`${wire}\` 映射不一致：core/09 §1 写 \`${expectKey}\`，terms.js CODE_TO_I18N 写 \`${actual}\``);
  }
}

// A3. CODE_TO_I18N 的每个目标 i18n key 都必须在 ERROR_MESSAGES 里存在
for (const [wire, key] of Object.entries(CODE_TO_I18N)) {
  if (!termsKeys.has(key)) fails.push(`[B4] \`${wire}\` 映射到 \`${key}\`，但 terms.js ERROR_MESSAGES 没有该键`);
}

// A4. §3 表 ↔ ERROR_MESSAGES 键集合必须完全相等
for (const key of specI18n) {
  if (!termsKeys.has(key)) fails.push(`[A1] core/09 §3 有 \`${key}\`，但 terms.js ERROR_MESSAGES 缺该键`);
}
for (const key of termsKeys) {
  if (!specI18n.has(key)) fails.push(`[A2] terms.js ERROR_MESSAGES 有 \`${key}\`，但 core/09 §3 表缺该行`);
}

// A5. 所有 i18n key 都必须被至少一个 wire code 指到（防止留下孤儿文案）
const usedKeys = new Set(Object.values(CODE_TO_I18N));
for (const key of termsKeys) {
  if (!usedKeys.has(key)) fails.push(`[A3] i18n key \`${key}\` 没有任何 wire code 指向它（孤儿文案）`);
}

// A6. 兜底行为自检：未知码必须回落到「系统异常」，且已知码必须拿到非空/预期文案
if (msgOf('SYSTEM_ERROR') !== ERROR_MESSAGES['ERR.SYSTEM']) {
  fails.push('[A4] msgOf() 兜底异常：未知/系统码未正确回落 ERR.SYSTEM');
}
if (msgOf('FREE_LIMIT_EXCEEDED') !== ERROR_MESSAGES['ERR.FREE_LIMIT']) {
  fails.push('[A5] msgOf(FREE_LIMIT_EXCEEDED) 未命中「已达免费上限」—— wire code 与 i18n key 映射链路断裂');
}

// ===================== C. 云函数登记一致 =====================
const fnText = read('core/10_云函数清单与接口契约.md');
const sec6 = section(fnText, '## 6. 管理后台 H5', '## 7.');
const registered = new Set();
for (const line of sec6.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const fn = backticked(line, 1);
  if (fn && /^admin[A-Za-z]+$/.test(fn)) registered.add(fn);
}

// 扫描面扩展：不再只取 core/16 §7~§9，而是遍历 specs/dev-specs 下**全部 .md**
// （原范围会漏掉在别的文件/新章节里引入的 admin 函数 —— 复审指出的盲区）。
const EXCLUDE_FN = new Set([
  'adminAuth',   // 中间件，不是云函数
  'adminId',     // ctx 字段
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allMd = walk(ROOT)
  .filter((p) => p.endsWith('.md'))
  .filter((p) => !path.basename(p).startsWith('OBSOLETE_'));

// F 组（字符完整性）用的文件集：.md + .js + .txt
// ⚠️ 在此处定义（紧邻 allMd）以避免 TDZ —— 上方 notes 会引用 allText.length。
const allText = walk(ROOT)
  .filter((p) => ['.md', '.js', '.txt'].includes(path.extname(p).toLowerCase()))
  .filter((p) => !path.basename(p).startsWith('OBSOLETE_'));

// D 组（配额口径）文件集：.md + .txt —— 必须含 .txt。
// D7 复发点之一就是 delivery/批次5_提示词_可直接复制.txt（.txt），.md-only 扫不到它。
// ⚠️ 不可直接用 allText（含 .js）：check_error_codes.js 自身的 tip/汇总串必然引用禁用值 → 自命中（实测 15 条）。
const allDoc = walk(ROOT)
  .filter((p) => ['.md', '.txt'].includes(path.extname(p).toLowerCase()))
  .filter((p) => !path.basename(p).startsWith('OBSOLETE_'));

const usedFns = new Map(); // fn -> 首次出现的文件
for (const f of allMd) {
  const txt = read(path.relative(ROOT, f).replace(/\\/g, '/'));
  for (const m of txt.matchAll(/`([^`]+)`/g)) {
    // ⚠️ 不能简单用 /`(admin[A-Za-z]+)`/ —— 写成 `adminRevokeToken(admin_id)`（带括号）会漏掉（假阴性）。
    //    这里允许后面跟 "(" 或直接结束；下划线开头（admin_user 等集合名）自然不匹配。
    const hit = m[1].match(/^(admin[A-Z][A-Za-z]*)(?:\(|$)/);
    if (!hit) continue;
    const fn = hit[1];
    if (EXCLUDE_FN.has(fn)) continue;
    if (!usedFns.has(fn)) usedFns.set(fn, path.relative(ROOT, f).replace(/\\/g, '/'));
  }
}

notes.push(`core/10 §6 已登记 admin 函数   : ${registered.size} 个`);
notes.push(`全树引用 admin 函数（已排除中间件/字段）: ${usedFns.size} 个`);
notes.push(`配额口径(D组)扫描 : ${allDoc.length} 个 .md+.txt；表格结构(E组)扫描 : ${allMd.length} 个 .md`);
// 按扩展名给出实际构成（避免"以为在守 .txt、其实仓库内没有 .txt"的错觉）
const extCount = { '.md': 0, '.js': 0, '.txt': 0 };
allText.forEach((p) => {
  const e = path.extname(p).toLowerCase();
  if (e in extCount) extCount[e]++;
});
notes.push(`字符完整性扫描           : ${allText.length} 个（.md ${extCount['.md']} / .js ${extCount['.js']} / .txt ${extCount['.txt']}）`);

// 注：C1 / D1 / E1 的断言统一放在 D、E 两组计算完成之后（见下），避免 TDZ。

// ===================== D. 配额口径一致性（防 v1.1 旧值复发）=====================
// 背景：M3「8 张」、M2「3 套」都是 v1.1 过期值，此前各复发过一次且都靠人眼才发现。
// 这里把 v1.4 权威口径写成可机械断言的常量：命中禁用模式即 fail。
// ⚠️ 本表正则一律使用**无 /g 标志**的字面量：下方按子句反复调用 re.exec()，
//    若某条加了 /g，lastIndex 会跨调用残留 → 间歇性漏检（表现为"有时报有时不报"，极难排查）。
const FORBIDDEN_QUOTA = [
  { re: /M2\s*[=＝]\s*3/, tip: 'M2 应是「不限套」，不是 3' },
  { re: /M2[^。；\n]{0,12}3\s*套/, tip: 'M2 无套数限制' },
  { re: /M2[^。；\n]{0,12}3\s*方案/, tip: 'M2 方案不限套' },
  { re: /M2[^。；\n]{0,16}3\s*个?\s*(免费)?\s*(方案|套)/, tip: 'M2 方案不限套（永久全免费，v1.4 终稿；3 个方案/3 套均属 v1.1 过期值）' },
  { re: /免费\s*≤\s*3/, tip: '仅 M3 免费 3 张；M2 不限套，不得写「免费≤3」' },
  { re: /M3[^。；\n]{0,14}8\s*张/, tip: 'M3 应为 3 张，8 张是 v1.1 过期值' },
  { re: /单张导出免费/, tip: '导出（含单张 PDF）全部仅付费解锁' },
  // 价格旧值：P0-1 的原始缺陷就是价格，且改价概率高于改配额，顺手加保险
  { re: /2990|7990|29900/, tip: '套餐价 v1.4 = 2590 / 6900 / 19900（分）；2990 / 7990 / 29900 是旧值' },
  { re: /(?<!\d)(29\.9|79\.9)\s*元/, tip: '套餐价 v1.4 = 25.9 / 69 / 199 元（(?<!\\d) 防误伤「19.9 元/月」云开发套餐）' },
];
// 合法豁免：**只放沿革 / 作废类标记**。
// ⚠️ 绝不可把「不限套」这类"当前正确值"放进来 —— 那是被检查对象本身，放进豁免等于该行免检；
//    且本项目「配额维度」常写成 M1 / M3 / M2 三项混排一行（如 core/13:59），
//    整行豁免会让同行的 M3=8 张 之类旧值一起逃检（2026-09-12 复审指出的真实漏洞 G1）。
const QUOTA_SKIP_MARKERS = [
  '作废', '已回退', '沿革', '历史', '曾误', '原规划', '原"免费', '原“免费', '无 3 套限制',
];
// 按子句切分：豁免标记只保护**它所在的分句**，不再保护整行；
// 且豁免再按「匹配位置 ±20 字符」就近判定（见下），不因同句出现沿革词而整句免检。
// ⚠️ 必须包含 、(U+3001)：它是本项目并列项最常用的分隔符
//    （如 core/13「M1=1 账套、M3=3 张、M2 不限套」），漏了它混排行就不会被切分。
// ℹ️ 2026-09-12 试运行结论：**清空上表后全树命中数为 0** —— 当前 25 个 md 里没有任何一行
//    真正依赖豁免。保留它是为将来书写「沿革 / 作废」记录留余地；若哪天它开始造成误豁免，
//    可直接整表删除（届时需给沿革行加行内标记：属「响亮失败」，优于静默漏检）。
const CLAUSE_SPLIT = /[。；;，,、]/;

const quotaHits = [];
for (const f of allDoc) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = read(rel).split('\n');
  lines.forEach((line, i) => {
    const clauses = line.split(CLAUSE_SPLIT);
    for (const { re, tip } of FORBIDDEN_QUOTA) {
      // 就近判定：豁免标记必须出现在**匹配位置附近**（±EXEMPT_RADIUS 字符）才生效，
      // 而不是"子句里任意位置出现就整句免检"。后者只要旧值与沿革词共处一句就失效，
      // 且换用 ＋ / ／ / 空格 等粘合方式又会重新破功 —— 就近判定对分隔符形态不敏感，更治本。
      const EXEMPT_RADIUS = 20;
      const hit = clauses
        .map((c) => ({ c, m: re.exec(c) }))
        .find(({ c, m }) => m && !QUOTA_SKIP_MARKERS.some((k) =>
          c.slice(Math.max(0, m.index - EXEMPT_RADIUS),
                  m.index + m[0].length + EXEMPT_RADIUS).includes(k)
        ));
      if (hit) {
        quotaHits.push({
          rel, line: i + 1, tip,
          text: line.trim().slice(0, 110),
          clause: hit.c.trim().slice(0, 70),
        });
      }
    }
  });
}

// ===================== E. 表格结构完整性（堵"引用块把表行挤出表格"的盲区）=====================
// 背景：core/09 §1.4 曾因 blockquote 插在表格中间，导致 AMORT_TERMINATED 行被挤出表格、
//       Markdown 下不再渲染为表行；而"按行首 | 抓表行"的解析方式照收不误，门禁全绿。
// 做法：识别孤儿表行 —— 以 | 开头、但其上一行不是表行/表头、且下一行不是分隔行的行。
function orphanTableRows(text, label) {
  const lines = text.split('\n');
  const orphans = [];
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) {
      // 任何非表行都要复位（含不带空行的散文行）—— CommonMark 下段落行同样会中断表格，
      // 表行必须连续排列。原写法只在空行 / 引用块 / 标题处复位，会漏掉散文行中断的情形（G2）。
      inTable = false;
      continue;
    }
    if (inTable) continue;
    // 不在表内却出现 | 行：只有"下一行是分隔行"才算表头，否则就是孤儿行
    const next = (lines[i + 1] || '').trim();
    if (/^\|[\s:|-]+\|$/.test(next)) {
      inTable = true;
      continue;
    }
    orphans.push(`${label}:${i + 1}  ${t.slice(0, 90)}`);
  }
  return orphans;
}

const structureHits = [];
for (const f of allMd) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  structureHits.push(...orphanTableRows(read(rel), rel));
}

// ===================== F. 字符完整性（U+FFFD 替换字符）=====================
// 背景：core/06「兜底」（3 字节损坏）与本文件「一行」都曾变成 U+FFFD，两次都靠人眼偶然发现。
// ⚠️ 扫描面必须是 **.md + .js + .txt**：只扫 .md 会漏掉 .js 里的损坏（历史上真漏过一次）。
//    注意 F 组用 allText，而 C / E 仍用 allMd，D / I / J 用 allDoc（.md+.txt，排除 .js）—— 后者把 .js 排除正是为避免本文件自身的 tip/汇总串自命中
//    （本文件注释里就有「8 张」「2990」等被检查的字样）。
// allText 已在 C 组上方定义（紧邻 allMd），此处直接使用

const FFFD = '\uFFFD';
const charHits = [];
for (const f of allText) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  read(rel).split('\n').forEach((l, i) => {
    if (l.includes(FFFD)) charHits.push(`${rel}:${i + 1}  ${l.trim().slice(0, 90)}`);
  });
}

// ===================== I. 派生精度一致性（防 5 位小数残余 / N13·N14 回潮）=====================
// 背景：N13 发现"明细表行值 6.6667（5 位）与合计 8.76（4 位纪律）不自洽、相邻行加总对不上"；
//       N14 发现"净料单位成本 0.03333（5 位）"散落 5 处。自动判定式 netCostPerGram 只产出 ≤4 位，
//       文档里出现 5 位小数即意味着"手算值未跟随纪律更新"。
// 做法：在 .md 内扫描三个已知坏串——`6.6667`（应为 6.66）、`0.03333`（应为 0.0333）、`9.76`（应为 9.75）；
//       命中即 fail。特地只扫 .md+.txt（不扫 .js）——seed_data.js 的"非裸浮点 0.03333…"、
//       calcDishCost.js:9 / test_poc2.js:7,55 的"旧文档 9.76 为笔误"均是有意保留的对照，
//       扫 .js 会误伤。本组只增严、不放松。
// ⚠️ 覆盖边界（N22，必读）：本组只守 specs/dev-specs/。**桌面派生层（C_桌面已生成交付物 / B_工作台_parse）
//       不在 A–K 任何一组覆盖内**——那里的旧值只能靠「从仓库单源重生成」或「作废」消除；
//       往本组加断言**不会**让派生件变安全，别把收益算高了。
// ⚠️ 无豁免（N21 撤表）：将来 .md 里若要写「9.76 是笔误」这类沿革，本组会红。
//       要么改用绕写（如「9.7x 旧笔误」），要么按 :304 的路径加**更窄**的标记——不预置宽泛词。
const FORBIDDEN_DERIV = [
  { re: /6\.6667/, tip: '鸡胸肉 200g 行成本应为 4 位纪律值 6.66（6.6667 是 5 位，与合计 8.76 不自洽，N13）' },
  { re: /0\.03333/, tip: '净料单位成本应为 4 位纪律值 0.0333（0.03333 是 5 位，N14）' },
  { re: /9\.76/, tip: '宫保鸡丁总成本锚点应为 9.75（9.76 是旧笔误，N22；同族反例 2 位→9.05 / 3 位→9.68）' },
];
// ⚠️ 关于"沿革行豁免"（N18① 曾加、N21 撤除）：本组一度有 DERIV_SKIP_MARKERS（作废/已回退/曾误/沿革/原值/历史），
//    用于放行「曾用 0.03333（5 位）」这类沿革记录。2026-09-12 清空试运行：**全树 .md 裸命中 = 0**（无任何一处依赖豁免）。
//    按"响亮失败优于静默漏检"整表撤除——尤其 `原值` 偏宽，会把"原值 6.6667"这类**真实残余**误豁免（N19）。
//    将来若确需在沿革里写旧值，再加**更窄**的标记（并同步更新本注释），不预置宽泛词。
const derivHits = [];
for (const f of allDoc) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  read(rel).split('\n').forEach((line, i) => {
    for (const { re, tip } of FORBIDDEN_DERIV) {
      if (re.test(line)) derivHits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}  —— ${tip}`);
    }
  });
}
notes.push(`派生精度一致性扫描 : ${allDoc.length} 个 .md+.txt（禁 6.6667 / 0.03333 / 9.76）`);

// ===================== J. H5 购买页内容护栏（防非数值内容漂移 / D1 回潮）=====================
// 背景：D1 发现投喂包批次 5 §2.5 引用「v1.4 §10.7」却装了修复前内容——"引导至安卓端或 H5 购买页
//       （预留跳转入口）"。虚拟商品引导 H5 支付违反微信运营规范 5.13，会致审核驳回（P1-9 已判定删除）。
//       此前 A~I 门禁全绿，因漂移扫描模式集只含数值项（8张/12.09/...），天然扫不到 H5 这类非数值内容。
// 做法：全树 .md+.txt 搜「H5 购买页」，命中行必须是**否定句**（含 禁止/❌/不预留/不引导/禁硬编码 H5 之一），
//       否则 fail——肯定式引导 H5 = 把已删违规方案装回去。与 D/E/I 同构、成本极低。
const H5_NEG = ['禁止', '❌', '不预留', '不引导', '禁硬编码 H5'];
const h5Hits = [];
for (const f of allDoc) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  read(rel).split('\n').forEach((line, i) => {
    if (line.includes('H5 购买页') && !H5_NEG.some((t) => line.includes(t))) {
      h5Hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
  });
}
notes.push(`H5 购买页内容护栏 : ${allDoc.length} 个 .md+.txt（命中须为否定句）`);

// ===================== G. 套餐价格结构断言（读代码值，不做文本 grep）=====================
// 背景：P0-1 的原始缺陷（2990 / 7990 / 29900 / 月包 30 天）就住在 init_db.js 的 SEED_PLANS 里，
//       而 D 组只扫 .md —— 对最可能出事的那份文件，文本 grep 这条保险是**失效的**。
// 做法：直接解析 SEED_PLANS 的 price / days 字段做逐值断言；不依赖注释文本，不会自我命中。
const EXPECT_PLANS = {
  plan_basic_month:    { price: 2590,  days: 31,  label: '月包' },
  plan_basic_quarter:  { price: 6900,  days: 90,  label: '季包' },
  plan_basic_year:     { price: 19900, days: 365, label: '年包' },
  plan_auto_subscribe: { price: 1990,  days: 31,  label: '自动续费(月)' },
};
const planIssues = [];
const initDbSrc = read('prototype/init_db.js');
for (const [id, exp] of Object.entries(EXPECT_PLANS)) {
  const m = initDbSrc.match(
    new RegExp("plan_id:\\s*'" + id + "'[^}]*?price:\\s*(\\d+)[^}]*?days:\\s*(\\d+)")
  );
  if (!m) {
    planIssues.push(`[G1] init_db.js 找不到套餐 ${id} 的 price/days 定义（结构已变？） —— 应为 price=${exp.price} / days=${exp.days}`);
    continue;
  }
  if (+m[1] !== exp.price) {
    planIssues.push(`[G2] init_db.js ${id}(${exp.label}) price=${m[1]}，应为 ${exp.price}（分）—— P0-1 曾错写为 2990/7990/29900`);
  }
  if (+m[2] !== exp.days) {
    planIssues.push(`[G3] init_db.js ${id}(${exp.label}) days=${m[2]}，应为 ${exp.days} —— P0-1 曾把月包错写为 30 天`);
  }
}
// seedDemo 的"验收期永久解锁"常量：改动会静默破坏 22 项验收（演示店权益到期）
const seedDemoSrc = read('prototype/seed_demo.js');
if (!/expire_at:\s*new Date\('2099-12-31T23:59:59Z'\)\.getTime\(\)/.test(seedDemoSrc)) {
  planIssues.push('[G4] seed_demo.js 的 expire_at 不再是 2099-12-31T23:59:59Z（注释里出现该字样不算）—— demo 店权益将不再是"验收期永久解锁"，22 项验收会静默失败');
}

// ===================== H. 环境门禁结构断言（防回归，唯一会"静默污染生产库"的高危逻辑）=====================
// 背景：环境门禁匹配逻辑三次出方向性缺陷，每次都靠人眼/复审发现，且能静默通过 A~G 全部断言：
//   8a9c5e0  /^dev/ 前缀匹配 → 真实 ID 是 catering-dev-*（以 catering 开头）→ 误拦 dev，建库/灌数据静默失败
//   92ad740  白名单优先但 !/prod/ 落在白名单分支内 → DEV_ENV_ID 误配到 prod → prod 被放行
//   e8352db  TCB_ENV 兜底只写在 catch 内 → ENV 为空时兜底永不生效 → 误拦 dev 自身
// 此处把"方向正确"变成机械断言。全是否定式（缺什么/出现什么就 fail），只增严、不放松；只读文本，不碰环境门禁代码。
// ⚠️ 正则经实际写法校准（init_db.js:155-164 / seed_demo.js:75-84）：
//   H3 用更强断言（isDevEnv 那一行内含 && !/prod/.test，而非仅"字符串出现过"），确保 !/prod/ 在白名单之外恒生效；
//   H4 只禁"实际变量使用"（process.env.WX_ENV / .WX_ENV），放过了注释里"非 WX_ENV"这类说明；
//   H5 要求 TCB_ENV 写在 try 表达式内部（/try\s*\{[^}]*process\.env\.TCB_ENV/），能抓 e8352db 回归（catch 里有不算）；
//   H6 禁止 blocked 返回体回传 env 变量（env: / =env / ${env}），避开 'non-dev-env' 常量里的 env 子串误伤。
const gateHits = [];
const GATE_FILES = ['prototype/init_db.js', 'prototype/seed_demo.js'];
for (const gf of GATE_FILES) {
  const s = read(gf);
  if (/\/\^dev\//.test(s)) {
    gateHits.push(`[H1] ${gf} 出现 /^dev/ 前缀匹配 —— 真实环境 ID 形如 catering-dev-*（以 catering 开头），会误拦 dev（见 8a9c5e0）`);
  }
  if (!/DEV_ENV_ID/.test(s)) {
    gateHits.push(`[H2] ${gf} 缺少 DEV_ENV_ID 白名单分支`);
  }
  if (!/isDevEnv\s*=.*&&\s*!\/prod\/\.test\(/.test(s)) {
    gateHits.push(`[H3] ${gf} 缺少恒生效的 !/prod/ 兜底（须在 isDevEnv 那一行内、白名单之外）—— 白名单被误配到 prod 时 prod 会被放行（见 92ad740）`);
  }
  if (/process\.env\.WX_ENV|\.WX_ENV|getWXContext\(\)\.WX_ENV/.test(s)) {
    gateHits.push(`[H4] ${gf} 使用了非标准变量 WX_ENV，应为 TCB_ENV（注释里"非 WX_ENV"之类说明不算违规）`);
  }
  if (!/try\s*\{[^}]*process\.env\.TCB_ENV/.test(s)) {
    gateHits.push(`[H5] ${gf} 的 TCB_ENV 兜底未写在 try 表达式内部 —— ENV 为空时兜底永不生效、误拦 dev（见 e8352db）`);
  }
  if (/blocked:\s*true[^}]*(?:env\s*[:=]|[{,]\s*env\b|\$\{env\})/.test(s)) {
    gateHits.push(`[H6] ${gf} 的 blocked 返回体回传了 env（环境 ID 属敏感信息，core/06:58-62）`);
  }
  if (!/console\.error\(/.test(s)) {
    gateHits.push(`[H7] ${gf} 被拦时无服务端日志（[INITDB_BLOCKED]/[SEED_DEMO_BLOCKED]），无法排查`);
  }
}
notes.push(`环境门禁结构断言 : ${GATE_FILES.length} 个云函数（init_db / seed_demo）`);

// ---- C1 / D1 / E1 / F1 / G / H 组断言（必须在上面各组计算之后执行）----
for (const [fn, src] of usedFns) {
  if (!registered.has(fn)) {
    fails.push(`[C1] \`${fn}\`（首见于 ${src}）未登记进 core/10 §6 契约表（违反"函数名即契约"）`);
  }
}

for (const h of quotaHits) {
  fails.push(`[D1] 配额/价格旧值残留 ${h.rel}:${h.line} —— ${h.tip}\n        命中子句: ${h.clause}\n        整行原文: ${h.text}`);
}

for (const s of structureHits) {
  fails.push(`[E1] 表格结构损坏（孤儿表行）${s}\n        该行不在任何完整表格内 —— 常见成因：①引用块（>）插在表格中间把表行挤出；②表行之间夹了不带空行的散文行（CommonMark 下同样中断表格）。表行必须连续排列。`);
}

for (const c of charHits) {
  fails.push(`[F1] 字符损坏（U+FFFD）${c}\n        该行含替换字符 —— 通常是写入时字节序列损坏（如「一行」显示成「???行」）。须按原字补回，不可用其它字替代。`);
}

for (const d of derivHits) {
  fails.push(`[I1] 派生精度 5 位小数残余 ${d}`);
}

for (const h of h5Hits) {
  fails.push(`[J1] 非否定式出现「H5 购买页」（违反微信运营规范 5.13、P1-9 已判定删除）${h}\n        命中行必须是禁止 H5 购买页兜底的否定句（含 禁止/❌/不预留/不引导/禁硬编码 H5 之一）；肯定式引导 H5 = 把已删违规方案装回去`);
}

for (const g of planIssues) {
  fails.push(g);
}

for (const h of gateHits) {
  fails.push(h);
}

// ===================== K. 投喂链派生一致性（txt / html 必须等于 MD 单源）=====================
// 背景：8 份「批次N_提示词_可直接复制.txt」与「一键复制.html」均由 delivery/_gen_8batch_html.py
//       从 inscode喂投包_8批_自包含完整版.md 的「===== 批次 N 开始/结束 =====」标记间内容生成。
//       D4（桌面 HTML 落后一版）与 D7（批次 5 txt 残留旧配额口径）是同一根因：
//       改了 MD 没重跑生成器，而 A~J 没有任何一组看得见"派生件落后"。
// ⚠️ 必须先归一 \r\n → \n 再比：Python 文本模式写入用 os.linesep（Windows 下为 CRLF），
//    .txt / .html 含 CRLF 而 MD 读入为 LF，直接比字节会把**正确**的树判红（实测 raw_eq=false / norm_eq=true）。
const FEED_DIR  = path.join(ROOT, 'delivery');
const FEED_MD   = path.join(FEED_DIR, 'inscode喂投包_8批_自包含完整版.md');
const FEED_HTML = path.join(FEED_DIR, 'inscode喂投包_8批_一键复制.html');
const normNL = (s) => s.replace(/\r\n/g, '\n');
const FEED_MD_TXT = fs.readFileSync(FEED_MD, 'utf8');
const FEED_BLK = {};
for (let n = 0; n < 8; n++) {
  const sm = new RegExp(`^===== 批次 ${n} 开始 =====[ \\t]*$`, 'm').exec(FEED_MD_TXT);
  const em = new RegExp(`^===== 批次 ${n} 结束 =====[ \\t]*$`, 'm').exec(FEED_MD_TXT);
  FEED_BLK[n] = (sm && em) ? normNL(FEED_MD_TXT.slice(sm.index + sm[0].length, em.index).trim()) : null;
}
for (let n = 0; n < 8; n++) {
  if (FEED_BLK[n] === null) {
    fails.push(`[K1] MD 缺批次 ${n} 的开始/结束标记 —— 生成器会 WARN 并跳过，该批 txt/html 不会被生成`);
    continue;
  }
  const tf = path.join(FEED_DIR, `批次${n}_提示词_可直接复制.txt`);
  if (!fs.existsSync(tf)) {
    fails.push(`[K2] 缺 批次${n}_提示词_可直接复制.txt —— 重跑 delivery/_gen_8batch_html.py`);
  } else if (normNL(fs.readFileSync(tf, 'utf8')).trim() !== FEED_BLK[n]) {
    fails.push(`[K3] 批次${n} txt 与 MD 单源不一致（派生件落后）—— 重跑 delivery/_gen_8batch_html.py，勿手改 txt`);
  }
}
if (!fs.existsSync(FEED_HTML)) {
  fails.push('[K4] 缺 inscode喂投包_8批_一键复制.html —— 重跑 delivery/_gen_8batch_html.py');
} else {
  // 括号配对扫描（兼容 text 内含 ] 或 ]; 的情形，比正则 [\s\S]*? 更稳）
  const hSrc = fs.readFileSync(FEED_HTML, 'utf8');
  const mi = hSrc.indexOf('const BLOCKS = ');
  if (mi < 0) {
    fails.push('[K5] HTML 里找不到 const BLOCKS = ...（生成器结构已变？）');
  } else {
    const start = hSrc.indexOf('[', mi);
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = start; k < hSrc.length; k++) {
      const ch = hSrc[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) { end = k; break; } }
      }
    }
    if (end < 0) fails.push('[K6] HTML 的 BLOCKS 括号不匹配');
    else {
      let FB = null;
      try { FB = JSON.parse(hSrc.slice(start, end + 1)); } catch (e) { fails.push('[K7] HTML 的 BLOCKS 不是合法 JSON'); }
      if (FB) {
        if (FB.length !== 8) fails.push(`[K8] HTML 块数 = ${FB.length}，应为 8`);
        for (let n = 0; n < 8; n++) {
          const b = FB.find((x) => x.n === n);
          if (!b) { fails.push(`[K9] HTML 缺批次 ${n} 块`); continue; }
          if (normNL(b.text).trim() !== FEED_BLK[n]) {
            fails.push(`[K10] 批次${n} HTML 块与 MD 单源不一致（派生件落后）—— 重跑 delivery/_gen_8batch_html.py`);
          }
        }
      }
    }
  }

  // K11（A9）：小程序内 terms.js 必须与 specs 单源逐字一致（防双副本漂移）
  const TERMS_SPEC = path.join(ROOT, 'i18n', 'terms.js');
  const TERMS_MINI = path.join(ROOT, '..', '..', 'miniprogram', 'i18n', 'terms.js');
  if (!fs.existsSync(TERMS_MINI)) {
    fails.push('[K11] 缺 miniprogram/i18n/terms.js（小程序运行时要用它）');
  } else if (normNL(fs.readFileSync(TERMS_MINI, 'utf8')) !== normNL(fs.readFileSync(TERMS_SPEC, 'utf8'))) {
    fails.push('[K11] miniprogram/i18n/terms.js 与 specs/dev-specs/i18n/terms.js 不一致（双副本漂移）—— 以后者为准同步');
  }
}
notes.push(`投喂链派生一致性 : 8 txt + 8 html 块 vs MD 单源（CRLF 已归一）`);

// ===================== 输出 =====================
console.log('══════ 规范层一致性机械门禁 ══════');
notes.forEach((n) => console.log('  · ' + n));
console.log('');

if (fails.length === 0) {
  console.log('✅ 全部断言通过');
  console.log('   A/B 错误码三向一致 + 映射完整 : core/09 §1 ↔ §3 ↔ terms.js 已闭合');
  console.log('   C   云函数登记一致           : 全树引用的 admin 函数均已登记于 core/10 §6');
  console.log('   D   配额口径一致             : 无 M2=3 / M2 3个方案 / 免费≤3 / M3=8 张 / 单张导出免费 等 v1.1 旧值残留');
  console.log('   E   表格结构完整             : 无被引用块 / 散文行挤出表格的孤儿表行');
  console.log('   F   字符完整性               : .md / .js / .txt 均无 U+FFFD 替换字符');
  console.log('   G   套餐价格/天数一致       : init_db.js 四档 = 2590/6900/19900/1990，31/90/365/31');
  console.log('   H   环境门禁结构             : init_db/seed_demo 均无 /^dev/、含 DEV_ENV_ID 白名单 + 恒效 !/prod/ + try 内 TCB_ENV 兜底、blocked 不回传 env');
  console.log('   I   派生精度一致             : 无 6.6667 / 0.03333 / 9.76 等旧值残余（N13/N14/N22 回潮护栏）');
  console.log('   J   H5 购买页护栏           : 全树 .md+.txt 命中「H5 购买页」者均为否定句（禁止 H5 兜底），无肯定式引导（D1 护栏）');
  console.log('   K   投喂链派生一致         : 8 份 txt + 8 个 HTML 块均与 MD 单源逐字一致（CRLF 已归一，防 D4/D7 类派生件落后）');
  process.exit(0);
} else {
  console.log(`❌ 发现 ${fails.length} 处断裂：`);
  fails.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`));
  console.log('');
  console.log('修法提示：');
  console.log('  · A 类（缺 i18n 键） → 在 core/09 §3 表补一行 + i18n/terms.js ERROR_MESSAGES 补同键');
  console.log('  · B 类（缺映射）     → 在 i18n/terms.js CODE_TO_I18N 补 wire → i18n 条目');
  console.log('  · C 类（未登记函数） → 在 core/10 §6 契约表补一行函数名/入参/出参/鉴权');
  console.log('  · D 类（配额旧值）   → 改回 v1.4 口径：M1=1 账套 / M3=3 张 / M2 不限套；导出全禁');
  console.log('                         （若确属沿革记录，在同行加「作废 / 已回退 / 原规划」等豁免标记）');
  console.log('  · E 类（表格结构）   → 把被引用块 / 散文行挤出的表行移回表内（紧邻表头，保持连续）');
  console.log('  · F 类（字符损坏）   → 按原字补回被损坏的字（如「???行」补成「一行」），不可用其它字替代；');
  console.log('                         本组扫描 .md + .js + .txt，注意 .js 里的注释同样在扫描范围内');
  console.log('  · I 类（派生精度）   → 文档内出现 5 位小数金额（6.6667 / 0.03333）或旧笔误 9.76 即错：改为 4 位纪律值 6.66 / 0.0333 / 锚点 9.75；净料单位成本以 netCostPerGram 4 位为准');
  console.log('                         ⚠️ 本组只守 specs/dev-specs/：桌面派生层（C_桌面已生成交付物 / B_工作台_parse）');
  console.log('                         不在 A–K 任何一组覆盖内，那里的旧值只能靠「从仓库单源重生成」或「作废」消除');
  process.exit(1);
}
