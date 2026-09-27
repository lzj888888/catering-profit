// _count_page_refs.js —— 统计 pages/*.js 内 /pages/... 跳转引用（供提审材料 §4 静态自检行写实数）
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';

function walk(d, out) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'pages'), []);
const TICK = String.fromCharCode(96);          // 反引号（避免内联进 shell 被当命令替换）
const QUOTES = "['\"" + TICK + ']';
const re = new RegExp(QUOTES + '(/pages/[A-Za-z0-9_/]+)', 'g');

let hits = 0;
const targets = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(s)) !== null) { hits++; targets.add(m[1]); }
}
const pages = JSON.parse(fs.readFileSync(ROOT + 'app.json', 'utf8')).pages;
const orphans = [...targets].filter((t) => pages.indexOf(t) < 0);
console.log('pages/*.js 内 /pages/... 引用处数 =', hits);
console.log('唯一目标数 =', targets.size);
console.log('app.json 声明页数 =', pages.length);
console.log('越界目标 =', orphans.length ? orphans : '0');
