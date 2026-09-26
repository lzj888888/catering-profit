'use strict';
// R153 变异回灌：证明 tools/check_unit_family.js 新增六条（⑭⑮⑯⑰⑱⑲⑳）真的能抓错（不是假绿）
//   ⑭ 换算系数组合行  ⑮ 删行按钮离开录入方式行  ⑯ 删行带确认  ⑰ 确认键≤4字
//   ⑱ 单位格视觉区隔  ⑲ 用量与单位同排  ⑳ 卡片页不写死「克」兜底
// 铁律：每条独立、锚点强制命中 1 次、跑完立刻还原、还原后 md5 全等。
// 组A = 把源码改回错误写法 ⇒ **必须转红**；组B = 语义等价改写 ⇒ **必须仍绿**（判行为不判文本）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_m3/r153_tmp/';
const GUARD = 'tools/check_unit_family.js';
const MATEWXML = 'pages/material/edit.wxml';
const CARDWXML = 'pages/card/edit.wxml';
const CARDWXSS = 'pages/card/edit.wxss';
const CARDJS = 'pages/card/edit.js';
const TM_A = 'miniprogram/i18n/terms.js';

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

const MUTS = [
  // ---- 组A：错误写法 ⇒ 必须转红 ----
  { id: 'M1', name: '换算系数左侧短句写回固定「1 斤 =」（脱离术语表单源）', file: MATEWXML,
    from: '      <text class="conv-eq">{{convertLeft}}</text>\n',
    to: '      <text class="conv-eq">1 斤 =</text>\n', expectRed: true, want: '缺左侧短句' },
  { id: 'M2', name: '组合行右侧基准词写死「克」（第二份口径）', file: MATEWXML,
    from: '<text class="conv-eq conv-word">{{convBaseWord}}</text>',
    to: '<text class="conv-eq conv-word">克</text>', expectRed: true, want: '写死' },
  { id: 'M3', name: '删行按钮改回红「×」（语义打架回归）', file: CARDWXML,
    from: '    <view class="del-row" data-idx="{{index}}" bindtap="delLine">{{t.delLine}}</view>',
    to: '    <button class="btn-small" style="background:none;color:#e74c3c;min-height:88rpx;" data-idx="{{index}}" catchtap="delLine">×</button>',
    expectRed: true, want: '红「×」' },
  { id: 'M4', name: 'delLine 确认降级成 Toast（误触即删整行）', file: CARDJS,
    from: '    wx.showModal({\n      title: TERMS.card.delLineTitle,', to: '    wx.showToast({\n      title: TERMS.card.delLineTitle,', expectRed: true, want: '没有二次确认' },
  { id: 'M5', name: '确认键改成 6 字长文案（真机 showModal 直接 fail）', file: TM_A,
    from: "    delLineConfirmOk: '删除',", to: "    delLineConfirmOk: '删除这一行原料',", expectRed: true, want: '超 4 字' },
  { id: 'M6', name: '单位格去掉底色（50 又读作 50 克）', file: CARDWXSS,
    from: '.unit-pick { margin-left: 12rpx; padding: 0 24rpx; background: #e8eff7;',
    to: '.unit-pick { margin-left: 12rpx; padding: 0 24rpx;', expectRed: true, want: '没有底色' },
  { id: 'M7', name: '用量与单位全部拆回两行（两处 qty-wrap 都拆）', file: CARDWXML, all: true,
    from: '        <view class="qty-wrap">', to: '        <view class="cell2">', expectRed: true, want: 'qty-wrap 只有' },
  { id: 'M8', name: 'wxml 兜底写死「克」（页面第二份单位口径）', file: CARDWXML, all: true,
    from: '{{lines[index].qty_unit || baseUnit}}', to: "{{lines[index].qty_unit || '克'}}", expectRed: true, want: '写死兜底' },
  // ---- 组B：语义等价改写 ⇒ 必须仍绿 ----
  { id: 'B1', name: 'conv-wrap 加一个无关 class（等价）', file: MATEWXML,
    from: '    <view class="conv-wrap">', to: '    <view class="conv-wrap conv-x">', expectRed: false, want: '' },
  { id: 'B2', name: '.unit-pick 内边距微调（等价）', file: CARDWXSS,
    from: '.unit-pick { margin-left: 12rpx; padding: 0 24rpx;', to: '.unit-pick { margin-left: 12rpx; padding: 0 20rpx;', expectRed: false, want: '' },
  { id: 'B3', name: 'del-row 追加无关样式（等价）', file: CARDWXSS,
    from: 'color: #e74c3c; min-height: 88rpx; line-height: 88rpx; }',
    to: 'color: #e74c3c; min-height: 88rpx; line-height: 88rpx; letter-spacing: 0; }', expectRed: false, want: '' },
];

fs.mkdirSync(OUT, { recursive: true });
const base = {};
[...new Set(MUTS.map((m) => m.file))].forEach((f) => { base[f] = md5(f); });

let pass = 0, fail = 0;
const log = [];
log.push('===== R153 变异回灌（守卫 tools/check_unit_family.js 新增 ⑭~⑳）=====');

const pre = runGuard();
log.push('[基线] rc=' + pre.rc + ' | ❌ ' + judge(pre.out).length + ' 条');
if (pre.rc !== 0) { log.push('!! 基线非绿，回灌无意义 —— 中止'); fail++; }

for (const m of MUTS) {
  const orig = rd(m.file);
  const cnt = orig.split(m.from).length - 1;
  // all=true 的样本同一写法在文件里有多处，要**全量替换** ⇒ 只要求 ≥1 次；其余必须严格命中 1 次。
  if (m.all ? cnt < 1 : cnt !== 1) { log.push('❌ ' + m.id + ' 锚点命中 ' + cnt + ' 次（期望 ' + (m.all ? '≥1' : '1') + '）—— 跳过'); fail++; continue; }
  wr(m.file, m.all ? orig.split(m.from).join(m.to) : orig.replace(m.from, m.to));
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
if (!allRestored || post.rc !== 0) fail++;
log.push('');
log.push('===== 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
const text = log.join('\n') + '\n';
fs.writeFileSync(OUT + 'mutation_r153.txt', text, 'utf8');
console.log(text);
