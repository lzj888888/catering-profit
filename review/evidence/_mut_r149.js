// _mut_r149.js —— R149 单位换算守卫的变异回灌（证明不是假绿）
// 手法：逐条把源码改回**错误写法**（独立、可还原），看守卫是否转红；语义等价改写应保持绿。
// 判据：每条变异「期望红/绿」与实际一致才算通过；全部还原后 md5 必须逐字节回到基线。
'use strict';
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const crypto = require('crypto');

const R = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const NODE = 'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const GUARD = 'tools/check_unit_convert.js';

const CARD = 'pages/card/edit.js';
const UNITS = 'utils/units.js';

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(path.join(R, p))).digest('hex');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(R, p), s);
function runGuard() {
  const r = cp.spawnSync(NODE, [GUARD], { cwd: R, encoding: 'utf8' });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const base = { [CARD]: read(CARD), [UNITS]: read(UNITS) };
const baseMd5 = { [CARD]: md5(CARD), [UNITS]: md5(UNITS) };

// ---- 变异定义：[名字, 期望('red'|'green'), 改法, 还原] ----
const mutations = [
  {
    name: 'M1 onQtyUnit 只换标签不换数（删掉 convertQtyText）',
    expect: 'red',
    apply: () => {
      let s = read(CARD);
      const before = s;
      s = s.replace(
        'qty: units.convertQtyText(cur.qty, from, next)',
        'qty: cur.qty'
      );
      if (s === before) throw new Error('M1 锚点未命中（源码已变，变异脚本要跟）');
      write(CARD, s);
    },
  },
  {
    name: 'M2 buildCalcLines 绕过单位换算（回去用 Number(l.qty)）',
    expect: 'red',
    apply: () => {
      let s = read(CARD);
      const before = s;
      // 只改 buildCalcLines 里的那两处（toBase → Number(l.qty)）
      s = s.replace('out.push({ quantity: qtyBase, net_unit_cost: wan });', 'out.push({ quantity: Number(l.qty), net_unit_cost: wan });');
      s = s.replace('out.push({ quantity: qtyBase, net_unit_cost: m.net_unit_cost });', 'out.push({ quantity: Number(l.qty), net_unit_cost: m.net_unit_cost });');
      if (s === before) throw new Error('M2 锚点未命中');
      write(CARD, s);
    },
  },
  {
    name: 'M3 页面自抄倍率表（塞一行 {千克:1000}）',
    expect: 'red',
    apply: () => {
      let s = read(CARD);
      const before = s;
      s = s.replace(
        'const EDIT_CATS_KEY =',
        'const OWN_FACTOR = { \'千克\': 1000, \'升\': 1000 };\nconst EDIT_CATS_KEY ='
      );
      if (s === before) throw new Error('M3 锚点未命中');
      write(CARD, s);
    },
  },
  {
    name: 'M4 单源倍率被改错（千克 1000 → 100，两张表一起）',
    expect: 'red',
    apply: () => {
      let s = read(UNITS);
      const before = s;
      s = s.split("'千克': 1000,").join("'千克': 100,");
      if (s === before) throw new Error('M4 锚点未命中');
      write(UNITS, s);
    },
  },
  {
    // ⚠️ 这一条是**回灌发现真缺口后补的**：M4 首版只改「第一个」匹配 ⇒ 命中 CONVERT_SUGGEST
    //    （采购单位建议表），当时守卫全绿 —— 说明那张表当年没有断言。补了 L2 建议系数断言后，
    //    本条（只改 QTY_FACTOR）必须被 L2 行为断言抓住。
    name: 'M4b 只改用量倍率表 QTY_FACTOR（千克 1000 → 100）',
    expect: 'red',
    apply: () => {
      let s = read(UNITS);
      const before = s;
      s = s.replace("const QTY_FACTOR = { '克': 1, '千克': 1000, '毫升': 1, '升': 1000 };",
        "const QTY_FACTOR = { '克': 1, '千克': 100, '毫升': 1, '升': 1000 };");
      if (s === before) throw new Error('M4b 锚点未命中（QTY_FACTOR 那行被改过？）');
      write(UNITS, s);
    },
  },
  {
    name: 'M4c 「箱」被瞎猜一个换算系数（null → 500）',
    expect: 'red',
    apply: () => {
      let s = read(UNITS);
      const before = s;
      s = s.replace("  '升': 1000,\n};", "  '升': 1000,\n  '箱': 500,\n};");
      if (s === before) throw new Error('M4c 锚点未命中');
      write(UNITS, s);
    },
  },
  {
    name: 'M5 语义等价改写（自己乘 factorOf，不走 convertQtyText）',
    expect: 'green',
    apply: () => {
      let s = read(CARD);
      const before = s;
      s = s.replace(
        'qty: units.convertQtyText(cur.qty, from, next)',
        'qty: String(units.toBase(cur.qty, from) / units.factorOf(next))'
      );
      if (s === before) throw new Error('M5 锚点未命中');
      write(CARD, s);
    },
  },
  {
    name: 'M6 明细行换算说明被删（spec_hint 生产者去掉）',
    expect: 'red',
    apply: () => {
      let s = read(CARD);
      const before = s;
      s = s.replace(/specHintOf\s*\(m\)\s*\{/, 'specHintOfDISABLED(m) {');
      if (s === before) throw new Error('M6 锚点未命中');
      write(CARD, s);
    },
  },
];

let pass = 0, fail = 0;
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

log('# R149 变异回灌（守卫：' + GUARD + '）');
log('');
const r0 = runGuard();
log('基线：rc=' + r0.rc + '（期望 0）');
if (r0.rc !== 0) { log('❌ 基线就红 ⇒ 回灌无意义'); fail++; }
else pass++;

for (const m of mutations) {
  let err = '';
  try { m.apply(); } catch (e) { err = (e && e.message) || String(e); }
  if (err) { log('❌ ' + m.name + ' —— 取材失败：' + err); fail++; 
    // 还原后继续
    for (const k of Object.keys(base)) write(k, base[k]);
    continue;
  }
  const r = runGuard();
  const isRed = r.rc !== 0;
  const wantRed = m.expect === 'red';
  const okFlag = isRed === wantRed;
  const hit = (r.out.match(/❌[^\n]*/g) || []).slice(0, 2).map((x) => x.trim()).join(' | ');
  log((okFlag ? '✅' : '❌') + ' ' + m.name + ' ⇒ ' + (isRed ? '判红' : '保持绿') + '（期望' + (wantRed ? '红' : '绿') + '）rc=' + r.rc);
  if (hit) log('      点名：' + hit);
  okFlag ? pass++ : fail++;
  for (const k of Object.keys(base)) write(k, base[k]);
}

log('');
log('## 还原校验（md5 逐字节回到基线）');
let restoreOk = true;
for (const k of Object.keys(base)) {
  const now = md5(k);
  const same = now === baseMd5[k];
  if (!same) restoreOk = false;
  log((same ? '✅' : '❌') + ' ' + k + ' md5 ' + now + (same ? ' ≡ 基线' : ' ≠ 基线 ' + baseMd5[k]));
}
restoreOk ? pass++ : fail++;

log('');
const after = runGuard();
log('还原后复跑：rc=' + after.rc + '（期望 0）');
after.rc === 0 ? pass++ : fail++;

log('');
log('===== 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
fs.writeFileSync(
  path.join(R, 'review/evidence/mutation_r149.txt'),
  lines.join('\n') + '\n',
  'utf8'
);
process.exit(fail === 0 ? 0 : 1);
