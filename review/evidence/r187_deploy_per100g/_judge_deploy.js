// _judge_deploy.js —— 云函数部署判据（编码无关：只匹配 ASCII）
// 为什么不用 `│`(U+2502)：cli 输出编码在 GBK/UTF-8 间有争议（round122 的 `│` 正则在 round147 变成 mojibake
// ⇒ 把 4 个成功部署全判成"未命中"假阴性）。ASCII 子串（函数名 / true / deploy cloudfunctions）在任何
// 单字节编码下都一样 ⇒ 用 latin1 单字节映射读取，绕开解码歧义。
// 用法： node review/evidence/_judge_deploy.js <logpath> <fn1> <fn2> ...
const fs = require('fs');
const path = require('path');

const logPath = process.argv[2];
const FUNCS = process.argv.slice(3);
if (!logPath || !fs.existsSync(logPath)) {
  console.log('❌ 日志不存在：' + logPath);
  process.exit(2);
}
const buf = fs.readFileSync(logPath);
const txt = buf.toString('latin1');
const lines = txt.split('\n');
console.log('LOG = ' + path.basename(logPath) + '  (' + buf.length + ' bytes)');

let allHit = true;
for (const fn of FUNCS) {
  const hits = lines.filter((l) => l.includes(fn) && /\btrue\b/.test(l));
  const ok = hits.length > 0;
  if (!ok) allHit = false;
  console.log('  ' + fn.padEnd(18) + (ok ? '✅ 命中表格行' : '❌ 未命中（该函数无 success=true 行）')
    + (ok ? '   ' + hits[hits.length - 1].trim().slice(0, 96) : ''));
}
const done = /deploy cloudfunctions/.test(txt);
console.log('完成行 `deploy cloudfunctions` : ' + (done ? '✅ 有' : '❌ 无'));
console.log('ALL_ROWS_HIT = ' + allHit + '  |  DONE = ' + done);
process.exit(allHit && done ? 0 : 1);
