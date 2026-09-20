// round61 变异脚本（取证用，跑完即删；不入库）
// 用法：node _mut_r61.js <M1|M2|M3|M4|M5|M6>
// 用 node 改写而非 Python：Python 写回会把 CRLF 规整成 LF ⇒ 假 M（§0.3⑨）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const RK = 'specs/dev-specs/★知识存储点_2026-09-10.md';

function edit(rel, from, to) {
  const fp = path.join(ROOT, rel);
  const s = fs.readFileSync(fp, 'utf8');
  if (!s.includes(from)) return false;
  fs.writeFileSync(fp, s.replace(from, to));
  return true;
}

const M = process.argv[2];
let ok = false;
if (M === 'M1') {
  // 当前态漂移：重启键 §1.1 回退成 68（实算 70）⇒ 必须红
  ok = edit(RK, '串 **70** 个套件', '串 **68** 个套件');
} else if (M === 'M2') {
  // 反向：正确实现换措辞（「串 N 个套件」→「共 N 个校验套件」）⇒ 必须仍绿
  ok = edit(RK, '串 **70** 个套件', '共 **70** 个校验套件');
} else if (M === 'M3') {
  // 序号声明写错：提审材料包「第 66 套件」→「第 61 套件」⇒ 必须红
  ok = edit('specs/dev-specs/上线材料_提审材料包_v1.md', '（第 66 套件 `env-ready` 已守）', '（第 61 套件 `env-ready` 已守）');
} else if (M === 'M4') {
  // fail-closed：破坏「一键校验入口」标题锚点 ⇒ 解析不到即红，不许静默跳过
  ok = edit(RK, '- **一键校验入口（改完必跑）**', '- 校验入口（改完必跑）');
} else if (M === 'M5') {
  // 排除面前提守卫不是恒真：把 review/ 排除改成不存在的目录 ⇒ C5 必须红
  ok = edit('tools/check_suite_count_claims.js', "(f) => f.startsWith('review/')", "(f) => f.startsWith('reviewX/')");
} else if (M === 'M7') {
  // 自指前提守卫不是恒真：在本守卫**代码行**（非注释）里写一句「第 66 套件」⇒ C6 必须红
  const fp = path.join(ROOT, 'tools/check_suite_count_claims.js');
  const s = fs.readFileSync(fp, 'utf8');
  if (!s.includes("  const failN = bad.length;")) return console.log('MUTATION_NOT_APPLIED M7'), process.exit(2);
  fs.writeFileSync(fp, s.replace("  const failN = bad.length;", "  const _x = '第 66 套件';\n  const failN = bad.length;"));
  ok = true;
} else if (M === 'M6') {
  // 覆盖层：从 SUITES 摘掉本守卫 ⇒ check_suite_coverage 的 S5 必须红（证明间接层真生效）
  // ⚠️ 本仓是 CRLF，from 串里带 \n 会恒不命中（§0.3⑨）⇒ 只匹配行内容、不带行尾
  ok = edit('verify_all.js', "  ['suite-count-claims',     'tools/check_suite_count_claims.js'],", '');
}
console.log(ok ? 'MUTATION_APPLIED ' + M : 'MUTATION_NOT_APPLIED ' + M);
process.exit(ok ? 0 : 2);
