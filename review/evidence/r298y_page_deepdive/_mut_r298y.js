// review/evidence/r298y_page_deepdive/_mut_r298y.js —— R298Y 守卫「变异回灌」证明（非恒真）
//
// 纪律（本仓既有）：
//   · **单点变异**：每次只改一处；
//   · 替换串**未逐字命中即 `exit 2`**（防"改错地方还以为证明了"）；
//   · **就地改 + 立即还原 + sha256 逐字节复核**（防残留污染真实交付）；
//   · 还原后必须**复跑归绿**，否则视为未还原。
//
// 覆盖：两个新守卫的每条关键腿，含**两处缺陷原样复现**（缺陷 B 复制丢 sub_card_ref / 缺陷 C 空修复）。
// 用法：在仓库根 `node review/evidence/r298y_page_deepdive/_mut_r298y.js`
//       （证据重定向：`> .../mutation_r298y.txt 2>&1`）

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = process.cwd();
const G1 = 'tools/check_m3_margin_bands.js';
const G2 = 'tools/check_m3_card_roundtrip.js';

const sha = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const absOf = (rel) => path.join(ROOT, rel);

// —— 变异表 ——
// 「缺陷 B / C 复现」两条的意义：把**修复前的原始形态**种回去，守卫必须点名，
//   而不是只在"我新造的怪东西"上报警（证明守卫守的是**真实回归**，不是形式）。
const MUTS = [
  // ===== 守卫 1：毛利色阶单源 =====
  {
    id: 'M1',
    desc: '单源阈值 MID 40 → 30（回到"筛选 30 / 色带 40"那套错口径）',
    file: 'utils/marginBand.js',
    from: "const MID = 40;    // ≥40% 且 <60% ⇒ 中；<40% ⇒ 低",
    to: "const MID = 30;    // ≥40% 且 <60% ⇒ 中；<40% ⇒ 低",
    guard: G1,
    expect: [/①-b 阈值 HIGH=60 \/ MID=40/, /② 行为实跑/],
  },
  {
    id: 'M2',
    desc: '页面改回硬编码分界（`margin >= 60` 游离字面量回流）',
    file: 'pages/card/index.js',
    from: "      if (mf && mf !== 'all' && !band.matchBand(mf, c.margin)) return false;",
    to: "      if (mf === 'high') return c.margin !== null && c.margin >= 60;",
    guard: G1,
    expect: [/③ 无游离阈值字面量/],
  },
  {
    id: 'M3',
    desc: 'terms.js 重新长出 marginMid 键（双副本会漂移的老路）',
    file: 'miniprogram/i18n/terms.js',
    from: "    marginAll: '全部',\n",
    to: "    marginAll: '全部',\n    marginMid: '中（30%~60%）',\n",
    guard: G1,
    expect: [/④ miniprogram\/i18n\/terms\.js 无 marginHigh\/Mid\/Low 键定义/],
  },

  // ===== 守卫 2：跨页往返保真 =====
  {
    id: 'M4',
    desc: '★缺陷 C 原样复现：删掉 load() 里的 card_type 映射（R297-⑥ 的空修复形态）',
    file: 'pages/card/version.js',
    from: "        card_type: v.card_type === 3 ? 3 : 1,\n",
    to: '',
    guard: G2,
    expect: [/① 卡级往返/, /card_type/],
  },
  {
    id: 'M5',
    desc: '★缺陷 C 原样复现（另一半）：删掉 load() 里的 specs 映射',
    file: 'pages/card/version.js',
    from: "        specs: v.specs || [],\n",
    to: '',
    guard: G2,
    expect: [/① 卡级往返/, /specs/],
  },
  {
    id: 'M6',
    desc: '行级同族：删掉 load() 行映射里的 line_type（卡级补了、行级漏了）',
    file: 'pages/card/version.js',
    from: "          line_type: l.line_type === 2 ? 2 : 1,\n",
    to: '',
    guard: G2,
    expect: [/②-a 行级往返/],
  },
  {
    id: 'M7',
    desc: '★缺陷 B 原样复现：onCopy 删掉子卡行分流（子卡行被当手工行送出）',
    file: 'pages/card/index.js',
    from: "            if (l.line_type === 2 || l.sub_card_ref) {\n              return { sub_card_ref: l.sub_card_ref || '', qty: Number(l.quantity) || 0 };\n            }\n",
    to: '',
    guard: G2,
    expect: [/③-b onCopy 体含 sub_card_ref|③-i onCopy/],
  },
  {
    id: 'M8',
    desc: '「读到了 ≠ 送出去了」：保留 `l.sub_card_ref` 判据，只删提交键',
    file: 'pages/card/index.js',
    from: "              return { sub_card_ref: l.sub_card_ref || '', qty: Number(l.quantity) || 0 };",
    to: "              return { qty: Number(l.quantity) || 0 };",
    guard: G2,
    expect: [/③-i onCopy \*\*提交字面量\*\*含 sub_card_ref/],
    alsoGreen: [/③-b onCopy 体含 sub_card_ref/],   // 关键：③-b 必须**仍然绿** ⇒ 证明 ③-i 不可省
  },
  {
    id: 'M9',
    desc: '出参层腿：删掉 getCostCard::lineToOutput 的 sub_card_ref（页面拿了后端没给）',
    file: 'cloudfunctions/getCostCard/service.js',
    from: "    sub_card_ref: doc.sub_card_ref || '',\n",
    to: '',
    guard: G2,
    expect: [/③-g 出参层两份 service 均给出 sub_card_ref/],
  },
];

const results = [];
let hard = 0;

for (const m of MUTS) {
  const abs = absOf(m.file);
  const orig = fs.readFileSync(abs, 'utf8');
  const before = sha(abs);
  console.log('\n--- ' + m.id + ' · ' + m.desc);
  console.log('    文件：' + m.file);
  if (orig.indexOf(m.from) < 0) {
    console.log('    ❌ EXIT2 替换串**未逐字命中** ⇒ 本变异作废（不许"改错地方还以为证明了"）');
    hard = 2;
    continue;
  }
  const occurrences = orig.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log('    ❌ EXIT2 替换串命中 ' + occurrences + ' 处（要求恰 1 处）⇒ 非单点变异');
    hard = 2;
    continue;
  }
  let r = null;
  try {
    fs.writeFileSync(abs, orig.split(m.from).join(m.to), 'utf8');
    const res = cp.spawnSync('node', [m.guard], { cwd: ROOT, encoding: 'utf8' });
    r = { code: res.status, out: String(res.stdout || '') + String(res.stderr || '') };
  } finally {
    fs.writeFileSync(abs, orig, 'utf8');
  }
  const after = sha(abs);
  const restored = (after === before);
  const red = r.code !== 0;
  const expectHit = m.expect.every((re) => re.test(r.out));
  const alsoOk = (m.alsoGreen || []).every((re) => re.test(r.out));
  // 还原后复跑归绿
  const res2 = cp.spawnSync('node', [m.guard], { cwd: ROOT, encoding: 'utf8' });
  const backGreen = res2.status === 0;
  const okAll = restored && red && expectHit && alsoOk && backGreen;
  if (!okAll) hard = Math.max(hard, 1);
  results.push({ id: m.id, restored, red, expectHit, alsoOk, backGreen, code: r.code });
  console.log('    守卫 RC=' + r.code + '（须非 0）· 点名腿命中=' + expectHit + ' · 保留腿仍绿=' + alsoOk
    + ' · 还原 sha 一致=' + restored + ' · 还原后复跑归绿=' + backGreen + '  ⇒ ' + (okAll ? 'PASS' : 'FAIL'));
  if (!expectHit) {
    console.log('    —— 守卫输出末尾 ——');
    console.log(r.out.split('\n').slice(-12).map((l) => '      ' + l).join('\n'));
  }
}

console.log('\n===== R298Y 变异回灌汇总 =====');
for (const x of results) {
  console.log((x.restored && x.red && x.expectHit && x.alsoOk && x.backGreen ? '✅ ' : '❌ ') + x.id
    + '  RC=' + x.code + ' 还原=' + x.restored + ' 点名=' + x.expectHit + ' 保留腿=' + x.alsoOk + ' 复绿=' + x.backGreen);
}
const good = results.filter((x) => x.restored && x.red && x.expectHit && x.alsoOk && x.backGreen).length;
console.log('变异 ' + good + '/' + MUTS.length + ' 全部：真红 + 点名腿命中 + 保留腿仍绿 + 逐字节还原 + 还原后归绿');
console.log('结论：两个守卫均**非恒真**，且守的是真实回归（含缺陷 B / C 的原样复现）');
process.exit(hard === 0 && good === MUTS.length ? 0 : (hard === 2 ? 2 : 1));
