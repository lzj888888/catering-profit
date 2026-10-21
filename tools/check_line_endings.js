/**
 * tools/check_line_endings.js —— 提交前预检：改动文件的行尾是否被整文件翻写
 *
 * 为什么需要（R423 实测 4 次）：
 *   有 4 个文件（check_page_manifest / check_bill_import_gate / check_free_shop_limit / .gitignore）
 *   在编辑或脚本追加后，**整文件行尾从 LF 变成 CRLF**（或反向）。
 *   后果：git diff 显示几百行改动，真正的 1~2 行修改被淹没，review 失去意义。
 *
 * 为什么不做成 verify_all 套件：
 *   门禁是**提交后**跑的，那时工作树已干净 ⇒ 判据恒绿 = 假绿。它的正确位置是**提交前**。
 *
 * 用法：
 *   node tools/check_line_endings.js          # 查全部未提交改动
 *   node tools/check_line_endings.js --fix    # 自动改回 HEAD 版的行尾
 *
 * 判据（逐字节，不靠启发式）：
 *   对每个改动文件，比较 git show HEAD:<path> 与工作树的 CRLF 计数；
 *   HEAD 无而当前有（或反之）⇒ 判为翻写。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIX = process.argv.includes('--fix');
const BIN_EXT = /\.(png|jpg|jpeg|gif|ico|webp|zip|xlsx|xls|pdf|woff2?|ttf|eot|mp4|mov)$/i;

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
}

function crlfCount(buf) {
  let n = 0;
  for (let i = 0; i + 1 < buf.length; i++) if (buf[i] === 13 && buf[i + 1] === 10) n++;
  return n;
}

function lfCount(buf) {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return n;
}

const statusRaw = git('git status --porcelain')
  .toString('utf8')
  .split('\n')
  .filter((l) => l.trim().length > 3);

const files = [];
for (const line of statusRaw) {
  const st = line.slice(0, 2);
  let p = line.slice(3).trim();
  if (p.indexOf(' -> ') >= 0) p = p.split(' -> ')[1];
  p = p.replace(/^"|"$/g, '');
  if (st.indexOf('A') >= 0 || st.indexOf('?') >= 0) continue;
  if (st.indexOf('D') >= 0) continue;
  if (BIN_EXT.test(p)) continue;
  files.push(p);
}

console.log('[行尾预检] 待查 ' + files.length + ' 个改动文件（新增/删除/二进制已跳过）');

let bad = 0;
const rows = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  let headBuf;
  try {
    headBuf = git('git show HEAD:"' + rel.replace(/"/g, '\\"') + '"');
  } catch (e) {
    continue;
  }
  const curBuf = fs.readFileSync(abs);
  const hC = crlfCount(headBuf);
  const cC = crlfCount(curBuf);
  if (lfCount(headBuf) === 0) continue;

  const flipped = (hC === 0 && cC > 0) || (hC > 0 && cC === 0);
  if (!flipped) continue;

  bad++;
  rows.push({ rel, from: hC === 0 ? 'LF' : 'CRLF', to: hC === 0 ? 'CRLF' : 'LF', hC, cC });
}

if (bad === 0) {
  console.log('✅ 无行尾翻写');
  process.exit(0);
}

console.log('❌ 发现 ' + bad + ' 个文件被整文件翻写：');
for (const r of rows) {
  const note = r.from === 'LF'
    ? '（HEAD: 0 CRLF → 当前: ' + r.cC + ' CRLF）'
    : '（HEAD: ' + r.hC + ' CRLF → 当前: 0）';
  console.log('   - ' + r.rel + ' ' + note);
}

if (!FIX) {
  console.log('\n修复：node tools/check_line_endings.js --fix');
  process.exit(1);
}

let fixedN = 0;
for (const r of rows) {
  const abs = path.join(ROOT, r.rel);
  let buf = fs.readFileSync(abs);
  buf = r.from === 'LF'
    ? Buffer.from(buf.toString('binary').split('\r\n').join('\n'), 'binary')
    : Buffer.from(buf.toString('binary').split('\n').join('\r\n'), 'binary');
  fs.writeFileSync(abs, buf);
  fixedN++;
}
console.log('\n✅ 已修正 ' + fixedN + ' 个文件的行尾（请再看 git diff --numstat 确认改动行数回到正常）');
