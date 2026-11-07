// 注释安全守卫（R616）
//
// 守的是什么事故（本轮真踩）：
//   我在 importSalesBill/index.js 的**行注释**里写了 `**不进 cloudfunctions/common/**`，
//   其中 `common/` 的斜杠紧跟星号 ⇒ 字符串里出现 `/*` ⇒ 被各守卫的 `stripComments`
//   当成**块注释开头**，把中间几千字符代码整段吞掉。
//   后果：幂等守卫报「预检@14191 vs 首个业务写@12532（顺序反了）」、
//   账单解析守卫报「`if (!platform) {` 段长度=0」、公开面守卫报「缺归属校验」——
//   **三个报错全都不指向真因**，我花了三轮才定位到是一句注释。
//
// 判据（判行为，不判风格）：
//   A 任何行注释（`//`）里出现 `/*` ⇒ 红（这是本轮形态）
//   B 任何行注释里出现 `*/` ⇒ 红（会让块注释提前结束）
//   C 全文 strip 掉注释后仍残留 `*/` ⇒ 红（配对错乱的兜底）
//   D 扫描面自证：必须真的扫到足够多的文件（扫空 ⇒ 红，否则判据恒真）
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}

// ===== 扫描面：所有云函数源码 + 共用单源 + 前端 utils =====
function walk(dir, out, depth) {
  if (depth > 3 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out, depth + 1);
    } else if (e.name.endsWith('.js')) {
      out.push(p);
    }
  }
}
const FILES = [];
walk(path.join(ROOT, 'cloudfunctions'), FILES, 0);
walk(path.join(ROOT, 'utils'), FILES, 0);

// ===== A/B：行注释里的危险组合 =====
//   只看 `//` 之后的部分（行首或 [^:] 后紧跟 //；排除 https:// 这种）
const RE_LINE_COMMENT = /(^|[^:])\/\/(.*)$/;
const badA = [];
const badB = [];
for (const f of FILES) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = RE_LINE_COMMENT.exec(lines[i]);
    if (!m) continue;
    const body = m[2];
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (body.indexOf('/*') >= 0) badA.push(rel + ':' + (i + 1));
    if (body.indexOf('*/') >= 0) badB.push(rel + ':' + (i + 1));
  }
}

ok('A 行注释里不得出现「斜杠+星号」（会被 stripComments 当块注释开头、吞掉大段代码）',
  badA.length === 0, badA.length ? '共 ' + badA.length + ' 处：' + badA.slice(0, 3).join(' / ') : '零命中');
ok('B 行注释里不得出现「星号+斜杠」（会让块注释提前结束、同样吞代码）',
  badB.length === 0, badB.length ? '共 ' + badB.length + ' 处：' + badB.slice(0, 3).join(' / ') : '零命中');

// ===== C：strip 后残留 `*/` ⇒ 配对错乱（兜底，能抓到块注释本身写坏的情况）=====
// ⚠️ 排除 selftest*.js：测试文件里会**刻意构造**含 `*/` 的字符串来验「剥注释函数」本身
//   （实测三个 AI consent 的 selftest 就是这种），把它们算进来是误伤、不是真风险。
const badC = [];
for (const f of FILES) {
  if (/selftest/i.test(path.basename(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  if (stripped.indexOf('*/') >= 0) badC.push(path.relative(ROOT, f).replace(/\\/g, '/'));
}
ok('C 剥掉块注释后不得残留「星号+斜杠」（说明块注释配对错乱）',
  badC.length === 0, badC.length ? badC.slice(0, 3).join(' / ') : '零命中');

// ===== D：自失效护栏 —— 扫描面必须非空且覆盖到关键文件 =====
const hasFnIndex = FILES.some((f) => /cloudfunctions[\\/][^\\/]+[\\/]index\.js$/.test(f));
const hasCommon = FILES.some((f) => /cloudfunctions[\\/]common[\\/]/.test(f));
const hasUtils = FILES.some((f) => /[\\/]utils[\\/]/.test(f));
ok('D 扫描面自证：文件数 ≥ 40 且同时覆盖 云函数 index / common / utils（扫空 ⇒ 判据恒真）',
  FILES.length >= 40 && hasFnIndex && hasCommon && hasUtils,
  '文件数=' + FILES.length + ' | index=' + hasFnIndex + ' common=' + hasCommon + ' utils=' + hasUtils);

// ===== E：本轮踩过的那个文件必须干净（点名，防回潮）=====
const TARGET = 'cloudfunctions/importSalesBill/index.js';
const tsrc = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
const tlines = tsrc.split('\n');
const tBad = tlines.some((l) => {
  const m = RE_LINE_COMMENT.exec(l);
  return m && (m[2].indexOf('/*') >= 0 || m[2].indexOf('*/') >= 0);
});
ok('E 点名：' + TARGET + ' 的行注释干净（R616 就是在它里面写坏过一次）', !tBad);

// ===== F：剥完注释后关键结构仍可见（证明没被吞）=====
const clean = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const cIdx = clean(TARGET);
ok('F 剥注释后 importSalesBill 的幂等预检仍先于首个库写（R616 被吞时这条会反）', (() => {
  const iIdem = cIdx.search(/idempotency\.findPriorResult\s*\(/);
  const m = /db\.collection\s*\([^)]*\)[^\n]*\.(update|add|insert|remove|upsert)\s*\(/.exec(cIdx);
  return iIdem >= 0 && !!m && iIdem < m.index;
})(), '预检@' + cIdx.search(/idempotency\.findPriorResult\s*\(/));

// 判「该段还在不在」：从 `if (!platform) {` 往后 800 字符内必须能看到平台自动判定调用。
//   （不用「找配对的 }」—— 段内有嵌套对象/箭头函数，找第一个 \n  } 会切早，误报长度=0。）
ok('G 剥注释后 importSalesBill 的平台自动判定段仍可定位（被吞时该段会消失）', (() => {
  const i = cIdx.indexOf('if (!platform) {');
  if (i < 0) return false;
  return cIdx.slice(i, i + 800).indexOf('detectPlatformInMatrix') >= 0;
})(), '段起@' + cIdx.indexOf('if (!platform) {'));

console.log('\n===== 注释安全守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
