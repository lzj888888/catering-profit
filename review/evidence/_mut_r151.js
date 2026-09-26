'use strict';
// R151 变异回灌：证明 tools/check_unit_family.js 真的能抓错（不是假绿）
// 铁律：每条独立、锚点强制命中 1 次、跑完立刻还原、还原后 md5 全等。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_m3/r151_tmp/';
const GUARD = 'tools/check_unit_family.js';
const U = 'utils/units.js';
const CJ = 'pages/card/edit.js';
const MI = 'pages/material/index.js';
const TM = 'miniprogram/i18n/terms.js';

const rd = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const wr = (rel, s) => fs.writeFileSync(path.join(REPO, rel), s, 'utf8');
const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');

function runGuard() {
  let out = '', rc = 0;
  try { out = execFileSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO }); }
  catch (e) { rc = (e.status == null ? -1 : e.status); out = (e.stdout || '') + (e.stderr || ''); }
  return { rc, out };
}
function judge(out) {
  const bad = out.split(/\r?\n/).filter((l) => l.includes('❌'));
  return bad;
}

const MUTS = [
  { id: 'M1', name: '用量池改回 4 项（池漂移）', file: U,
    from: 'const QTY_UNITS = PURCHASE_UNITS.slice();',
    to: "const QTY_UNITS = ['克', '千克', '毫升', '升'];", expectRed: true, want: 'L3 单位池漂移' },
  { id: 'M2', name: '倍率表删掉「箱」', file: U,
    from: "  '个': 1, '只': 1, '条': 1, '瓶': 1, '包': 1, '份': 1, '箱': 1, '桶': 1,",
    to: "  '个': 1, '只': 1, '条': 1, '瓶': 1, '包': 1, '份': 1, '桶': 1,", expectRed: true, want: 'QTY_FACTOR' },
  { id: 'M3', name: '族表删掉「个」', file: U,
    from: "  '个': 'count', '只': 'count', '条': 'count', '瓶': 'count',",
    to: "  '只': 'count', '条': 'count', '瓶': 'count',", expectRed: true, want: 'familyOf 判定不符' },
  { id: 'M4', name: '计数族基准词改回「克」', file: U,
    from: "const FAMILY_BASE_WORD = { weight: '克', volume: '毫升', count: '个' };",
    to: "const FAMILY_BASE_WORD = { weight: '克', volume: '毫升', count: '克' };", expectRed: true, want: 'baseWordOf' },
  { id: 'M5', name: '手工行单价不折算', file: CJ,
    from: '  const p = units.priceToBase(unitPriceYuan, priceUnit || units.BASE_UNIT);',
    to: '  const p = Number(unitPriceYuan) || 0;', expectRed: true, want: 'L4 手工行净料成本' },
  { id: 'M6', name: '列表页 spec_line 写死「克」', file: MI,
    from: " + ' ' + units.baseWordOf(m.purchase_unit || TERMS.card.matUnitDefault)",
    to: " + ' 克'", expectRed: true, want: 'L4 原料列表页' },
  { id: 'M7', name: '跨族判据改回页面自写', file: CJ,
    from: "    return units.isCrossFamily(pu, qu) ? TERMS.card.unitCrossWarn(pu, qu) : '';",
    to: "    return pu === qu ? '' : TERMS.card.unitCrossWarn(pu, qu);", expectRed: true, want: 'isCrossFamily' },
  { id: 'M8', name: '删掉 onManualPriceUnit', file: CJ,
    from: '  onManualPriceUnit(e) {',
    to: '  onManualPriceUnitX(e) {', expectRed: true, want: 'onManualPriceUnit' },
  { id: 'M9', name: '术语表 matConvert 改回写死「→克」', file: TM,
    from: "    matConvert: '换算系数',",
    to: "    matConvert: '换算系数（→克）',", expectRed: true, want: 'matConvert' },
  { id: 'M10', name: 'isCrossFamily 恒 false（永不提示）', file: U,
    from: "  if (fa === fb) return false;\n  return fa === 'count' || fb === 'count';",
    to: "  if (fa === fb) return false;\n  return false;", expectRed: true, want: 'isCrossFamily' },
  // 组B：语义等价改写 —— **不该红**（证明判据判行为不判文本）
  { id: 'B1', name: 'baseWordOf 等价改写（不走 familyOf）', file: U,
    from: "function baseWordOf(unit) {\n  return FAMILY_BASE_WORD[familyOf(unit)];\n}",
    to: "function baseWordOf(unit) {\n  const f = UNIT_FAMILY[String(unit == null ? '' : unit).trim()] || 'weight';\n  return FAMILY_BASE_WORD[f];\n}", expectRed: false, want: '' },
];

const base = {};
[...new Set(MUTS.map((m) => m.file))].forEach((f) => { base[f] = md5(f); });

let pass = 0, fail = 0;
const log = [];
log.push('===== R151 变异回灌（守卫 tools/check_unit_family.js）=====');

const pre = runGuard();
log.push('[基线] rc=' + pre.rc + ' | ❌ ' + judge(pre.out).length + ' 条');
if (pre.rc !== 0) { log.push('!! 基线非绿，回灌无意义 —— 中止'); fail++; }

for (const m of MUTS) {
  const orig = rd(m.file);
  const cnt = orig.split(m.from).length - 1;
  if (cnt !== 1) { log.push('❌ ' + m.id + ' 锚点命中 ' + cnt + ' 次（期望 1）—— 跳过'); fail++; continue; }
  wr(m.file, orig.replace(m.from, m.to));
  let r;
  try { r = runGuard(); } catch (e) { r = { rc: -1, out: String(e && e.message) }; }
  wr(m.file, orig);
  const restored = md5(m.file) === base[m.file];
  const badLines = judge(r.out);
  const hitWant = m.want ? r.out.includes(m.want) : false;
  const okExpect = (m.expectRed ? (r.rc !== 0) : (r.rc === 0));
  const good = okExpect && restored && (m.expectRed ? hitWant : true);
  if (good) pass++; else fail++;
  log.push((good ? '✅ ' : '❌ ') + m.id + ' ' + m.name
    + ' | rc=' + r.rc + ' | 期望' + (m.expectRed ? '红' : '绿')
    + ' | 点名=' + (badLines.length ? badLines[0].trim().slice(0, 110) : '(无)')
    + ' | 命中关键词[' + m.want + ']=' + hitWant
    + ' | 还原md5全等=' + restored);
}

const post = runGuard();
log.push('[还原后基线] rc=' + post.rc + ' | ❌ ' + judge(post.out).length + ' 条');
const allRestored = Object.keys(base).every((f) => md5(f) === base[f]);
log.push('全部受改文件 md5 全等 = ' + allRestored);
log.push('');
log.push('===== 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
const text = log.join('\n') + '\n';
fs.writeFileSync(OUT + 'mutation_r151.txt', text, 'utf8');
console.log(text);
