// _mut_r147.js —— 批次 Q2/Q3 变异回灌：证新增判据不是假绿
// 纪律：每个变异**独立**注入 → 跑目标判据 → 必须转红 → 还原 → md5 必须等于基线。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const abs = (rel) => path.join(ROOT, rel);
const run = (rel, args) => cp.spawnSync(process.execPath, [rel].concat(args || []), { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });

const CASES = [
  {
    id: 'V1',
    desc: "计数写成 === 'calculated'（看起来很像 implements，实则把存量全排除）",
    file: 'cloudfunctions/saveCostCard/index.js',
    mut: (t) => t.replace("if (c.calc_status === 'draft') continue;", "if (c.calc_status !== 'calculated') continue;"),
    target: 'tools/check_quota_limits.js',
    guard: /L13-③/,
  },
  {
    id: 'V2',
    desc: '写侧草稿也计入额度（删掉 draft 过滤的效果）',
    file: 'cloudfunctions/saveCostCard/index.js',
    mut: (t) => t.replace("if (c.calc_status === 'draft') continue;", "if (c.calc_status === 'draft') { codes.add(c.card_code); continue; }"),
    target: 'tools/check_quota_limits.js',
    guard: /L13-②/,
  },
  {
    id: 'V3',
    desc: '读侧（checkQuota）计数退回按档案数（与写侧口径分叉）',
    file: 'cloudfunctions/checkQuota/index.js',
    mut: (t) => t.replace("if (c.calc_status === 'draft') continue; // 草稿：仅建档/保存，未出成本 ⇒ 不占额度", ''),
    target: 'tools/check_quota_limits.js',
    guard: /L13-②/,
  },
  {
    id: 'V4',
    desc: '写侧不再落 calc_status（将来草稿无人标注，且伙同 V1 会让计数漂）',
    file: 'cloudfunctions/saveCostCard/index.js',
    mut: (t) => t.replace("calc_status: 'calculated',", ''),
    target: 'review/evidence/_q3_entitlement_probe.js',
    guard: /saveCostCard 落库显式写/,
  },
  {
    id: 'V5',
    desc: "付费判定写成 >= now（到期当天仍算付费 ⇒ 用户到期当天多免费一天）",
    file: 'cloudfunctions/common/entitlement.js',
    mut: (t) => t.replace('return Number(expireAt || 0) > (now', 'return Number(expireAt || 0) >= (now'),
    target: 'cloudfunctions/exportData/selftest.js',
    guard: /FEATURE_LOCKED 兜底|付费用户/,
  },
  {
    id: 'V6',
    desc: "export 被从付费域清单里摘掉（导出付费墙当场失效，且无声无息）",
    file: 'cloudfunctions/common/entitlement.js',
    mut: (t) => t.replace("['export', 'm3_combo', 'm3_takeaway']", "['m3_combo', 'm3_takeaway']"),
    target: 'review/evidence/_q3_entitlement_probe.js',
    guard: /付费（到期未到）→ true/,
  },
];

const lines = [];
let ok = 0, bad = 0;
for (const c of CASES) {
  const fileAbs = abs(c.file);
  const base = fs.readFileSync(fileAbs, 'utf8');
  const baseMd5 = md5(fileAbs);
  const mutated = c.mut(base);
  if (mutated === base) { lines.push(`❌ ${c.id} 变异未生效（替换目标没命中）⇒ 脚本需修`); bad++; continue; }
  fs.writeFileSync(fileAbs, mutated, 'utf8');
  // V5/V6 涉及 common ⇒ 需同步派生副本才影响单源下游
  if (/entitlement\.js$/.test(c.file)) run('tools/sync_common.js');
  const r = run(c.target);
  const out = (r.stdout || '') + (r.stderr || '');
  const checkpoint = r.status !== 0 && c.guard.test(out);
  fs.writeFileSync(fileAbs, base, 'utf8');
  if (/entitlement\.js$/.test(c.file)) run('tools/sync_common.js');
  const restored = md5(fileAbs) === baseMd5;
  const pass = checkpoint && restored;
  if (pass) ok++; else bad++;
  lines.push(`${pass ? '✅' : '❌'} ${c.id} [${c.desc}] ⇒ ${checkpoint ? '守卫转红且点名 ' + (out.match(c.guard) || [''])[0] : '❗未转红=假绿'}; 还原 md5 ${restored ? '✓' : '✗ 不一致'}`);
}
lines.push('');
lines.push(`===== 变异回灌结果：${ok} 通过 / ${bad} 失败 =====`);
const outPath = abs('review/evidence/mutation_r147.txt');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
process.stdout.write(lines.join('\n') + '\n');
process.exit(bad === 0 ? 0 : 1);
