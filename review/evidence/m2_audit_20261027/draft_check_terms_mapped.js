// draft_check_terms_mapped.js —— 【草稿，未注册进 verify_all SUITES】
// 守的病：页面「引用了文案键，但映射侧根本没产出」⇒ 恒 undefined / 静默空白、零报错。
//   实证三例（都是这个病，都是**静默**的）：
//   ① M1  subpkg/biz/month/result.js:542  T.beHealthyScope  —— data.t 无此键 ⇒ 达标线口径说明恒空
//   ② M2  subpkg/tools/sandbox/matrix.js:748 T.buildSumText —— data.t 无此键 ⇒ 合计行显示成两个裸数字
//   ③ M2  subpkg/tools/sandbox/matrix.js:153 M.laborUnitLabel —— 键只在 m2 区块、M 却指向 matrix ⇒ 标签恒空
// 判据（两层，都是差集，不是字面量）：
//   L1  wxml 的 `{{t.X}}` ∪ js 的 `T.X`（T = this.data.t）  −  data.t 实际映射的键  ⇒ 恒空白
//   L2  data.t 里 `K: <Alias>.K`（Alias = TERMS.<block>）    −  terms 该 block 的键    ⇒ 恒 undefined
// ⚠️ 为什么不算误判：页面取值一律走 `this.data.t`，没有动态 `t[key]`（已核实 index.js 无动态引用）。
//    若将来出现动态取值，本判据会**假红**——那时应在白名单里登记，而不是删判据。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TERMS_PATH = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');

// 扫描面：小程序所有页面（主包 + 两个分包）
const PAGES = [];
(function collect() {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  (appJson.pages || []).forEach((p) => PAGES.push(p));
  (appJson.subpackages || appJson.subPackages || []).forEach((sp) => {
    (sp.pages || []).forEach((p) => PAGES.push(path.join(sp.root || '', p)));
  });
})();

function stripComments(src) {
  const out = [];
  for (const line of src.split('\n')) {
    let inq = null;
    let s = line;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inq) {
        if (c === '\\') { i++; continue; }
        if (c === inq) inq = null;
      } else {
        if (c === "'" || c === '"' || c === '`') inq = c;
        else if (c === '/' && s[i + 1] === '/') { s = s.slice(0, i); break; }
      }
    }
    out.push(s);
  }
  return out.join('\n');
}

// 从 `startIdx`（指向 '{'）开始按花括号配平，返回块体
function braceBody(code, startIdx) {
  let depth = 0, inq = null;
  for (let i = startIdx; i < code.length; i++) {
    const c = code[i];
    if (inq) {
      if (c === '\\') { i++; continue; }
      if (c === inq) inq = null;
    } else {
      if (c === "'" || c === '"' || c === '`') inq = c;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return code.slice(startIdx, i + 1); }
    }
  }
  return '';
}

function blockKeys(termsCode, name) {
  const m = new RegExp('^  ' + name + ':\\s*\\{', 'm').exec(termsCode);
  if (!m) return null;
  const body = braceBody(termsCode, m.index + m[0].length - 1);
  return new Set((body.match(/^    ([A-Za-z_]\w*)\s*:/gm) || [])
    .map((s) => s.replace(/[:\s]/g, '').replace(/^\s{4}/, '')));
}

function dataTKeys(jsCode) {
  const m = /^    t:\s*\{/m.exec(jsCode);
  if (!m) return null;
  const body = braceBody(jsCode, m.index + m[0].length - 1);
  // ⚠️ 判据的判据（R299 教训）：初版只认「缩进 6 空格」的键 ⇒ 把 `subpkg/biz/month/input.js:143`
  //    `twTotalLabel:`（缩进写成 4 空格、但确实在 data.t 块内）误报成缺失 ⇒ **假红**。
  //   现改为：块体内**任意缩进**的 `key:` 都算已映射。代价是嵌套对象内的同名键会造成**假阴**
  //   （漏报）——门禁判据宁可漏报也不可误报：误报会逼人删判据，反而永久失去防线。
  const keys = new Set((body.match(/^\s*([A-Za-z_]\w*)\s*:/gm) || [])
    .map((s) => s.trim().replace(/:$/, '')));
  return { keys, body };
}

const termsCode = stripComments(fs.readFileSync(TERMS_PATH, 'utf8'));
const findings = [];

for (const rel of PAGES) {
  const jsPath = path.join(ROOT, rel + '.js');
  const wxmlPath = path.join(ROOT, rel + '.wxml');
  if (!fs.existsSync(jsPath)) continue;
  const jsCode = stripComments(fs.readFileSync(jsPath, 'utf8'));
  const t = dataTKeys(jsCode);
  if (!t) continue;

  // ---- L1：引用了但 data.t 没映射 ----
  const used = new Set();
  if (fs.existsSync(wxmlPath)) {
    const w = stripComments(fs.readFileSync(wxmlPath, 'utf8'));
    (w.match(/(?<![\w.])\bt\.([A-Za-z_]\w*)/g) || []).forEach((m) => used.add(m.split('.')[1]));
  }
  if (/const\s+T\s*=\s*this\.data\.t/.test(jsCode)) {
    (jsCode.match(/(?<![\w.])\bT\.([A-Za-z_]\w*)/g) || []).forEach((m) => used.add(m.split('.')[1]));
  }
  const l1 = [...used].filter((k) => !t.keys.has(k)).sort();

  // ---- L2：data.t 里 `K: Alias.K`，但 Alias 区块没有 K ----
  const aliases = [...jsCode.matchAll(/const\s+([A-Z]\w*)\s*=\s*TERMS\.(\w+)\s*;/g)]
    .map((m) => ({ name: m[1], block: m[2] }));
  const blockCache = {};
  const l2 = [];
  for (const a of aliases) {
    if (!(a.block in blockCache)) blockCache[a.block] = blockKeys(termsCode, a.block);
    const keys = blockCache[a.block];
    if (!keys) continue;
    for (const line of t.body.split('\n')) {
      const m = /^\s+([A-Za-z_]\w*):\s*([A-Z]\w*)\.([A-Za-z_]\w*)\s*,/.exec(line);
      if (!m) continue;
      const [, mapKey, alias, srcKey] = m;
      if (alias !== a.name) continue;
      if (!keys.has(srcKey)) l2.push(mapKey + ' ← ' + alias + '.' + srcKey + '（TERMS.' + a.block + ' 无此键）');
    }
  }

  if (l1.length || l2.length) {
    findings.push({ page: rel, l1, l2: [...new Set(l2)].sort() });
  }
}

console.log('扫描页面数：' + PAGES.length + '（app.json 全量）');
console.log('命中页面数：' + findings.length);
console.log('='.repeat(70));
for (const f of findings) {
  console.log('[PAGE] ' + f.page);
  if (f.l1.length) console.log('  ❌ L1 引用了但 data.t 没映射 ⇒ 恒空白：\n     - ' + f.l1.join('\n     - '));
  if (f.l2.length) console.log('  ❌ L2 data.t 取自区块但该区块无此键 ⇒ 恒 undefined：\n     - ' + f.l2.join('\n     - '));
}
if (!findings.length) console.log('（无命中）');
