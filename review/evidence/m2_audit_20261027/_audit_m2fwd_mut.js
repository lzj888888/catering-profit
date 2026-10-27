// _audit_m2fwd_mut.js —— 只读取证（E 节）：变异测试 —— 改了业务语义，门禁会不会转红？
// 子进程跑 `node -r hook tools/check_xxx.js`，钩子只在**进程内**替换源码，磁盘零改动。
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）

const GUARDS = [
  'tools/check_biz_preset.js',
  'tools/check_m2_biz_inputs.js',
  'tools/check_m2_entry_parity.js',
  'tools/check_m2_matrix.js',
  'tools/check_m2_reverse_rent.js',
  'tools/check_m2_no_cost_rate.js',
  'tools/check_m2_partial_behavior.js',
  'tools/check_m2_ref_not_prefill.js',
];
const IDX = path.join(ROOT, 'subpkg/tools/sandbox/index.js');
const BP = path.join(ROOT, 'utils/bizPreset.js');

const MUTS = [
  { id: 'H2  水电气「三项全>0」⇒「任一>0」', file: BP,
    from: 'if (w > 0 && elec > 0 && gas > 0) {', to: 'if (w > 0 || elec > 0 || gas > 0) {' },
  { id: 'H1  hasFixed 判据放宽为恒真', file: IDX,
    from: 'const hasFixed = p.fixed_items.length > 0;', to: 'const hasFixed = p.fixed_items.length >= 0;' },
  { id: 'H3  forward 的 fixedYuan 去掉 manage 键', file: IDX,
    from: 'fixedYuan: isReverse ? {} : { rent: this.data.rentYuan, manage: this.data.manageYuan },',
    to: 'fixedYuan: isReverse ? {} : { rent: this.data.rentYuan },' },
  { id: 'H4  前端固定合计少算房租', file: IDX,
    from: "const KEYS = ['rentYuan', 'laborTotalYuan', 'waterYuan', 'electricYuan', 'gasYuan', 'manageYuan'];",
    to: "const KEYS = ['laborTotalYuan', 'waterYuan', 'electricYuan', 'gasYuan', 'manageYuan'];" },
  { id: 'E5  RATE_COST_FLOOR 全部改 999999', file: BP,
    from: 'const RATE_COST_FLOOR = { fastfood: 8000, hotpot: 12000, dining: 12000, cafe: 8000, other: 10000 };',
    to: 'const RATE_COST_FLOOR = { fastfood: 999999, hotpot: 999999, dining: 999999, cafe: 999999, other: 999999 };' },
  { id: 'L2  回本月数改成带 2 位小数', file: IDX,
    from: 'invest: invest != null ? api.fenToYuan(api.yuanToFen(invest), 0) : null,',
    to: 'invest: invest != null ? api.fenToYuan(api.yuanToFen(invest), 2) : null,' },
  { id: 'M1  切业态时永远覆盖 otherPctNum', file: IDX,
    from: 'if (!this.data.fieldTouched.otherPct) {', to: 'if (true) {' },
  { id: 'F5  房租 rentPct 派生比例翻倍（fastfood 40→80）', file: BP,
    from: "{ itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 40, src: 'B' },",
    to: "{ itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 80, src: 'B' }," },
];

function runGuard(guard, env) {
  const r = spawnSync(process.execPath, ['-r', path.join(ROOT, '_audit_m2fwd_mut_hook.js'),
    path.join(ROOT, guard)], { cwd: ROOT, env: Object.assign({}, process.env, env || {}),
    encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
  const red = m ? Number(m[2]) : null;
  const mi = out.match(/\[mut\] 注入次数=(\d+)/);
  return { red, code: r.status, injected: mi ? Number(mi[1]) : 0,
    tail: out.trim().split('\n').slice(-1)[0] || '' };
}

console.log('=== E · 变异测试：改动业务语义后，各守卫是否转红（红=能抓到，绿=盲区）===\n');
console.log('（先跑一遍基线）');
const base = {};
for (const g of GUARDS) base[g] = runGuard(g, {});
for (const g of GUARDS) console.log('   基线 ' + g.padEnd(38) + ' 失败=' + base[g].red + ' exit=' + base[g].code);

for (const mu of MUTS) {
  console.log('\n--- ' + mu.id);
  let caught = 0; const seenInject = [];
  for (const g of GUARDS) {
    const r = runGuard(g, { MUT_FILE: mu.file, MUT_FROM: mu.from, MUT_TO: mu.to, MUT_VERBOSE: '1' });
    const baseRed = base[g].red;
    const isRed = (r.red != null && baseRed != null && r.red > baseRed) || (r.code !== 0 && base[g].code === 0);
    if (isRed) caught++;
    if (Math.max.apply(null, [0].concat(seenInject)) < r.injected) seenInject.push(r.injected);
    console.log('   ' + (isRed ? '🔴 抓到' : '🟢 漏过') + ' ' + g.padEnd(38)
      + ' 失败=' + r.red + '（基线 ' + baseRed + '） 注入=' + r.injected);
  }
  console.log('   ⇒ 注入已生效（次数 ' + Math.max.apply(null, [0].concat(seenInject)) + '）；'
    + caught + '/' + GUARDS.length + ' 个守卫能抓到');
}
