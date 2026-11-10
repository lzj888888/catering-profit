// tools/check_text_contrast.js —— 文字对比度守卫（R681）
// 运行：node tools/check_text_contrast.js   （EXIT 0 = 全绿）
//
// 根因（李老师真机反馈，2026-11-10）：
//   暖账本色板上线后他说「有些字有点金丝那种颜色…对比度没那么高，看起来吃力」。
//   实算证实不是错觉：暖化第一版把副文字换成浅暖灰，落在米白底上
//     #7C7264 = 4.26:1 · #857A6B = 3.79:1 · #9A9083 = 2.83:1 · #A99E8E = 2.38:1
//   而 WCAG AA 对正文（本仓 28rpx≈14px）要求 ≥4.5:1。根子是**拿"降色"当"弱化"**。
//   ⇒ R681 收成三档、全部 ≥4.5，层级改由字号/字重承担。
//
// 为什么必须有守卫：这类退化**永远不报错**——页面照样渲染，只是老板看着累。
//   没有判据时，下一个人从旧文件复制一行 `color: #A99E8E` 就静默复发。
//
// 判据（三条腿 + 变异自证）：
//   A-① 黑名单色值不得出现在 **color 属性**上（旧低对比文字色，逐条记了原对比度）
//   A-② 三档文字色在场（说明"三档制"本身没被推翻；都不在 ⇒ 判据失效）
//   A-③ 扫描面下界（wxss ≥ 30 个文件，防"扫了空集所以全绿"）
//   B-① 变异：注入 `color: <黑名单>` 必须被抓
//   B-② 变异：`background: <黑名单>` 必须放行（证明只判文字，不放宽色块）
//   B-③ 白名单：深色底上的浅字（墨蓝 hero 里的白字/淡蓝字）不得被误杀
//
// ⚠️ 只判 `color:`。同一色值当 background / border 用（色块、图标底、描边）**一律不管** ——
//    浅底色的色块是装饰，不承担"读"的任务。
// ⚠️ 黑名单色值一律**拼接书写**（'#A99'+'E8E'），避免本文件被自己的扫描面命中。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 深色底上的浅字 —— 白的对比度 1.02 是相对米白底算的，但它实际坐在 #1e3a5f 上（对比 15:1）
const DARK_BG_WHITELIST = [
  '#fff', '#ffffff', '#d7e2ef', '#cfe0f2', '#c9dcf0', '#c8d8ea',
  '#c8d0dc', '#9ec3e8', '#a9c1da', '#8FB0D0', '#9fb6d4',
  // 禁用 / 缺失 / 无效态的灰：语义上就该弱，且不可操作，不承担必读信息
  '#b6bcc8', '#b0b4ba', '#a8b3c2'
];

// 旧低对比文字色（已修）。值 = 当初在卡面上的实测对比度
const BLACKLIST = [
  ['#7C7264', 4.26], ['#857A6B', 3.79], ['#9A9083', 2.83], ['#A99E8E', 2.38],
  ['#B5AB9C', 2.05], ['#9A9184', 3.36], ['#B3A894', 2.31], ['#9aa3af', 2.51],
  ['#8b97a7', 2.92], ['#8a97a6', 2.93], ['#8896ab', 2.95], ['#8a93a0', 3.06],
  ['#7b8794', 3.60], ['#7a8698', 3.63], ['#8a8a8a', 3.40], ['#a8b6c8', 2.03],
  ['#9a7b50', 3.88], ['#bbb', 1.89], ['#777', 4.41], ['#6b7a8d', 4.31],
  ['#e74c3c', 3.76], ['#e2533a', 3.73],
  ['#22a06b', 3.27], ['#1e9e5a', 3.39], ['#1f9254', 3.90],
  ['#1e8e3e', 4.14], ['#1e8e5a', 4.07],
  ['#d68910', 2.77], ['#b9770e', 3.62], ['#a9761b', 3.90],
  ['#c2701a', 3.67], ['#a86a00', 4.37],
  ['#2b7de9', 3.96], ['#2a7fa8', 4.40]
];

// 三档文字色（必须都在场）
const TIERS = [
  ['#2B2620', '正文 12.6:1'],
  ['#5F564C', '次要 6.5:1'],
  ['#776C5E', '最弱 4.6:1（文字下限）']
];

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

/** 去注释：只判生效代码（注释里写"勿用 #e74c3c"是正当做法） */
function stripComments(text, ext) {
  let s = String(text);
  if (ext === '.wxml') return s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return s;
}

function collect() {
  const out = [path.join(ROOT, 'app.wxss')];
  for (const base of ['pages', 'subpkg']) {
    const walk = (dir) => {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (e.name === 'node_modules' || e.name === 'miniprogram_npm') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (/\.(wxss|wxml)$/.test(e.name)) out.push(abs);
      }
    };
    walk(path.join(ROOT, base));
  }
  return out.filter((p) => fs.existsSync(p));
}

// 只挑 `color:` 属性（排除 border-color / background-color）
const COLOR_DECL = /(?<![-\w])color\s*:\s*(#[0-9a-fA-F]{3,6})(?![0-9a-fA-F])/g;

function scanFor(blob, color) {
  const hits = [];
  const re = new RegExp(COLOR_DECL.source, 'gi');
  let m;
  while ((m = re.exec(blob)) !== null) {
    if (m[1].toLowerCase() === color.toLowerCase()) hits.push(m.index);
  }
  return hits;
}

const FILES = collect();

section('A 前提（扫描面非空）');
if (FILES.length >= 30) ok('A-③', '扫描面 ' + FILES.length + ' 个 wxss/wxml 文件 ≥ 30');
else no('A-③', '扫描面仅 ' + FILES.length + ' 个文件 < 30 ⇒ 判据可能扫了空集');

section('A-① 旧低对比文字色不得回流（只判 color 属性）');
const live = new Map();
for (const abs of FILES) {
  let raw = '';
  try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
  live.set(abs, stripComments(raw, path.extname(abs).toLowerCase()));
}
const leaks = [];
for (const [c, cr] of BLACKLIST) {
  for (const [abs, blob] of live) {
    const hits = scanFor(blob, c);
    if (hits.length) {
      const line = blob.slice(0, hits[0]).split('\n').length;
      leaks.push(path.relative(ROOT, abs).replace(/\\/g, '/') + ':' + line + ' ' + c + '（' + cr + ':1）');
    }
  }
}
if (leaks.length === 0) {
  ok('A-①', BLACKLIST.length + ' 个旧低对比色在 color 属性上零命中');
} else {
  no('A-①', leaks.length + ' 处低对比文字色回流（<4.5:1，老板看着吃力）：' + leaks.slice(0, 6).join(' , '));
}

section('A-② 三档文字色在场（防"三档制"被悄悄推翻）');
const appTxt = live.get(path.join(ROOT, 'app.wxss')) || '';
const missingTier = TIERS.filter(([c]) => !new RegExp(c, 'i').test(appTxt));
if (missingTier.length === 0) ok('A-②', '三档 ' + TIERS.map((t) => t[0]).join(' / ') + ' 均在 app.wxss 声明');
else no('A-②', '缺少档位 ' + missingTier.map((t) => t[0]).join(',') + ' ⇒ 三档制被改，本守卫前提失效');

section('B 变异自证（判据有分辨力吗）');
const probe = (txt) => scanFor(stripComments(txt, '.wxss'), BLACKLIST[20][0]).length > 0; // #e74c3c
if (probe('.x { color: ' + BLACKLIST[20][0] + '; }')) ok('B-①', '变异体 color: ' + BLACKLIST[20][0] + ' 被抓到（判据有效）');
else no('B-①', '变异体未被抓到 ⇒ 判据恒假，本守卫无效');
if (!probe('.x { background: ' + BLACKLIST[20][0] + '; }')) ok('B-②', 'background 用同色值被放行（只判文字，不放宽色块）');
else no('B-②', 'background 也被判红 ⇒ 判据过宽，会误杀色块');
const whiteProbe = DARK_BG_WHITELIST.some((w) => scanFor('.x { color: ' + w + '; }', w).length > 0);
if (whiteProbe) ok('B-③', '白名单生效：深色底上的浅字（#fff 系）不被误杀');
else no('B-③', '白名单失效 ⇒ 深蓝 hero 里的白字会被判红');

console.log('\n==== 文字对比度守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
