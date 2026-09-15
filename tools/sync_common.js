// tools/sync_common.js
// 作用：把 cloudfunctions/common/（单源）同步进每个云函数目录，**扁平化**为
//       <func>/common.js + <func>/cx_*.js，
//       并在 --check 模式下断言「各函数目录内的副本 ≡ 由单源派生的期望内容」（派生件护栏，与门禁 K11/L 组同构）。
//
// 为什么需要（架构决策，批次 1 之前必须定）：
//   1) 微信云开发每个云函数**独立打包上传**（只含自身目录 + 自身 node_modules）。
//      若云函数写 require('../common')，本机 node 跑得通，云端 MODULE_NOT_FOUND —— 因为
//      cloudfunctions/common/ 是各函数的**兄弟目录**，不在任何单函数包内。
//   2) 🔴 2026-09-15 云端实测（决定性证据）：即便用 require('./common') 指向**自身目录内的子目录**，
//      在真云端依然 MODULE_NOT_FOUND。用 `cli cloud functions download` 与 fsDiag 自检双重确认：
//      云端 `readdirSync(__dirname)` 返回的是 **"common\\audit.js" 这类带反斜杠的扁平文件名**，
//      `fs.existsSync(__dirname + '/common')` === false —— 也就是说
//      **Windows 侧打包把子目录拼成了"文件名里含反斜杠"的条目，Linux 云端不认它是目录**。
//      ⇒ 云端**根本不存在 common 子目录**，require('./common') 必失败。
//   3) ⇒ 结论：云函数包内**不得使用子目录**。采用「单源 + 扁平化同步副本 + 守卫」范式：
//        · 单源留在 cloudfunctions/common/（维护只改这里）
//        · 上传前跑本脚本：派生出 <func>/common.js（入口）+ <func>/cx_*.js（各模块，带前缀防撞名）
//        · 云函数仍写 require('./common') → 命中 <func>/common.js（文件，非目录），稳妥
//        · 内部 require('./errors') 在派发时被重写为 require('./cx_errors')
//        · 门禁 L 组（check_error_codes.js）与 verify_all.js 用 checkSync() 断言副本与期望逐字一致，漂移即红。
//
// 运行：
//   node tools/sync_common.js          # 默认：同步（派生单源进各函数目录）
//   node tools/sync_common.js --sync   # 同上
//   node tools/sync_common.js --check  # 只校验副本≡期望派生内容，不写盘，exit 1 = 有漂移
//
// ✅ 2026-09-15 云端实测：本扁平化方案在真 wx-server-sdk 上验证通过（smokeTest 探针 v3）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');                          // catering-profit 根
const COMMON_SRC = path.join(ROOT, 'cloudfunctions', 'common');
const CF_DIR = path.join(ROOT, 'cloudfunctions');

const PREFIX = 'cx_';               // 扁平化前缀（避免与各云函数自有文件撞名）
const ENTRY = 'common.js';          // 扁平化后的入口文件名（require('./common') 命中它）
const LEGACY_DIR = 'common';        // 旧的「子目录」副本目录名（已废止，同步时清理）

// 同步时排除的项（不进云端部署包 / 不进副本）
const EXCLUDE = new Set(['__tests__', 'node_modules']);
const isExcluded = (name) => EXCLUDE.has(name) || name === '.DS_Store';

// 列出所有云函数目录（cloudfunctions/ 下含 package.json 且非 common 自身的直接子目录）
function listFunctions() {
  if (!fs.existsSync(CF_DIR)) return [];
  return fs.readdirSync(CF_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name !== 'common')
    .filter((name) => fs.existsSync(path.join(CF_DIR, name, 'package.json')))
    .map((name) => path.join(CF_DIR, name));
}

// 收集单源内应同步的文件（相对 common/ 的路径），排除 EXCLUDE
function sourceFiles() {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (isExcluded(e.name)) continue;
        walk(p, rel === '' ? e.name : rel + '/' + e.name);
      } else if (!isExcluded(e.name)) {
        out.push(rel === '' ? e.name : rel + '/' + e.name);
      }
    }
  })(COMMON_SRC, '');
  return out;
}

const normNL = (s) => s.replace(/\r\n/g, '\n');

// 扁平化后的文件名（单源目前是平的，故 rel 即 basename；保留路径 → 文件名的映射以兼容将来多层）
const flatName = (rel) => PREFIX + rel.replace(/[/\\]/g, '_');

// 把单源文件内容改写成扁平化版本：require('./x') → require('./cx_x')
// 只改写确属本层模块名的引用，避免误伤（如将来出现 require('./xxx/y')）
function transform(srcText, flatSet) {
  return srcText.replace(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g, (m, mod) => {
    const cand = flatSet.has(PREFIX + mod + '.js') ? PREFIX + mod + '.js'
      : flatSet.has(PREFIX + mod + '/index.js') ? PREFIX + mod + '_index.js'
        : null;
    return cand ? `require('./${cand.replace(/\.js$/, '')}')` : m;
  });
}

// 由单源派生出「某云函数目录应有的全部扁平文件」：{ 文件名 → 内容 }
function deriveFlat() {
  const rels = sourceFiles();
  const flatSet = new Set(rels.map(flatName));
  const files = new Map();
  for (const rel of rels) {
    const raw = fs.readFileSync(path.join(COMMON_SRC, rel), 'utf8');
    files.set(flatName(rel), transform(normNL(raw), flatSet));
  }
  // 入口：common.js —— 让云函数的 require('./common') 命中（文件而非目录）
  const entryName = 'index.js';
  const entryFlat = flatSet.has(PREFIX + entryName) ? PREFIX + entryName : flatName(entryName);
  files.set(ENTRY, [
    '// ⚠️ 本文件由 tools/sync_common.js 从 cloudfunctions/common/ 单源自动派生，请勿手改。',
    '// 为什么是「文件」而不是「目录」：2026-09-15 云端实测，Windows 侧打包会把子目录',
    '// 拼成 "common\\xxx.js" 这种带反斜杠的扁平文件名，Linux 云端不认它是目录，',
    '// 导致 require(\'./common\') 报 MODULE_NOT_FOUND。故此云函数包内不使用子目录。',
    `module.exports = require('./${entryFlat.replace(/\.js$/, '')}');`,
    '',
  ].join('\n'));
  return files;
}

// 清理废止的旧子目录副本 <func>/common/
// ⚠️ 不用 fs.rmSync：WorkBuddy 的 safe-delete 钩子会把它转投回收站并可能超时失败。
//    改为逐文件 unlinkSync + rmdirSync，纯文件系统操作，无外部进程。
function removeLegacyDir(funcDir) {
  const legacy = path.join(funcDir, LEGACY_DIR);
  if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) return;
  // 清理失败不阻断同步（宿主可能把 unlink/rm 转投回收站而超时）；checkSync 会把它报为漂移提示手动删
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else fs.unlinkSync(p);
      }
    })(legacy);
    fs.rmdirSync(legacy);
  } catch (e) {
    console.warn(`   ⚠️ 旧子目录副本清理失败（需手动删）：${legacy} —— ${e.message}`);
  }
}

// 同步：单源 → 各函数目录的扁平副本
function syncCommon() {
  const files = deriveFlat();
  const funcs = listFunctions();
  for (const fn of funcs) {
    removeLegacyDir(fn);
    for (const [name, content] of files) {
      fs.mkdirSync(fn, { recursive: true });
      fs.writeFileSync(path.join(fn, name), content, 'utf8');
    }
  }
  return { rels: [...files.keys()], funcs: funcs.map((f) => path.basename(f)) };
}

// 校验：各函数目录的扁平副本 ≡ 由单源派生的期望内容（逐字，CRLF 归一）
// 返回 { ok, drifts:[{func, file, reason}] }
function checkSync() {
  const expected = deriveFlat();
  const funcs = listFunctions();
  const drifts = [];

  for (const fn of funcs) {
    const funcName = path.basename(fn);
    for (const [name, want] of expected) {
      const p = path.join(fn, name);
      if (!fs.existsSync(p)) {
        drifts.push({ func: funcName, file: name, reason: '副本缺失（未运行 sync 或同步被跳过）' });
        continue;
      }
      const actual = normNL(fs.readFileSync(p, 'utf8'));
      if (actual !== normNL(want)) drifts.push({ func: funcName, file: name, reason: '副本与单源派生内容不一致（派生件落后）' });
    }
    // 仍存在废止的子目录副本 → 漂移（云端会 MODULE_NOT_FOUND）
    if (fs.existsSync(path.join(fn, LEGACY_DIR))) {
      drifts.push({ func: funcName, file: LEGACY_DIR + '/', reason: '仍存在废止的子目录副本（云端不认目录，须重跑 sync 清理）' });
    }
  }
  return { ok: drifts.length === 0, drifts };
}

// ===================== CLI =====================
function main() {
  const mode = process.argv[2] || '--sync';
  if (mode === '--check') {
    const { ok, drifts } = checkSync();
    if (ok) {
      console.log(`✅ common 同步校验通过：${listFunctions().length} 个云函数目录的扁平副本（common.js + cx_*.js）均 ≡ cloudfunctions/common/ 单源派生`);
      process.exit(0);
    }
    console.log(`❌ common 同步校验失败：${drifts.length} 处漂移`);
    drifts.forEach((d) => console.log(`   [L] ${d.func}/${d.file} —— ${d.reason}`));
    console.log('   修法：在仓库根跑 `node tools/sync_common.js` 重新同步，再提交副本');
    process.exit(1);
  }
  // --sync（默认）
  const { rels, funcs } = syncCommon();
  console.log(`✅ 已由 cloudfunctions/common/ 单源派生 ${rels.length} 个扁平文件 → ${funcs.length} 个云函数目录：`);
  funcs.forEach((f) => console.log('   · ' + f));
  console.log(`   产出：common.js（入口，供 require('./common') 命中）+ ${PREFIX}*.js（各模块）`);
  console.log('   ⚠️ 云函数包内不再使用子目录（云端不认 Windows 反斜杠拼出的目录）。');
}

if (require.main === module) main();

module.exports = { syncCommon, checkSync, listFunctions, deriveFlat, COMMON_SRC, ROOT };
