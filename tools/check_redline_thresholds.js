// tools/check_redline_thresholds.js
// R111 · 经营红线阈值口径守卫（同族病第 18 例）
//
// 根因：M1 开发规范 M1.6「四红线」（房租占比 ≤15% / 人工占比 ≤20% / 菜品毛利率 ≥55% / 食材损耗率 ≤5%）
//   是**模块写码基线里的经营预警口径**。实扫：当前态只在两处出现 —— M1 规范（表 4 行）+ M3 规范（引用行），
//   而 `tools/` + `prototype/` 对这两份模块开发规范**零引用**（round80 引用次数扫描实测 0/0）
//   ⇒ 改任一侧的数字都不会有任何守卫报警，与 round61 套件数 / round64 红线条数同族。
//
// ⚠️ 裸扫必误杀（坑⑭ 第八次印证）：全仓 `specs` 里「房租|人工|毛利|损耗 + 数字%」命中 20+ 处，
//   全是**合法口径** —— S3 测试数据 65.625%、用例「损耗 5%」、PRODUCT_PLAN 自述的另一套警戒线。
//   ⇒ 只能走**语义标记单源**（与前 16 例同手法），弱面只打印明示、不判红。
//
// 判据（T1~T4，全部 fail-closed；解析不到即判红，不许静默放行）：
//   T1 声明 ≡ 表格   唯一声明处四个数 ≡ M1.6 表格四行（双向逐项）
//   T2 引用 ≡ 声明   M3 规范引用行四个数 ≡ 声明（双向逐项）
//   T3 单源不扩散    全仓 specs .md 中自称本口径唯一声明处者 == 1
//   T4 前提守卫      扫描面非空 / 含两份目标文档 / 排除面生效（不含 tools/）
//   W  弱面（只明示不判红）其它「占比+数字%」命中
//
// 扫描面用 fs.walk 而非 git ls-files —— 坑⑱：git ls-files 只扫 index，工作树新增源码零覆盖。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M1 = 'specs/dev-specs/core/开发规范v1.0_ModuleM1_月度盈利核算.md';
const M3 = 'specs/dev-specs/core/开发规范v1.0_ModuleM3_菜品成本卡.md';
const MARK = '经营红线阈值口径（唯一声明处）';
const KEYS = ['房租占比', '人工占比', '菜品毛利率', '食材损耗率'];

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ===== 扫描面：specs/**/*.md（工作树递归，排除 review/）=====
function walk(dir, acc) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'review') continue; walk(p, acc); }
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}
const docs = walk(path.join(ROOT, 'specs'), []);

// ===== T1 唯一声明处 ≡ M1.6 表格（双向）=====
console.log('===== T1 唯一声明处 ≡ M1.6 表格（双向）=====');
const m1 = rd(M1);
const declLine = m1.split(/\r?\n/).find((l) => l.includes(MARK));
check('T1-① 唯一声明处存在（fail-closed）', !!declLine, declLine ? 'M1 规范内已立声明' : `${M1} 内未找到标记行`);
const decl = {};
if (declLine) {
  const re = /(房租占比|人工占比|菜品毛利率|食材损耗率)\s*\*\*(\d+)\*\*/g;
  let m; while ((m = re.exec(declLine))) decl[m[1]] = Number(m[2]);
}
check('T1-② 声明解析到 4 项', Object.keys(decl).length === 4, `实得 ${Object.keys(decl).length} 项 ${JSON.stringify(decl)}`);

const table = {};
{
  const re = /^\|\s*(房租占比|人工占比|菜品毛利率|食材损耗率)\s*\|\s*[≤≥]\s*(\d+)%/gm;
  let m; while ((m = re.exec(m1))) table[m[1]] = Number(m[2]);
}
check('T1-③ 表格解析到 4 行', Object.keys(table).length === 4, `实得 ${JSON.stringify(table)}`);
for (const k of KEYS) {
  check(`T1-④ ${k} 声明 ≡ 表格`, decl[k] !== undefined && decl[k] === table[k], `声明 ${decl[k]} / 表格 ${table[k]}`);
}

// ===== T2 M3 引用行 ≡ 声明（双向）=====
console.log('\n===== T2 M3 引用行 ≡ 声明（双向）=====');
const m3 = rd(M3);
const refLine = m3.split(/\r?\n/).find((l) => l.includes('经营红线') && l.includes('M1.6'));
check('T2-① 引用行存在（fail-closed）', !!refLine, refLine ? 'M3 规范内已找到指向 M1.6 的引用行' : `${M3} 内未找到引用行`);
const ref = {};
if (refLine) {
  // ⚠️ 符号两侧允许空白 —— round80 M7 变异实证：写死「毛利≥55%」时，正确实现换成「毛利 ≥55%」
  //    就会被判成解析失败而转红（「绑字面」同族病，与 round58 E1 口径守卫同一形态）。
  const pairs = [['菜品毛利率', /毛利(?:率)?\s*[≥>=]\s*(\d+)\s*%/], ['房租占比', /房租\s*[≤<=]\s*(\d+)\s*%/], ['人工占比', /人工\s*[≤<=]\s*(\d+)\s*%/], ['食材损耗率', /损耗\s*[≤<=]\s*(\d+)\s*%/]];
  for (const [k, r] of pairs) { const m = r.exec(refLine); if (m) ref[k] = Number(m[1]); }
}
check('T2-② 引用解析到 4 项', Object.keys(ref).length === 4, `实得 ${JSON.stringify(ref)}`);
for (const k of KEYS) {
  check(`T2-③ ${k} 引用 ≡ 声明`, ref[k] !== undefined && ref[k] === decl[k], `引用 ${ref[k]} / 声明 ${decl[k]}`);
}

// ===== T3 口径单源不扩散 =====
console.log('\n===== T3 口径单源不扩散 =====');
const selfDecl = docs.filter((p) => {
  try { return fs.readFileSync(p, 'utf8').includes(MARK); } catch (_) { return false; }
});
check('T3-① 仅一份文档自称本口径单源', selfDecl.length === 1,
  `命中 ${selfDecl.length} 份${selfDecl.length ? '：' + selfDecl.map((p) => path.relative(ROOT, p)).join(', ') : ''}`);

// ===== T4 前提守卫（证明扫描面没打错）=====
console.log('\n===== T4 前提守卫（证明扫描面没打错）=====');
check('T4-① 扫描面非空（specs .md ≥ 25）', docs.length >= 25, `实得 ${docs.length} 份`);
check('T4-② 扫描面含两份目标文档', docs.some((p) => p.endsWith(path.basename(M1))) && docs.some((p) => p.endsWith(path.basename(M3))), '两份模块开发规范均在面内');
check('T4-③ 排除面生效（扫描面不含 tools/）', !docs.some((p) => p.includes(`${path.sep}tools${path.sep}`)), '守卫自身不在扫描面内（坑⑫ 自指误报）');

// ===== W 弱面：其它「占比 + 数字%」命中，只明示不判红 =====
console.log('\n===== W 弱面（其它阈值命中，只明示不判红）=====');
let weak = 0;
const weakRe = /(?:房租|人工|毛利|损耗)[^。；\n]{0,12}\d+%/g;
for (const p of docs) {
  let t = ''; try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
  weak += (t.match(weakRe) || []).length;
}
console.log(`  ⚠️ 全仓 specs .md 内「房租/人工/毛利/损耗 + 数字%」命中 ${weak} 处 —— 含 S3 测试数据 65.625%、用例「损耗 5%」、PRODUCT_PLAN 另一套警戒线等**合法口径** ⇒ 裸扫必误杀，故只明示不判红`);
check('W-① 弱面已打印（坑⑭ 第八次印证：裸扫数字必误杀）', weak >= 20, `命中 ${weak} 处`);

console.log(`\n===== 经营红线阈值口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
