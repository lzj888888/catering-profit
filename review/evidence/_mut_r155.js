'use strict';
// R155 变异回灌：证明 tools/check_unit_family.js 新增的 round155 判据真的能抓错（不是假绿）
//   覆盖 L4-⑭（换算系数右侧必须可选的 picker）/ ㉑（换单位保物理量）/ ㉒（值折算回克数）/
//   ㉓（单价标签带采购单位）/ ㉔（保存不静默兜底）/ ㉕（picker 索引与显示单位同源）/
//   L3-整包（件/箱/桶/公斤/千克 必须在池里）/ ⑫（手改保护，R155 由「按行」改「按块 or 行内」）
//   以及 C32（块写法正样本）自身的分辨力（把判据的块级识别拆掉 ⇒ C32 必须转红）。
//
// 铁律（R154 同款）：每条独立、锚点强制命中 1 次、跑完立刻还原、还原后 md5 全等。
//   组A = 把源码改回错误写法 ⇒ **必须转红**；组B = 语义等价改写 ⇒ **必须仍绿**（判行为不判文本）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const GUARD = 'tools/check_unit_family.js';
const MATEJS = 'pages/material/edit.js';
const MATEWXML = 'pages/material/edit.wxml';
const TERMS_A = 'miniprogram/i18n/terms.js';
const UNITS = 'utils/units.js';

const rd = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const wr = (rel, s) => fs.writeFileSync(path.join(REPO, rel), s, 'utf8');
const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');

function runGuard() {
  let out = '', rc = 0;
  try { out = execFileSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO }); }
  catch (e) { rc = (e.status == null ? -1 : e.status); out = (e.stdout || '') + (e.stderr || ''); }
  return { rc, out };
}
const judge = (out) => out.split(/\r?\n/).filter((l) => l.includes('❌'));

const PU_GUARD_HEAD = [
  '    if (sug != null && !this.data.convertTouched) {',
  '      // round155：带出建议值的同时，右侧二元组一并归位（值 = 建议克数、单位 = 该族基准词）',
  '      patch.convert_factor = String(sug);',
  '      patch.convQty = String(sug);',
].join('\n');

const MUTS = [
  // ---- 组A：错误写法 ⇒ 必须转红 ----
  { id: 'M1', name: '换算系数右侧退回静态词（去掉 onConvUnit 这个可选出口）', file: MATEWXML,
    from: '<picker range="{{convUnits}}" value="{{convUnitIndex}}" bindchange="onConvUnit">',
    to: '<picker range="{{convUnits}}" value="{{convUnitIndex}}" bindchange="onNoop">',
    expectRed: true, want: '不是 picker' },
  { id: 'M2', name: 'onConvUnit 换单位不保物理量（只改标签、数不动 ⇒ 成本差倍率）', file: MATEJS,
    from: '    const q = units.convertQtyText(this.data.convQty, this.data.convUnit, u);',
    to: '    const q = this.data.convQty;',
    expectRed: true, want: '没走 units.convertQtyText' },
  { id: 'M3', name: 'onConvQty 不折算回克数（值×单位没归一 ⇒ 落库口径漂）', file: MATEJS,
    from: 'convert_factor: String(units.toBase(q, this.data.convUnit)) },',
    to: 'convert_factor: String(q) },',
    expectRed: true, want: '没走 units.toBase' },
  { id: 'M4', name: '单价标签退回不带采购单位（195 是元/件还是元/斤靠猜）', file: TERMS_A,
    from: '    matPriceOf: (u) => `采购单价（元/${u}）`,',
    to: '    matPriceWithUnit: (u) => `采购单价（元/${u}）`,',
    expectRed: true, want: '缺 matPriceOf' },
  { id: 'M5', name: 'onSave 恢复静默兜底（老板清空的系数被悄悄换回建议值）', file: MATEJS,
    from: '      purchase_price_fen: purchasePriceFen,\n      convert_factor: cf,',
    to: '      purchase_price_fen: purchasePriceFen,\n      convert_factor: cf || units.suggestConvert(this.data.purchase_unit) || 1,',
    expectRed: true, want: '静默兜底' },
  { id: 'M6', name: 'conv-wrap 块内写死「克」（页面存第二份单位口径）', file: MATEWXML,
    from: '<view class="conv-unit">{{convUnit}}</view>',
    to: '<view class="conv-unit">克 {{convUnit}}</view>',
    expectRed: true, want: '写死' },
  { id: 'M7', name: '把「值+单位」二元组挪出 convertTouched 保护（手改后又被冲掉）', file: MATEJS,
    from: PU_GUARD_HEAD,
    to: '    patch.convQty = String(sug);\n' + PU_GUARD_HEAD.split('\n').slice(0, 3).join('\n'),
    expectRed: true, want: 'convQty' },
  // ⚠️ 这条改的是**守卫自己**：拆掉块级识别 ⇒ C32 正样本必须转红。
  //   （若拆了仍绿，说明 C32 是被"行内"分支顺带救活的 ⇒ 块级判据本体没被验过。）
  { id: 'M8', name: '拆掉判据的块级识别（只留按行）⇒ C32 正样本必须被抓成假红', file: GUARD,
    from: '    if (key.test(cond)) ranges.push({ start: j, end: k });\n  }\n  return ranges;',
    to: '    if (key.test(cond)) ranges.push({ start: j, end: k });\n  }\n  return [];',
    expectRed: true, want: '假红' },
  { id: 'M9', name: 'picker 选中索引写死 0（格子显示「克」而展开高亮「斤」）', file: MATEJS,
    from: '    convUnitIndex: Math.max(0, units.QTY_UNITS.indexOf(units.baseWordOf(TERMS.card.matUnitDefault))),',
    to: '    convUnitIndex: 0,',
    expectRed: true, want: '字面量' },
  { id: 'M10', name: '把「件」从采购单位池里删掉（整包采买的主语没了 ⇒ chips 上无处落）', file: UNITS,
    from: "'箱', '桶', '件']",
    to: "'箱', '桶']",
    expectRed: true, want: '件' },

  // ---- 组B：语义等价改写 ⇒ 必须仍绿（判行为不判文本）----
  { id: 'B1', name: 'onConvUnit 局部变量改名（等价）', file: MATEJS,
    from: [
      '    const u = this.data.convUnits[i] || this.data.convUnit;',
      '    const q = units.convertQtyText(this.data.convQty, this.data.convUnit, u);',
      '    this.setData({ convUnit: u, convUnitIndex: i, convQty: q, convertTouched: true,',
      '      convert_factor: String(units.toBase(q, u)) }, () => this.refreshUnitHint());',
    ].join('\n'),
    to: [
      '    const unitWord = this.data.convUnits[i] || this.data.convUnit;',
      '    const qtyText = units.convertQtyText(this.data.convQty, this.data.convUnit, unitWord);',
      '    this.setData({ convUnit: unitWord, convUnitIndex: i, convQty: qtyText, convertTouched: true,',
      '      convert_factor: String(units.toBase(qtyText, unitWord)) }, () => this.refreshUnitHint());',
    ].join('\n'),
    expectRed: false, want: '' },
  { id: 'B2', name: 'onConvQty 的 setData 换成多行块排版（等价）', file: MATEJS,
    from: '    this.setData({ convQty: q, convertTouched: true, convert_factor: String(units.toBase(q, this.data.convUnit)) },\n      () => this.refreshUnitHint());',
    to: '    this.setData({\n      convQty: q,\n      convertTouched: true,\n      convert_factor: String(units.toBase(q, this.data.convUnit)),\n    }, () => this.refreshUnitHint());',
    expectRed: false, want: '' },
  { id: 'B3', name: 'pickUnit 守卫块内两行调换顺序（等价）', file: MATEJS,
    from: '      patch.convQty = String(sug);\n      patch.convUnit = units.baseWordOf(u);',
    to: '      patch.convUnit = units.baseWordOf(u);\n      patch.convQty = String(sug);',
    expectRed: false, want: '' },
  { id: 'B4', name: 'pickUnit 守卫块压成单行内联写法（等价，验证"行内"分支仍被接受）', file: MATEJS,
    from: [
      '    if (sug != null && !this.data.convertTouched) {',
      '      // round155：带出建议值的同时，右侧二元组一并归位（值 = 建议克数、单位 = 该族基准词）',
      '      patch.convert_factor = String(sug);',
      '      patch.convQty = String(sug);',
      '      patch.convUnit = units.baseWordOf(u);',
      '      patch.convUnitIndex = Math.max(0, units.QTY_UNITS.indexOf(patch.convUnit));',
      '    }',
    ].join('\n'),
    to: '    if (sug != null && !this.data.convertTouched) { patch.convert_factor = String(sug); patch.convQty = String(sug); patch.convUnit = units.baseWordOf(u); patch.convUnitIndex = Math.max(0, units.QTY_UNITS.indexOf(patch.convUnit)); }',
    expectRed: false, want: '' },
];

const files = [...new Set(MUTS.map((m) => m.file))];
const base = {};
files.forEach((f) => { base[f] = md5(f); });

let pass = 0, fail = 0;
const log = [];
log.push('===== R155 变异回灌（守卫 tools/check_unit_family.js）=====');
log.push('受改文件基线 md5：');
files.forEach((f) => log.push('  ' + f + ' = ' + base[f]));
log.push('');

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
    + ' | 点名=' + (badLines.length ? badLines[0].trim().slice(0, 130) : '(无)')
    + ' | 命中关键词[' + m.want + ']=' + hitWant
    + ' | 还原md5全等=' + restored);
}

const post = runGuard();
log.push('');
log.push('[还原后基线] rc=' + post.rc + ' | ❌ ' + judge(post.out).length + ' 条');
const allRestored = files.every((f) => md5(f) === base[f]);
log.push('全部受改文件 md5 全等 = ' + allRestored);
if (!allRestored || post.rc !== 0) fail++;
log.push('');
log.push('===== R155 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');

const target = path.join(REPO, 'review/evidence/mutation_r155.txt');
fs.writeFileSync(target, log.join('\n'), 'utf8');
process.stdout.write(log.join('\n') + '\n');
process.stdout.write('\n[落盘] review/evidence/mutation_r155.txt\n');
