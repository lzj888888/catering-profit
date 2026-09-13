// tools/sync_common.js
// 作用：把 cloudfunctions/common/（单源）同步进每个云函数目录的 common/ 子目录，
//       并在 --check 模式下断言「各函数目录内的副本 ≡ 仓库 common/ 单源」（派生件护栏，与门禁 K11 同构）。
//
// 为什么需要（架构决策，必须在批次 1 之前定）：
//   微信云开发每个云函数**独立打包上传**（只含自身目录 + 自身 node_modules）。
//   若云函数写 require('../common')，本机 node 跑得通，云端 MODULE_NOT_FOUND —— 因为
//   cloudfunctions/common/ 是各函数的**兄弟目录**，不在任何单函数包内。
//   采用「单源 + 同步副本 + 守卫」范式：
//     · 单源留在 cloudfunctions/common/（维护只改这里）
//     · 上传前跑本脚本：把 common/ 复制进每个 cloudfunctions/<func>/common/
//     · 云函数改用 require('./common')（指向自身目录内的副本）
//     · 门禁 L 组（check_error_codes.js）与 verify_all.js 用 checkSync() 断言副本与单源逐字一致，漂移即红。
//
// 运行：
//   node tools/sync_common.js          # 默认：同步（复制单源进各函数目录）
//   node tools/sync_common.js --sync   # 同上
//   node tools/sync_common.js --check  # 只校验副本≡单源，不写盘，exit 1 = 有漂移
//
// ⚠️ 云端行为（require('../common') 落地失败）基于微信云开发打包模型，本沙箱无法端到端验证；
//   但同步 + 守卫逻辑本机完全可验证，且这是决定每个函数目录结构与 import 写法的架构决策，
//   故在批次 1 之前定（否则批次 1 起的每个云函数都要返工，返工面 = 后面全部 7 批）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');                          // catering-profit 根
const COMMON_SRC = path.join(ROOT, 'cloudfunctions', 'common');
const CF_DIR = path.join(ROOT, 'cloudfunctions');

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

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// 清理副本中单源已没有的多余文件/目录（仅作用于 funcDir/common/ 子树内）
function removeExtra(funcDir, rels) {
  const wanted = new Set(rels);
  const commonDir = path.join(funcDir, 'common');
  if (!fs.existsSync(commonDir)) return;
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const r = rel === '' ? e.name : rel + '/' + e.name;
      if (e.isDirectory()) {
        if (isExcluded(e.name)) continue;
        walk(p, r);
        if (fs.readdirSync(p).length === 0) fs.rmdirSync(p); // 空目录清理
      } else if (!wanted.has(r)) {
        fs.unlinkSync(p);
      }
    }
  })(commonDir, '');
}

// 同步：单源 → 各函数目录的 common/（与 checkSync 共用 EXCLUDE，保证可比）
function syncCommon() {
  const rels = sourceFiles();
  const funcs = listFunctions();
  for (const fn of funcs) {
    const destCommon = path.join(fn, 'common');
    for (const rel of rels) copyFile(path.join(COMMON_SRC, rel), path.join(destCommon, rel));
    removeExtra(fn, rels);
  }
  return { rels, funcs: funcs.map((f) => path.basename(f)) };
}

// 校验：各函数目录副本 ≡ 单源（逐字，CRLF 归一，与 K11 同构）
// 返回 { ok, drifts:[{func, rel, reason}] }
function checkSync() {
  const rels = sourceFiles();
  const funcs = listFunctions();
  const drifts = [];
  const srcMap = new Map();
  for (const rel of rels) srcMap.set(rel, normNL(fs.readFileSync(path.join(COMMON_SRC, rel), 'utf8')));

  for (const fn of funcs) {
    const funcName = path.basename(fn);
    const commonDir = path.join(fn, 'common');
    const have = new Set();
    if (fs.existsSync(commonDir)) {
      (function walk(dir, rel) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          const r = rel === '' ? e.name : rel + '/' + e.name;
          if (e.isDirectory()) {
            if (isExcluded(e.name)) continue;
            walk(p, r);
          } else if (!isExcluded(e.name)) {
            have.add(r);
          }
        }
      })(commonDir, '');
    }
    // 副本缺失文件 / 内容不一致
    for (const rel of rels) {
      if (!have.has(rel)) {
        drifts.push({ func: funcName, rel, reason: '副本缺失（未运行 sync 或同步被跳过）' });
        continue;
      }
      const actual = normNL(fs.readFileSync(path.join(commonDir, rel), 'utf8'));
      if (actual !== srcMap.get(rel)) drifts.push({ func: funcName, rel, reason: '副本与单源内容不一致（派生件落后）' });
    }
    // 副本多出单源没有的文件
    for (const rel of have) {
      if (!srcMap.has(rel)) drifts.push({ func: funcName, rel, reason: '副本多出单源没有的文件（应重跑 sync 清理）' });
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
      console.log(`✅ common 同步校验通过：${listFunctions().length} 个云函数目录的 common/ 副本均 ≡ cloudfunctions/common/ 单源`);
      process.exit(0);
    }
    console.log(`❌ common 同步校验失败：${drifts.length} 处漂移`);
    drifts.forEach((d) => console.log(`   [L] ${d.func}/common/${d.rel} —— ${d.reason}`));
    console.log('   修法：在仓库根跑 `node tools/sync_common.js` 重新同步，再提交副本');
    process.exit(1);
  }
  // --sync（默认）
  const { rels, funcs } = syncCommon();
  console.log(`✅ 已同步 cloudfunctions/common/（${rels.length} 个文件）→ ${funcs.length} 个云函数目录的 common/：`);
  funcs.forEach((f) => console.log('   · ' + f));
  console.log('   云函数内改用 require(\'./common\') 引用（指向自身目录内的副本）。');
}

if (require.main === module) main();

module.exports = { syncCommon, checkSync, listFunctions, COMMON_SRC, ROOT };
