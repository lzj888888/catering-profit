#!/usr/bin/env node
// tools/scan_zero_stub_pages.js —— 零桩页面扫描（**唯一口径**，取代各轮临时脚本）
//
// 为什么固化：R724d 用临时 node -e 扫出「零桩 8 个」，R724l 换一次写法又扫出
//   **完全不重叠的 5 个**（groupon/index、material/edit、month/index、
//   revenue/manual/index、metrics/impact），且这 5 个多数比已补的 sandbox 页更高频、
//   更贴算钱。⇒ 临时脚本的口径（页面判定正则 / 桩型工具过滤 / 路径匹配方式）每次都不同，
//   「零桩名单」成了不可复现的记忆，直接导致优先级排错。
//
// 口径（改这里必须同步改报告与台账 evidence，不许再写临时脚本）：
//   面 A「页面」= subpkg/ 与 pages/ 下所有 .js（排除 *.selftest.js），
//        去掉行注释后匹配 /^Page\(\{/m（真注册了 Page 的才算页面）。
//   面 B「桩型工具」= tools/check_*.js 中源码含 global.Page 或 loadPage( 的
//        （与 tools/check_audit_findings_ledger.js 的 L-⑫ 同源口径）。
//   判据 = 面 B 任一工具的源码里**出现该页面的相对路径字符串**（正斜杠）。
//        不认「同目录别的文件」「只在注释里提一句文件名」——必须是可追溯的路径。
//   ⚠️ 局限：若桩型工具用变量拼接路径动态 loadPage，本扫描会误报零桩；
//        遇到时先读那个工具的 loadPage 调用再判，不要直接改本口径。
//
// 运行：node tools/scan_zero_stub_pages.js           （人读）
//       node tools/scan_zero_stub_pages.js --json   （机器读）
// 本文件**不挂 verify_all SUITES**：它是发现工具不是判据，挂进去会让「覆盖率」
// 变成自我指涉。由 review 报告人工引用其输出。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JSON_OUT = process.argv.indexOf('--json') >= 0;

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === 'node_modules' || f === '.git') continue;
      walk(p, out);
    } else if (/\.js$/.test(f) && !/\.selftest\.js$/.test(f)) {
      out.push(p);
    }
  }
  return out;
}

const isPage = (abs) => /^Page\(\{/m.test(
  fs.readFileSync(abs, 'utf8').replace(/\/\/.*$/gm, '')
);
const pages = []
  .concat(walk(path.join(ROOT, 'subpkg'), []))
  .concat(walk(path.join(ROOT, 'pages'), []))
  .filter(isPage)
  .map((abs) => path.relative(ROOT, abs).replace(/\\/g, '/'));

const allTools = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter((f) => /^check_.*\.js$/.test(f));
const stubTools = allTools.filter((f) =>
  /global\.Page|loadPage\(/.test(fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8'))
);
const stubSrc = stubTools
  .map((f) => fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8'))
  .join('\n');

const zero = pages.filter((pg) => stubSrc.indexOf(pg) < 0).sort();
const result = {
  scope: 'subpkg/ + pages/, /^Page\\(\\{/m, 排除 *.selftest.js',
  stubPredicate: 'tools/check_*.js 含 global.Page 或 loadPage(',
  matchRule: '桩型工具源码出现页面相对路径字符串（正斜杠）',
  totalPages: pages.length,
  totalTools: allTools.length,
  stubTools: stubTools.length,
  stubRatio: +(stubTools.length / allTools.length * 100).toFixed(1),
  zeroStubPages: zero,
  zeroStubCount: zero.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('零桩页面扫描（唯一口径）');
  console.log('  Page 页面 : ' + result.totalPages);
  console.log('  check_*.js: ' + result.totalTools + '，其中桩型 ' + result.stubTools
    + '（' + result.stubRatio + '%）');
  console.log('  零桩页面  : ' + result.zeroStubCount + ' 个');
  zero.forEach((p) => console.log('    · ' + p));
  console.log('\n⚠️ 误报排查：若某页其实由桩型工具用变量动态 loadPage，先读该工具再判，不要改本口径。');
}
