// _mut_r150.js —— R150/R132 守卫（tools/check_spec_derive.js）的变异回灌
// 手法：逐条把源码改回**错误写法**（独立、可还原），看守卫是否转红；语义等价改写应保持绿。
// 判据：每条变异「期望红/绿」与实际一致才算通过；全部还原后 md5 必须逐字节回到基线。
'use strict';
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const crypto = require('crypto');

const R = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const NODE = 'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const GUARD = 'tools/check_spec_derive.js';

// 键 → 路径（**循环一律按路径**：按键写会把内容写进一个叫 "SD" 的文件里）
const P = {
  SD: 'cloudfunctions/common/specDerive.js',
  SD_FLAT1: 'cloudfunctions/calcBom/cx_specDerive.js',
  SD_FLAT2: 'cloudfunctions/saveCostCard/cx_specDerive.js',
  SD_FLAT3: 'cloudfunctions/getCostCard/cx_specDerive.js',
  CB_SVC: 'cloudfunctions/calcBom/service.js',
  CB_VAL: 'cloudfunctions/calcBom/validate.js',
  SC_IDX: 'cloudfunctions/saveCostCard/index.js',
  GC_SVC: 'cloudfunctions/getCostCard/service.js',
  TERMS: 'miniprogram/i18n/terms.js',
};
const KEYS = Object.keys(P);

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(path.join(R, p))).digest('hex');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(R, p), s);
function runGuard() {
  const r = cp.spawnSync(NODE, [GUARD], { cwd: R, encoding: 'utf8' });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const base = {}, baseMd5 = {};
for (const k of KEYS) { base[k] = read(P[k]); baseMd5[k] = md5(P[k]); }
const restoreAll = () => { for (const k of KEYS) write(P[k], base[k]); };

// 改**单源 + 3 份扁平副本**（模拟"改完并 re-sync 过"的真实形态）。
//   只改单源会让 L1-③（副本≡单源）先红 —— 那样"期望绿"的等价改写样本就没法证明判据不假红。
const SD_TARGETS = [P.SD, P.SD_FLAT1, P.SD_FLAT2, P.SD_FLAT3];
function editSingleSource(repl) {
  let touched = 0;
  for (const t of SD_TARGETS) {
    const s = read(t), out = repl(s);
    if (out !== s) { write(t, out); touched++; }
  }
  if (touched === 0) throw new Error('锚点未命中（单源与三份副本都没匹配到）');
}
function editOne(p, repl) {
  const s = read(p), out = repl(s);
  if (out === s) throw new Error('锚点未命中：' + p);
  write(p, out);
}

const mutations = [
  {
    name: 'M1 恒等分支被删（系数全 1 也走 round）',
    expect: 'red',
    apply: () => editSingleSource((s) => s.replace(
      '    const qty = k === 1 ? q : Math.round(q * k * 1e6) / 1e6;',
      '    const qty = Math.round(q * k * 1e6) / 1e6;'
    )),
  },
  {
    name: 'M2 kindOf 恒返回 main（「调料不减半」失效）',
    expect: 'red',
    apply: () => editSingleSource((s) => s.replace(
      '  const k = line && line.line_kind;\n  return LINE_KINDS.indexOf(String(k)) >= 0 ? String(k) : LINE_KIND_DEFAULT;',
      '  return LINE_KIND_DEFAULT;'
    )),
  },
  {
    name: 'M3 coefOf 缺省按 0（漏配一类的成本归零）',
    expect: 'red',
    apply: () => editSingleSource((s) => s.replace(
      "  return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 1;",
      "  return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0;"
    )),
  },
  {
    name: 'M4 calcBom/validate 把 line_kind 洗掉（回到只保 {quantity,net_unit_cost}）',
    expect: 'red',
    apply: () => editOne(P.CB_VAL, (s) => s.replace(
      "cLines.push({ quantity: ln.quantity, net_unit_cost: ln.net_unit_cost, line_kind: rawKind || 'main' });",
      'cLines.push({ quantity: ln.quantity, net_unit_cost: ln.net_unit_cost });'
    )),
  },
  {
    name: 'M5 保存路径上做规格派生（规格成本可能进 total_cost）',
    expect: 'red',
    apply: () => editOne(P.SC_IDX, (s) => s.replace(
      "  const cardInsert = await da.insert('shop_cost_card', cardDoc);",
      "  common.deriveSpec(snap.lines, card.auxFen, (common.SPEC_PRESETS[0] || {}).coef);\n  const cardInsert = await da.insert('shop_cost_card', cardDoc);"
    )),
  },
  {
    name: 'M6 getCostCard 出参丢掉 line_kind（编辑-保存往返丢组件类型）',
    expect: 'red',
    apply: () => editOne(P.GC_SVC, (s) => s.replace("    line_kind: doc.line_kind || 'main',\n", '')),
  },
  {
    name: 'M7 前端组件键漂移（season → seasoning）',
    expect: 'red',
    apply: () => editOne(P.TERMS, (s) => s.replace(
      "lineKind: { main: '主料', aux: '辅料', season: '调料'",
      "lineKind: { main: '主料', aux: '辅料', seasoning: '调料'"
    )),
  },
  {
    name: 'M8 把派生内联一份进引擎副本（calcBom/service.js）',
    expect: 'red',
    apply: () => editOne(P.CB_SVC, (s) => s.replace(
      'module.exports = {\n  // 工具',
      'function deriveSpec(lines, auxFen, coef) { return { lines, auxFen }; }\nmodule.exports = {\n  // 工具'
    )),
  },
  {
    name: 'M9 语义等价改写（预设 season/pack 写 1.0 而非 1）',
    expect: 'green',
    apply: () => editSingleSource((s) => s.replace(
      '{ main: 0.5, aux: 0.7, season: 1, semi: 0.5, pack: 1 }',
      '{ main: 0.5, aux: 0.7, season: 1.0, semi: 0.5, pack: 1.0 }'
    )),
  },
  {
    name: 'M10 语义等价改写（恒等分支换成 if 语句）',
    expect: 'green',
    apply: () => editSingleSource((s) => s.replace(
      '    const qty = k === 1 ? q : Math.round(q * k * 1e6) / 1e6;',
      '    let qty = q;\n    if (k !== 1) qty = Math.round(q * k * 1e6) / 1e6;'
    )),
  },
];

let pass = 0, fail = 0;
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

log('# R150/R132 变异回灌（守卫：' + GUARD + '）');
log('');
const r0 = runGuard();
log('基线：rc=' + r0.rc + '（期望 0）');
if (r0.rc !== 0) { log('❌ 基线就红 ⇒ 回灌无意义'); fail++; } else pass++;

for (const m of mutations) {
  let err = '';
  try { m.apply(); } catch (e) { err = (e && e.message) || String(e); }
  if (err) {
    log('❌ ' + m.name + ' —— 取材失败：' + err);
    fail++;
    restoreAll();
    continue;
  }
  const r = runGuard();
  const isRed = r.rc !== 0;
  const wantRed = m.expect === 'red';
  const okFlag = isRed === wantRed;
  const hit = (r.out.match(/❌[^\n]*/g) || []).slice(0, 3).map((x) => x.trim()).join(' | ');
  log((okFlag ? '✅' : '❌') + ' ' + m.name + ' ⇒ ' + (isRed ? '判红' : '保持绿') + '（期望' + (wantRed ? '红' : '绿') + '）rc=' + r.rc);
  if (hit) log('      点名：' + hit);
  okFlag ? pass++ : fail++;
  restoreAll();
}

log('');
log('## 还原校验（md5 逐字节回到基线）');
let restoreOk = true;
for (const k of KEYS) {
  const now = md5(P[k]);
  const same = now === baseMd5[k];
  if (!same) restoreOk = false;
  log((same ? '✅' : '❌') + ' ' + P[k] + ' md5 ' + now + (same ? ' ≡ 基线' : ' ≠ 基线 ' + baseMd5[k]));
}
restoreOk ? pass++ : fail++;

log('');
const after = runGuard();
log('还原后复跑：rc=' + after.rc + '（期望 0）');
after.rc === 0 ? pass++ : fail++;

log('');
log('===== 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
fs.writeFileSync(path.join(R, 'review/evidence/mutation_r150.txt'), lines.join('\n') + '\n', 'utf8');
process.exit(fail === 0 ? 0 : 1);
