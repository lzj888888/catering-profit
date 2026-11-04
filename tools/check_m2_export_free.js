// tools/check_m2_export_free.js —— M2 导出免费口径守卫（A6 / A7 · 2026-11-05 · 规范 v1.1 §1）
//
// 为什么需要它：A6 把「M2 对比表导出」从不免费改成免费之后，做变异复核时实测
//   `check_export_delivery` 与 `check_paywall_coverage` **全部照绿** ——
//   把 `m2_compare` 从豁免集合里去掉，没有任何守卫会响。
//   ⇒ 这条口径当时是**裸的**。本守卫就是补这个洞。
//
// 判据（四条，全部按「剥注释后的源码」判，防注释里写一句就喂成恒真）：
//   A1 M2 导出豁免集合必须**同时**含 m2_matrix 与 m2_compare
//      —— 同一个模块不许有两个口径（矩阵早就免费、对比表还收费，本身就不自洽）。
//   A2 「无需店铺上下文」必须是**独立变量**，且**只**含 m2_matrix
//      —— 合并进豁免集合会让 m2_compare 分支的 da / shopId 都未赋值，
//         而该分支要 `da.list('shop_sandbox')` 做归属校验 ⇒ 直接 TypeError 崩。
//   A3 免费的对比表**仍必须**做方案归属校验（免费 ≠ 可以导出别人的方案）。
//   A4 免费导出必须带「关于本表」署名页（A7：免费是为了传播，不是为了白送）。
//
// 反恒真：对源码做**内存变异**（不落盘），A1 / A2 必须各自转红，否则说明判据写宽了。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPORT_P = path.join(ROOT, 'cloudfunctions/exportData/index.js');

let pass = 0;
let failN = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${label}${detail ? ' —— ' + detail : ''}`); }
}

// 剥注释：整行 `//` 与行尾 `//`（不处理字符串里的 //，本文件不涉及 URL 字面量）
function stripComments(src) {
  return src.split('\n').map((ln) => {
    const i = ln.indexOf('//');
    return i >= 0 ? ln.slice(0, i) : ln;
  }).join('\n');
}

let raw;
try { raw = fs.readFileSync(EXPORT_P, 'utf8'); } catch (e) {
  console.error('❌ 读不到 cloudfunctions/exportData/index.js：' + e.message);
  process.exit(1);
}
const src = stripComments(raw);

console.log('\n===== M2 导出免费口径守卫（A6 / A7）=====');
console.log('单源：cloudfunctions/exportData/index.js');

// —— 表达式抽取（只取赋值语句右侧，到分号为止）——
function grabAssign(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);');
  const m = src.match(re);
  return m ? m[1] : null;
}

const freeExpr = grabAssign('isM2FreeExport');
const noShopExpr = grabAssign('isM2NoShop');

// A0 前提：两个变量都必须存在（防改名后两条断言恒真）
check('A0-① 能取到 isM2FreeExport 的赋值表达式', freeExpr !== null, freeExpr ? freeExpr.trim() : '未找到');
check('A0-② 能取到 isM2NoShop 的赋值表达式（「无需店铺」必须独立成变量）', noShopExpr !== null,
  noShopExpr ? noShopExpr.trim() : '未找到（可能被并进豁免集合 ⇒ 对比表导出会崩）');

// A1 豁免集合必须同时含两者
if (freeExpr) {
  check('A1 M2 导出豁免集合同时含 m2_matrix 与 m2_compare',
    /'m2_matrix'/.test(freeExpr) && /'m2_compare'/.test(freeExpr),
    freeExpr.trim());
}

// A2 无需店铺只含 matrix
if (noShopExpr) {
  check('A2 「无需店铺」只含 m2_matrix（并入 m2_compare ⇒ da/shopId 未定义、归属校验处崩）',
    /'m2_matrix'/.test(noShopExpr) && !/'m2_compare'/.test(noShopExpr),
    noShopExpr.trim());
}

// A3 对比表归属校验仍在
check('A3 免费的对比表仍做方案归属校验（免费 ≠ 可导别人的方案）',
  src.indexOf("'shop_sandbox'") >= 0,
  src.indexOf("'shop_sandbox'") >= 0 ? "存在 da.list('shop_sandbox', …)" : '归属校验被删了');

// A4 署名页
check('A4 免费导出带「关于本表」署名页（A7）',
  src.indexOf('buildAboutRows(') >= 0 && src.indexOf('关于本表') >= 0,
  src.indexOf('关于本表') >= 0 ? '存在「关于本表」工作表' : '署名页缺失');

// —— 变异回灌（内存，不落盘）——
console.log('\n— 变异回灌：证伪「恒真」—');
const mutA1 = src.replace(/const\s+isM2FreeExport\s*=\s*[^;]+;/, "const isM2FreeExport = scope === 'm2_matrix';");
const mutA1Expr = (mutA1.match(/const\s+isM2FreeExport\s*=\s*([^;]+);/) || [])[1] || '';
check('M1 变异「豁免集合去掉 m2_compare」⇒ A1 判据转红（证明它在管这件事）',
  !(/'m2_matrix'/.test(mutA1Expr) && /'m2_compare'/.test(mutA1Expr)),
  mutA1Expr.trim());

const mutA2 = src.replace(/const\s+isM2NoShop\s*=\s*[^;]+;/,
  "const isM2NoShop = scope === 'm2_matrix' || scope === 'm2_compare';");
const mutA2Expr = (mutA2.match(/const\s+isM2NoShop\s*=\s*([^;]+);/) || [])[1] || '';
check('M2 变异「把 m2_compare 并进无需店铺」⇒ A2 判据转红',
  !(/'m2_matrix'/.test(mutA2Expr) && !/'m2_compare'/.test(mutA2Expr)),
  mutA2Expr.trim());

// 反向：等价改写（多一个括号/换行）不得误杀
const eqExpr = " ( scope === 'm2_matrix' || scope === 'm2_compare' ) ";
check('M3 等价改写（加括号与空白）仍判绿（不误杀）',
  (/'m2_matrix'/.test(eqExpr) && /'m2_compare'/.test(eqExpr)) === true,
  eqExpr.trim());

console.log(`\n===== M2 导出免费口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN ? 1 : 0);
