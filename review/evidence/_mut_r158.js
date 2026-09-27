// _mut_r158.js —— R144 快照字段守卫的变异回灌（证明非假绿）
// 纪律：修复 ≠ 闭环。**双向**都测：
//   ① 错误写法 ⇒ 必须转红**且点名到目标字段/判据**（证明判据真在管这事）
//   ② 语义等价改写 ⇒ 必须**仍绿**（证明判据判行为不判字面，不误伤正确改动）
// 每条改完立刻还原，并校验受改文件 md5 与基线**逐字节相等**。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO, 'tools/check_snapshot_fields.js');
const F = {
  gc: path.join(REPO, 'cloudfunctions/getCostCard/service.js'),
  gv: path.join(REPO, 'cloudfunctions/getCardVersions/service.js'),
  ss: path.join(REPO, 'cloudfunctions/saveCostCard/service.js'),
};

const BASE = {};
for (const k in F) BASE[k] = fs.readFileSync(F[k], 'utf8');
BASE.guard = fs.readFileSync(GUARD, 'utf8');

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }
function baseMd5(p) { return md5(fs.readFileSync(p, 'utf8')); }

function runGuard() {
  try {
    const out = cp.execSync('"' + process.execPath + '" "' + GUARD + '"', { cwd: REPO, encoding: 'utf8' });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status == null ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const rows = [];
function mutate(name, target, mutateFn, expectRed, mustMention) {
  const orig = fs.readFileSync(target, 'utf8');
  const changed = mutateFn(orig);
  if (changed === orig) {
    rows.push(['❌', name, '变异未生效（改后与原文相同 ⇒ 本次无证据）']);
    return;
  }
  fs.writeFileSync(target, changed, 'utf8');
  const r = runGuard();
  const red = r.rc !== 0;
  const mentioned = !mustMention || r.out.indexOf(mustMention) >= 0;
  const pass = (expectRed ? red : !red) && mentioned;
  fs.writeFileSync(target, orig, 'utf8');           // 还原
  const same = baseMd5(target) === md5(orig);        // 自证还原
  rows.push([pass && same ? '✅' : '❌', name,
    'rc=' + r.rc + (expectRed ? '（期望非0）' : '（期望0）')
    + (mustMention ? ' 点名' + mustMention + '=' + mentioned : '')
    + ' 还原md5' + (same ? '一致' : '❌不一致')]);
}

// ---------- 错误写法：必红 ----------
mutate('M1 读侧 getCostCard 删掉 brand_spec', F.gc,
  (s) => s.replace(/[^\n]*\bbrand_spec\b[^\n]*\n?/, ''), true, 'brand_spec');

mutate('M2 读侧 getCardVersions 删掉 yield_rate（L3 也应红）', F.gv,
  (s) => s.replace(/[^\n]*\byield_rate\b[^\n]*\n?/, ''), true, 'yield_rate');

mutate('M3 写侧 saveCostCard/service 删掉 purchase_unit', F.ss,
  (s) => s.replace(/[^\n]*\bpurchase_unit\b[^\n]*\n?/, ''), true, 'purchase_unit');

mutate('M4 读侧 fail-soft 去掉兜底（直接取 doc.brand_spec）', F.gc,
  (s) => s.replace(/brand_spec: doc\.brand_spec \|\| ''/, 'brand_spec: doc.brand_spec'), true, 'L4');

mutate('M5 S1 扫描面阈值抬高到不可能（自失效护栏）', GUARD,
  (s) => s.replace("allSrc.length > 20000", "allSrc.length > 99999999"), true, 'S1');

// ---------- 语义等价改写：必绿 ----------
mutate('B1 读侧字段顺序颠倒（语义等价）', F.gc, (s) => {
  const i = s.indexOf('brand_spec:'), j = s.indexOf('yield_rate:');
  if (i < 0 || j < 0) return s;
  const a = s.slice(i, s.indexOf('\n', i) + 1);
  const b = s.slice(j, s.indexOf('\n', j) + 1);
  return s.slice(0, i) + b + s.slice(i + a.length, j) + a + s.slice(j + b.length);
}, false, null);

mutate('B2 字段名出现在注释里（等价噪声）', F.gc, (s) =>
  s.replace('function lineToOutput', '// brand_spec purchase_unit purchase_price convert_factor yield_rate\nfunction lineToOutput'),
  false, null);

// ---------- 输出 ----------
const fail = rows.filter((r) => r[0] === '❌').length;
console.log('===== R144 快照字段守卫 · 变异回灌 =====');
for (const [m, n, d] of rows) console.log('  ' + m + ' ' + n + ' — ' + d);
console.log('变异回灌结果：' + (rows.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
