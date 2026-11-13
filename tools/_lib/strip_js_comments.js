'use strict';
// tools/_lib/strip_js_comments.js —— 「判据是否真挂进 SUITES」的唯一口径（R724l / 台账 R1-3）
//
// 背景：R723 修过一次假绿 —— `check_suite_coverage.js` 原来把 SUITES 脚本源码**原样拼接**
//   做 includes(f)，注释里随手写一句 `// 运行：node tools/check_x.js` 就能把没挂 SUITES
//   的判据算成「已间接引用」。修法是拼接前剥注释，且**引号感知**（字符串里的 http:// 不能切坏）。
//
// 🔴 R1-3 的「一松一紧」：check_suite_coverage 用了严格口径，而 check_bill_import_gate 的
//   S-④ 仍是 `/check_salesbills\.js/.test(verifyAll)` —— 对**整个 verify_all.js 全文**做正则，
//   注释里出现一次字符串就恒真。两个守卫对「同一件事」给出不同严格度，等于判据有后门。
//   ⇒ 把剥注释与 SUITES 块解析抽到本文件，两处共用；谁再自己写一份，由 S9 断言判红。
//
// ⚠️ 与 tools/check_m2_no_cost_rate.js:63-88 的 stripJs 同款算法；那个文件是独立脚本
//   （末尾 process.exit）、当前仍内置一份。它不判 SUITES，不影响本口径一致性；
//   将来若要彻底三处归一，需单独验证该文件后再改（本轮不动，如实登记）。

function stripJsComments(src) {
  let out = '', i = 0, st = null;
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
    out += c;
    i++;
  }
  return out;
}

// 只取 `const SUITES = [ ... ];` 这一段 —— 全文件扫会把 R59 的「收尾期望值」映射里的
// 路径也算成引用，让「只在收尾映射里出现、并未真挂 SUITES」的脚本被误判为已覆盖。
// 返回**原始文本**（含注释）；调用方须自行 stripJsComments。
function suitesBlock(src) {
  const start = src.indexOf('const SUITES = [');
  if (start < 0) return null;
  const end = src.indexOf('\n];', start);
  if (end < 0) return null;
  return src.slice(start, end);
}

// 从**已剥注释**的 SUITES 块里取所有单引号 .js 路径（即真正登记的数组元素）。
function suitePaths(blockClean) {
  return (String(blockClean || '').match(/'[^']+\.js'/g) || [])
    .map((s) => s.slice(1, -1));
}

module.exports = { stripJsComments, suitesBlock, suitePaths };
