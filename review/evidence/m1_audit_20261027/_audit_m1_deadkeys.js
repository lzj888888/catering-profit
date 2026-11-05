// _audit_m1_deadkeys.js —— 只读取证：M1 结果页/月首页 术语键「注册 vs 使用」双向对照
// 目的：找出 ①注册了但从没被消费（死映射）②消费了但从未注册（恒 undefined ⇒ 静默空白）
const fs = require('fs');
const path = require('path');
const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）


function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

// 抽出 Page({ data: { t: { ... } } }) 里 t 对象的顶层键
function registeredKeys(src) {
  const start = src.search(/\n\s{4}t:\s*\{/);
  if (start < 0) return [];
  let i = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  const body = src.slice(i + 1, end);
  const keys = [];
  let depth2 = 0, lineStart = true;
  // 逐字符扫，只在 depth2===0 时认键
  let buf = '';
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '{' || c === '(' || c === '[') depth2++;
    else if (c === '}' || c === ')' || c === ']') depth2--;
    if (depth2 === 0 && c === ':') {
      const m = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(buf);
      if (m) keys.push(m[1]);
      buf = '';
      continue;
    }
    if (c === ',') { buf = ''; continue; }
    buf += c;
  }
  return keys;
}

function usedKeys(src, prefixes) {
  const set = new Set();
  for (const p of prefixes) {
    const re = new RegExp(p.replace(/\./g, '\\.') + '\\.([A-Za-z_$][A-Za-z0-9_$]*)', 'g');
    let m;
    while ((m = re.exec(src))) set.add(m[1]);
  }
  return set;
}

const PAGES = [
  { name: 'M1 结果页', js: 'subpkg/biz/month/result.js', wxml: 'subpkg/biz/month/result.wxml' },
  { name: 'M1 月首页', js: 'subpkg/biz/month/index.js', wxml: 'subpkg/biz/month/index.wxml' },
  { name: 'M1 录入页', js: 'subpkg/biz/month/input.js', wxml: 'subpkg/biz/month/input.wxml' },
  { name: 'M1 库存页', js: 'subpkg/biz/month/inventory.js', wxml: 'subpkg/biz/month/inventory.wxml' },
];

for (const pg of PAGES) {
  const js = read(pg.js);
  let wx = '';
  try { wx = read(pg.wxml); } catch (e) { wx = ''; }
  const reg = registeredKeys(js);
  const usedJs = usedKeys(js, ['this\\.data\\.t', 'T', '\\bt']);
  const usedWx = usedKeys(wx, ['t']);
  const used = new Set([...usedJs, ...usedWx]);
  const dead = reg.filter((k) => !used.has(k));
  const missing = [...used].filter((k) => !reg.includes(k));
  console.log('\n===== ' + pg.name + ' （' + pg.js + '）=====');
  console.log('注册键数 = ' + reg.length + '；被消费键数 = ' + used.size);
  console.log('\n-- ① 注册但从未被消费（死映射，改文案不会有任何可见影响） --');
  console.log(dead.length ? dead.join(', ') : '（无）');
  console.log('\n-- ② 被消费但从未注册（恒 undefined ⇒ WXML 静默空白 / JS 静默空串） --');
  console.log(missing.length ? missing.join(', ') : '（无）');
}
