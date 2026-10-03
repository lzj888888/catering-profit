// R194 沙箱探针矩阵：node 能否派生子进程（30 秒定性）
const { spawnSync } = require('child_process');
const list = [
  'C:/Program Files/Git/bin/git.exe',
  'C:/Windows/System32/cmd.exe',
  'C:/Windows/System32/where.exe',
  'C:/Python314/python.exe',
  'C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe',
  process.execPath,
];
for (const c of list) {
  let r;
  try { r = spawnSync(c, ['--version'], { encoding: 'utf8' }); }
  catch (e) { console.log(c, '-> THROW', e.code); continue; }
  console.log(c, '->', r.error ? r.error.code : 'ok');
}
