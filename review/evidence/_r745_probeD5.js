/* R745 M3 独立审计 · 只读探针 D5
 * 目标: 把"承诺型按钮/可点行"的 bindtap 与其 js 函数体首段并排打印,
 *       供人工判断"点了真做事 / 点了只 toast / 点了没反应 / 跳错页".
 * 用法: node _r745_probeD5.js   (只打印承诺型)
 * 只读, 不修改任何现有文件.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

function resolvePath(p) { let c = TERMS; for (const s of p.split('.')) { if (!c || typeof c !== 'object') return undefined; c = c[s]; } return c; }
function walk(dir, ext, out) { let ns; try { ns = fs.readdirSync(dir); } catch (e) { return; } for (const n of ns) { const p = path.join(dir, n); let st; try { st = fs.statSync(p); } catch (e) { continue; } if (st.isDirectory()) { if (n === 'node_modules' || n === '.git') continue; walk(p, ext, out); } else if (p.endsWith(ext)) out.push(p); } }
const W = []; walk(path.join(ROOT, 'pages'), '.wxml', W); walk(path.join(ROOT, 'subpkg'), '.wxml', W); W.sort();
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
const HAN = /[\u4e00-\u9fa5]/;
const PROMISE = /导出|下载|导入|上传|保存|录入|新建|添加|去补|去录|去建|去拿|去下|自动|一键|复制|关联|映射|套用|填入|提取|重新|解析|同步|开通|订阅|查看|测算|生成|转发|客服|设置|确认|批量|建议|模板|清除|恢复|解除|提交|重试|重新测算|填入建议/;
function strip(t) { let o = '', i = 0, c = false; while (i < t.length) { if (!c && t.slice(i, i + 4) === '<!--') { c = true; i += 4; continue; } if (c && t.slice(i, i + 3) === '-->') { c = false; i += 3; continue; } const ch = t[i]; o += (c ? (ch === '\n' ? '\n' : ' ') : ch); i++; } return o; }

// 找 js 里某函数定义起点, 返回其后 14 行(截断)
function fnBody(jsLines, fn) {
  const re = new RegExp('(^|[^\\w$])(?:async\\s+)?' + fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[(:]');
  for (let i = 0; i < jsLines.length; i++) {
    if (re.test(jsLines[i])) {
      const chunk = [];
      for (let j = i; j < Math.min(i + 14, jsLines.length); j++) {
        chunk.push('      ' + (j + 1) + '| ' + jsLines[j].replace(/\s+/g, ' ').trim().slice(0, 130));
      }
      return { line: i + 1, chunk };
    }
  }
  return null;
}

const out = [];
const E = s => out.push(s);
for (const wp of W) {
  const jp = wp.replace(/\.wxml$/, '.js');
  const js = fs.existsSync(jp) ? fs.readFileSync(jp, 'utf8') : '';
  const jsLines = js.split('\n');
  // keymap: KEY: TERMS.path / T.path / '中文'
  const keymap = {};
  for (const ln of jsLines) {
    const m = ln.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+?)\s*,?\s*$/);
    if (!m) continue; const key = m[1], rhs = m[2];
    const tm = rhs.match(/(?:TERMS|T)\.([A-Za-z_$][\w$.]*)/);
    if (tm) { const v = resolvePath(tm[1]); if (typeof v === 'string' && HAN.test(v)) keymap[key] = v; continue; }
    const sm = rhs.match(/'([^']*[\u4e00-\u9fa5][^']*)'/); if (sm) keymap[key] = sm[1];
  }
  const clean = strip(fs.readFileSync(wp, 'utf8'));
  const lines = clean.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const em = ln.match(/\b(?:bind|catch):?tap\s*=\s*"([A-Za-z_$][\w$]*)"/);
    if (!em) continue;
    const fn = em[1];
    // 文案: 本行 + 后 2 行 里的中文 / {{t.KEY}}
    let texts = [];
    for (let k = i; k <= Math.min(i + 2, lines.length - 1); k++) {
      const L = lines[k];
      const d = L.replace(/\{\{[^}]*\}\}/g, ' ').match(/[\u4e00-\u9fa5][^\s<>{}]*/g) || [];
      texts.push(...d);
      const tr = /\{\{\s*t\.([A-Za-z_$][\w$]*)\s*\}\}/g; let mm;
      while ((mm = tr.exec(L))) { const v = keymap[mm[1]]; if (v) texts.push(v); }
      if (L.indexOf('</button>') >= 0 || L.indexOf('</view>') >= 0) break;
    }
    const joined = texts.join(' ').slice(0, 60);
    if (!PROMISE.test(joined)) continue;
    const body = fnBody(jsLines, fn);
    E('### ' + rel(wp) + ':' + (i + 1) + '  「' + joined + '」  → ' + fn + '()');
    if (!body) E('      !! js 中找不到该函数定义 (疑似死绑定)');
    else { E('      @js:' + body.line); E(body.chunk.join('\n')); }
  }
}
process.stdout.write(out.join('\n') + '\n');
