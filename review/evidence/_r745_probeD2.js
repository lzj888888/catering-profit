/* R745 M3 独立审计 · 只读探针 D2
 * 目标: 列出每个 M3 页面"真正渲染给用户看"的中文文案(已剔除 <!-- --> 注释),
 *       并把 {{t.KEY}} 解析成 terms.js 里的真实中文值.
 * 用法: node _r745_probeD2.js [mode]   mode=promise(默认,只打印承诺型) / full(全部)
 * 只读, 不修改任何现有文件.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const mode = process.argv[2] || 'promise';

const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
function resolvePath(p) {
  let cur = TERMS;
  for (const seg of p.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function walk(dir, ext, out) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) { if (n === 'node_modules' || n === '.git') continue; walk(p, ext, out); }
    else if (p.endsWith(ext)) out.push(p);
  }
}
const W = [];
walk(path.join(ROOT, 'pages'), '.wxml', W);
walk(path.join(ROOT, 'subpkg'), '.wxml', W);
W.sort();
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

// 逐字符剥离注释, 保留换行以对齐行号
function stripCommentsKeepLines(txt) {
  let out = '', i = 0, inC = false;
  while (i < txt.length) {
    if (!inC && txt.slice(i, i + 4) === '<!--') { inC = true; i += 4; continue; }
    if (inC && txt.slice(i, i + 3) === '-->') { inC = false; i += 3; continue; }
    const ch = txt[i];
    if (inC) { out += (ch === '\n' ? '\n' : ' '); }
    else out += ch;
    i++;
  }
  return out;
}

const HAN = /[\u4e00-\u9fa5]/;
const PROMISE = /导出|下载|Excel|xls|csv|格式|点击|去设置|设置页|自动|一键|开通|免费|解锁|支持|生成|导入|上传|保存|录入|新建|添加|测算|还能撑|可撑|立即|马上|查看|分享|复制|报表|会员|付费|限额|上限|升级|订阅|设置|前往|跳转|去往|补齐|填写|填入|暂无|模版|模板|示例|计算器|帮|智能|联系客服|客服|去补|去录|去建|去拿|去下|重试|重新|确认|提交|生效|同步|关联|匹配|解除|清除|恢复|开通后|需开通|查看结果|马上|一键|自动算|自动带|自动计/;

const out = [];
const E = s => out.push(s);

for (const wp of W) {
  const jp = wp.replace(/\.wxml$/, '.js');
  const js = fs.existsSync(jp) ? fs.readFileSync(jp, 'utf8') : '';
  // 建立 KEY -> 中文值 映射(来自 js 里 data.t 的 KEY: TERMS.path 或 KEY: '中文')
  const keymap = {};
  for (const ln of js.split('\n')) {
    const m = ln.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+?)\s*,?\s*$/);
    if (!m) continue;
    const key = m[1], rhs = m[2];
    const tm = rhs.match(/TERMS\.([A-Za-z_$][\w$.]*)/);
    if (tm) {
      const v = resolvePath(tm[1]);
      if (typeof v === 'string' && HAN.test(v)) keymap[key] = v;
      continue;
    }
    const sm = rhs.match(/'([^']*[\u4e00-\u9fa5][^']*)'|"([^"]*[\u4e00-\u9fa5][^"]*)"/);
    if (sm) keymap[key] = sm[1] || sm[2];
  }

  const clean = stripCommentsKeepLines(fs.readFileSync(wp, 'utf8'));
  const lines = clean.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!HAN.test(ln) && !/\{\{\s*t\./.test(ln)) continue;
    // 收集本行出现的中文: 直接中文 + t.KEY 解析值
    const texts = [];
    const direct = ln.replace(/\{\{[^}]*\}\}/g, ' ').match(/[\u4e00-\u9fa5][^\s<>{}]*/g) || [];
    for (const d of direct) texts.push({ k: '(hardcode)', v: d });
    const trefRe = /\{\{\s*t\.([A-Za-z_$][\w$]*)\s*\}\}/g;
    let mm;
    while ((mm = trefRe.exec(ln))) {
      const k = mm[1];
      texts.push({ k: 't.' + k, v: keymap[k] !== undefined ? keymap[k] : '《UNRESOLVED》' });
    }
    if (!texts.length) continue;
    const joined = texts.map(x => `${x.k}=${x.v}`).join(' | ');
    const promise = PROMISE.test(joined) || PROMISE.test(ln);
    rows.push({ line: i + 1, promise, text: joined, raw: ln.replace(/\s+/g, ' ').trim().slice(0, 90) });
  }
  E('### ' + rel(wp));
  for (const r of rows) {
    if (mode === 'promise' && !r.promise) continue;
    E(`${r.promise ? '★' : ' '} ${r.line}\t${r.text}`);
  }
}
process.stdout.write(out.join('\n') + '\n');
