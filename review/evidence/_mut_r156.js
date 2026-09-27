// review/evidence/_mut_r156.js —— R156 变异回灌（证明新守卫 tools/check_list_ux.js 不是假绿）
//
// 铁律（mutation-backfill / gate-suite-checklist §6）：
//   · 每条变异独立、锚点**强制命中 1 次**；命中 0 或 >1 ⇒ 该条作废不计数；
//   · 组 A（必红）要求守卫 **rc≠0** 且失败行**点名到指定断言**（别的套件顺带红不算）；
//   · 组 B（等价改写）要求守卫仍 **rc=0** —— 证明判据判行为不判字面；
//   · 每条跑完**立即还原**，并按 md5 自证「还原后与原文件全等」。
// 覆盖：L1 排序（含 applyFilter 真的调它）/ L2 三处出参 fail-soft / L3 置顶三处齐备 /
//       L4 选择页（含 buildGroups）/ L5 连续录入（含 🔴 清主键）/ L6 模板不得调方法。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';
const NODE = 'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const GUARD = 'tools/check_list_ux.js';

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// 同一锚点，LF / CRLF 两种行尾都试（本仓有**混合行尾**文件，单一 nl 常量会打空）
function replaceOnce(src, from, to) {
  if (src.split(from).length - 1 === 1) return { ok: true, out: src.replace(from, to) };
  const f2 = from.replace(/\n/g, '\r\n'), t2 = to.replace(/\n/g, '\r\n');
  if (src.split(f2).length - 1 === 1) return { ok: true, out: src.replace(f2, t2) };
  return { ok: false, n: src.split(from).length - 1 };
}

const MUTS = [
  // ================= 组 A：必红 =================
  { id: 'M1', name: 'sortList 不再按「最近编辑在前」（比较器恒 0）', file: 'pages/card/index.js',
    from: '      return (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0);',
    to: '      return 0;', expectRed: true, want: 'L1-①' },

  { id: 'M2', name: 'applyFilter 直接 setData(list)，绕开 sortList（排序写了不生效）', file: 'pages/card/index.js',
    from: '    this.setData({ list: this.sortList(marked) });',
    to: '    this.setData({ list: marked });', expectRed: true, want: 'L1-③' },

  { id: 'M3', name: 'getMaterial 出参把 updated_at 改名（原料列表排序键消失）', file: 'cloudfunctions/getMaterial/service.js',
    from: '    updated_at: doc.updated_at != null ? doc.updated_at : (doc.created_at != null ? doc.created_at : 0),',
    to: '    updated_at_x: doc.updated_at,', expectRed: true, want: 'L2-3' },

  { id: 'M4', name: 'getCostCard 出参去掉 created_at 兜底（存量卡排序全为 0）', file: 'cloudfunctions/getCostCard/service.js',
    from: '    updated_at: doc.updated_at != null ? doc.updated_at : (doc.created_at != null ? doc.created_at : 0),',
    to: '    updated_at: doc.updated_at != null ? doc.updated_at : 0,', expectRed: true, want: 'L2-1' },

  { id: 'M5', name: 'saveShopSetting/validate 不再校验 pinned_materials', file: 'cloudfunctions/saveShopSetting/validate.js',
    from: "  const pm = normPinList(src.pinned_materials, 'pinned_materials');\n  if (!pm.ok) return err(pm.msg);",
    to: '  const pm = { ok: true, value: undefined };', expectRed: true, want: 'L3-①' },

  { id: 'M6', name: 'getShopContext 不再下发 pinned_cards（列表页读不到置顶）', file: 'cloudfunctions/getShopContext/index.js',
    from: '    pinned_cards: Array.isArray(shop.pinned_cards) ? shop.pinned_cards : [],\n',
    to: '', expectRed: true, want: 'L3-①' },

  { id: 'M7', name: '原料选择回退原生 picker（100 项只能滚）', file: 'pages/card/edit.wxml',
    from: '<view class="picker" data-idx="{{index}}" bindtap="goPickMaterial">',
    to: '<picker mode="selector" range="{{materials}}" range-key="name" data-idx="{{index}}" bindchange="onMaterialChange"><view class="picker">',
    expectRed: true, want: 'L4-①' },

  { id: 'M8', name: '🔴 菜品卡 afterSaved 不清 card_code ⇒ 第二道覆盖第一道', file: 'pages/card/edit.js',
    from: "      // —— 编辑态 → 新建态（见上 🔴）——\n      isEdit: false,\n      card_code: '',",
    to: '      // —— 编辑态 → 新建态（见上 🔴）——\n      isEdit: false,', expectRed: true, want: 'L5-③' },

  { id: 'M9', name: '🔴 原料 afterSaved 不清 id ⇒ 第二个覆盖第一个', file: 'pages/material/edit.js',
    from: "      // —— 编辑态 → 新建态（见上 🔴）——\n      id: '',\n      isEdit: false,",
    to: '      // —— 编辑态 → 新建态（见上 🔴）——\n      isEdit: false,', expectRed: true, want: 'L5-④' },

  { id: 'M10', name: '原料列表模板改在 {{}} 内调 indexOf（恒 false、静默失效）', file: 'pages/material/index.wxml',
    from: '<text class="tag tag-pin" wx:if="{{item.pinned}}">',
    to: '<text class="tag tag-pin" wx:if="{{pinned.indexOf(item.id) >= 0}}">', expectRed: true, want: 'L6-②' },

  { id: 'M11', name: '保存路径不取 isEdit（编辑态与新增态走同一条收尾）', file: 'pages/card/edit.js',
    from: '    const wasEdit = this.data.isEdit;',
    to: '    const wasEdit = false;', expectRed: true, want: 'L5-①' },

  { id: 'M12', name: '选择页去掉 buildGroups（分组消失）', file: 'pages/material/pick.js',
    from: '  buildGroups() {',
    to: '  buildGroupsX() {', expectRed: true, want: 'L4-④' },

  // ================= 组 B：等价改写必绿 =================
  { id: 'B1', name: 'sortList 比较器抽成临时变量（行为等价）', file: 'pages/card/index.js',
    from: '      return (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0);',
    to: '      const ta = Number(a.updated_at) || 0;\n      const tb = Number(b.updated_at) || 0;\n      return tb - ta;',
    expectRed: false },

  { id: 'B2', name: 'getMaterial 出参行前加注释（行为等价）', file: 'cloudfunctions/getMaterial/service.js',
    from: '    updated_at: doc.updated_at != null',
    to: '    // round156 排序键\n    updated_at: doc.updated_at != null', expectRed: false },

  { id: 'B3', name: 'sortList 里 pins 取副本（行为等价）', file: 'pages/card/index.js',
    from: '  sortList(list) {\n    const pins = this.data.pinned || [];',
    to: '  sortList(list) {\n    const pins = (this.data.pinned || []).slice();', expectRed: false },
];

function runGuard() {
  try {
    const out = execFileSync(NODE, [GUARD], { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { rc: 0, out: String(out) };
  } catch (e) {
    return { rc: (e.status == null ? 1 : e.status), out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const base = runGuard();
console.log('基线（未变异）：rc=' + base.rc + ' / 末行 = ' + (base.out.trim().split('\n').pop() || ''));
if (base.rc !== 0) { console.log('!! 基线本身不是绿的，先修守卫再谈回灌。'); process.exit(1); }

let pass = 0, fail = 0;
const lines = [];

for (const m of MUTS) {
  const p = path.join(ROOT, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  const origMd5 = md5(orig);
  const r = replaceOnce(orig, m.from, m.to);
  if (!r.ok) {
    fail++;
    lines.push('!! ' + m.id + ' 锚点命中 ' + r.n + ' 次（应为 1）⇒ 本条作废：' + m.name);
    continue;
  }
  fs.writeFileSync(p, r.out, 'utf8');
  const g = runGuard();
  fs.writeFileSync(p, orig, 'utf8');                       // 立即还原
  const back = md5(fs.readFileSync(p, 'utf8'));
  const restored = back === origMd5;
  if (!restored) { fail++; lines.push('!! ' + m.id + ' 还原失败（md5 不一致）：' + m.file); continue; }

  if (m.expectRed) {
    const named = new RegExp('❌\\s*' + m.want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(g.out);
    if (g.rc !== 0 && named) { pass++; lines.push('OK ' + m.id + ' 必红且点名 ' + m.want + ' —— ' + m.name); }
    else { fail++; lines.push('XX ' + m.id + ' 期望红但 rc=' + g.rc + ' / 点名=' + named + '：' + m.name); }
  } else {
    if (g.rc === 0) { pass++; lines.push('OK ' + m.id + ' 等价改写仍绿 —— ' + m.name); }
    else {
      fail++;
      const firstBad = (g.out.split('\n').find((l) => l.indexOf('❌') >= 0) || '').trim();
      lines.push('XX ' + m.id + ' 等价改写被判红：' + m.name + '  ← ' + firstBad);
    }
  }
}

console.log('');
for (const l of lines) console.log('  ' + l);
console.log('');
console.log('===== R156 变异回灌：' + pass + ' / ' + (pass + fail) + ' 通过（受改文件 md5 全部还原）=====');

// 落证据
fs.writeFileSync(path.join(ROOT, 'review/evidence/mutation_r156.txt'),
  'R156 变异回灌证据（' + new Date().toISOString() + '）\n' +
  '守卫：' + GUARD + '\n基线：rc=' + base.rc + ' / ' + (base.out.trim().split('\n').pop() || '') + '\n\n' +
  lines.join('\n') + '\n\n合计：' + pass + ' / ' + (pass + fail) + ' 通过\n', 'utf8');

process.exit(fail === 0 ? 0 : 1);
