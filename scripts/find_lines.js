// 通用行号定位器 —— 一次列出多个文件里匹配模式的行号，避免在评审稿里引错位置。
// 用法：
//   node find_lines.js <仓根> <规格文件:正则> [<文件:正则> ...]
// 例：
//   node find_lines.js C:/path/to/repo "cloudfunctions/getCostCard/cx_indicatorRef.js:BIZ_KEYS\s*=" \
//     "cloudfunctions/saveCostCard/service.js:batchOutput|reverse_price_fen"
// 注意：正则里避免用 | 之外的 shell 元字符；参数用双引号包住。
const fs = require('fs');
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node find_lines.js <仓根> <相对路径:正则> [...]');
  process.exit(2);
}
const root = args[0].replace(/\/+$/, '') + '/';
for (const spec of args.slice(1)) {
  const i = spec.lastIndexOf(':');
  const rel = spec.slice(0, i);
  const pat = spec.slice(i + 1);
  let re;
  try { re = new RegExp(pat); } catch (e) { console.log('## ' + rel + '  -> 正则非法: ' + e.message); continue; }
  let src;
  try { src = fs.readFileSync(root + rel, 'utf8'); }
  catch (e) { console.log('## ' + rel + '  -> ERR ' + e.code); continue; }
  const L = src.split(/\r?\n/);
  console.log('## ' + rel + '  (' + src.length + ' chars, ' + L.length + ' lines)');
  const hits = [];
  L.forEach((l, n) => { if (re.test(l)) hits.push('  ' + (n + 1) + ': ' + l.trim().slice(0, 130)); });
  console.log(hits.length ? hits.join('\n') : '  (未命中)');
}
