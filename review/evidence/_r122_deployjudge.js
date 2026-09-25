// 解析 cli 部署日志的表格行 —— ⚠️ 分隔符是 │(U+2502)，不是 ASCII |
// 为什么需要它：cli.bat **即使部署失败也返回 rc=0**（round122 实测两连败仍 rc=0）⇒ rc 不可作判据，
//            唯一真判据是"有没有该函数的表格行"。
const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_gui';
const files = fs.readdirSync(DIR).filter((f) => /^_deploy_2026/.test(f)).sort();
const CELL = '[|\\u2502]';
const re = new RegExp(CELL + '\\s*(\\w+)\\s*' + CELL + '\\s*(true|false)\\s*' + CELL + '\\s*(\\d+)\\s*' + CELL + "\\s*'([^']+)'", 'g');

for (const f of files) {
  const t = fs.readFileSync(path.join(DIR, f), 'utf8');
  console.log('=== ' + f + ' ===');
  let m; let n = 0;
  while ((m = re.exec(t))) {
    console.log('  ' + m[1].padEnd(16) + ' success=' + m[2] + ' files=' + m[3] + ' pack=' + m[4]);
    n++;
  }
  if (!n) console.log('  (无表格行)');
}
