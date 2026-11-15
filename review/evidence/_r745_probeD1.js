/* R745 M3 独立审计 · 只读事实提取探针 D1
 * 用法: node _r745_probeD1.js <mode>
 *   bindings  每个 wxml 的事件绑定(bindtap等)及对应 js 是否定义了该 handler
 *   dead      只打印"死绑定"(wxml 引用了但同名 js 全文找不到该标识符)
 *   han       每个 wxml 的硬编码中文行(含承诺型关键词的优先,带行号)
 *   tref      每个 wxml 用到的 {{t.XXX}}, 对应 js 是否登记了该 key(漏登记嫌疑)
 *   api       所有 js 里 api.call('X') / callFunction name 的字面量集合 + 云函数目录差集
 *   all       全部
 * 只读, 不修改任何现有文件.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const mode = (process.argv[2] || 'all');
const want = m => mode === 'all' || mode === m;

function walk(dir, ext, out) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) {
      if (n === 'node_modules' || n === '.git') continue;
      walk(p, ext, out);
    } else if (p.endsWith(ext)) out.push(p);
  }
}
const W = [], J = [];
walk(path.join(ROOT, 'pages'), '.wxml', W);
walk(path.join(ROOT, 'subpkg'), '.wxml', W);
walk(path.join(ROOT, 'pages'), '.js', J);
walk(path.join(ROOT, 'subpkg'), '.js', J);
W.sort(); J.sort();

const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
const out = [];
const E = s => out.push(s);

const HAN = /[\u4e00-\u9fa5]/;
const PROMISE = /导出|下载|Excel|xls|csv|格式|点击|去设置|设置页|自动|一键|开通|免费|解锁|支持|生成|导入|上传|保存|录入|新建|添加|测算|还能撑|可撑|月|立即|马上|查看|分享|复制|报表|会员|付费|限额|上限|升级|订阅|设置|前往|跳转|去往|补齐|填写|填入|暂无|去录入|去添加|模版|模板|示例|计算器|一键|帮|智能/;

// 去掉 wxml 注释后的可见文本
function stripComments(txt) {
  return txt.replace(/<!--[\s\S]*?-->/g, '');
}

// ============ wxml 逐页分析 ============
const EVT = /\b(?:bind|catch):?([A-Za-z]+)\s*=\s*"([^"]*)"/g;
const TREF = /\{\{\s*t\.([A-Za-z_$][\w$]*)\s*\}\}/g;
const TREF_BR = /\{\{\s*t\[\s*['"]([^'"]+)['"]\s*\]\s*\}\}/g;

const bindingRows = [];   // {file, handler, defined, dynamic, line}
const hanRows = [];       // {file, line, text, promise}
const trefRows = [];      // {file, key, registered}

for (const wp of W) {
  const jp = wp.replace(/\.wxml$/, '.js');
  const jsTxt = fs.existsSync(jp) ? fs.readFileSync(jp, 'utf8') : '';
  const raw = fs.readFileSync(wp, 'utf8');
  const clean = stripComments(raw);
  const rawLines = raw.split('\n');

  // 事件绑定
  EVT.lastIndex = 0;
  let m;
  while ((m = EVT.exec(clean))) {
    const val = m[2].trim();
    const lineNo = clean.slice(0, m.index).split('\n').length;
    const dynamic = val.indexOf('{{') >= 0;
    const handler = dynamic ? val : val;
    // 定义判定: 同名 js 全文是否出现该标识符(词边界)
    let defined = null;
    if (!dynamic && handler) {
      const re = new RegExp('(^|[^\\w$])' + handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\w$]|$)');
      defined = re.test(jsTxt);
    }
    bindingRows.push({ file: rel(wp), handler, defined, dynamic, line: lineNo });
  }

  // 硬编码中文行(去注释)
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i];
    if (/^\s*<!--/.test(ln) || /<!--/.test(ln)) {
      // 注释行跳过(含行内注释的整行也跳过, 避免把注释自述当文案)
      if (/<!--/.test(ln)) continue;
    }
    if (HAN.test(ln)) {
      const t = ln.replace(/\s+/g, ' ').trim().slice(0, 170);
      hanRows.push({ file: rel(wp), line: i + 1, text: t, promise: PROMISE.test(ln) });
    }
  }

  // {{t.XXX}} 引用登记检查
  const keys = new Set();
  TREF.lastIndex = 0;
  while ((m = TREF.exec(clean))) keys.add(m[1]);
  TREF_BR.lastIndex = 0;
  while ((m = TREF_BR.exec(clean))) keys.add(m[1]);
  for (const k of keys) {
    const re = new RegExp('(^|[^\\w$])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\w$]|$)');
    trefRows.push({ file: rel(wp), key: k, registered: re.test(jsTxt) });
  }
}

// ============ api.call / callFunction 字面量 ============
const apiRe = /api\.call\(\s*['"]([^'"]+)['"]/g;
const cfRe = /(?:wx\.)?cloud\.callFunction[\s\S]{0,120}?name\s*:\s*['"]([^'"]+)['"]/g;
const fnRe = /functionName\s*[:=]\s*['"]([^'"]+)['"]/g;
const apis = new Map();
for (const jp of J) {
  const txt = fs.readFileSync(jp, 'utf8');
  for (const re of [apiRe, cfRe, fnRe]) {
    re.lastIndex = 0;
    let mm;
    while ((mm = re.exec(txt))) {
      const fn = mm[1];
      if (!apis.has(fn)) apis.set(fn, new Set());
      apis.get(fn).add(rel(jp));
    }
  }
}
const cfRoot = path.join(ROOT, 'cloudfunctions');
let CF = [];
try { CF = fs.readdirSync(cfRoot).filter(n => { try { return fs.statSync(path.join(cfRoot, n)).isDirectory(); } catch (e) { return false; } }); } catch (e) {}

// ============ 输出 ============
if (want('bindings') || want('dead')) {
  E('===== 事件绑定 (wxml -> js 是否定义) =====');
  for (const b of bindingRows) {
    if (want('dead') && mode === 'dead' && (b.defined !== false)) continue;
    const flag = b.dynamic ? 'DYNAMIC' : (b.defined ? 'ok' : 'MISSING');
    E(`${flag.padEnd(8)} ${b.file}:${b.line}  ${b.handler}`);
  }
}
if (want('han')) {
  E('===== wxml 硬编码中文 (★=含承诺型关键词) =====');
  const total = {};
  for (const h of hanRows) total[h.file] = (total[h.file] || 0) + 1;
  E('--- 每文件硬编码中文行数 ---');
  for (const k of Object.keys(total)) E(`${String(total[k]).padStart(4)}  ${k}`);
  E('--- 承诺型 / 全部硬编码中文行 ---');
  for (const h of hanRows) {
    if (mode === 'all' && !h.promise) continue; // all 模式只打印承诺型, 精简
    E(`${h.promise ? '★' : ' '} ${h.file}:${h.line}  ${h.text}`);
  }
}
if (want('tref')) {
  E('===== {{t.XXX}} 漏登记嫌疑 (registered=false 表示 js 全文找不到该 key) =====');
  for (const t of trefRows) {
    if (mode === 'all' && t.registered) continue;
    E(`${t.registered ? 'ok  ' : 'MISS'} ${t.file}  t.${t.key}`);
  }
}
if (want('api')) {
  E('===== 前端调用字面量 vs 云函数目录 =====');
  E('--- 云函数目录 (' + CF.length + ') ---');
  E(CF.join(', '));
  E('--- api.call/callFunction 字面量 (去重, 带调用方) ---');
  for (const fn of [...apis.keys()].sort()) {
    const inCf = CF.includes(fn);
    E(`${inCf ? 'IN-CF ' : 'NO-CF '} ${fn.padEnd(28)} <- ${[...apis.get(fn)].join(' , ')}`);
  }
  E('--- 差集: 被调用但云函数目录无同名 ---');
  for (const fn of [...apis.keys()].sort()) if (!CF.includes(fn)) E('  ' + fn);
}

process.stdout.write(out.join('\n') + '\n');
