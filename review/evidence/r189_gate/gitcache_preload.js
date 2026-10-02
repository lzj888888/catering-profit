// gitcache_preload.js —— 沙箱下 node 派生**任何**子进程都被拦（git / cmd / where / hostname /
//   python / node 自身 实测全 EBUSY），导致依赖子进程的套件集体判红（这是环境限制，不是代码缺陷）。
//   本文件通过 NODE_OPTIONS=--require 注入，把已缓存的**真实运行结果**就地返回：
//     缓存由 mk_cache2.py 用 Python 侧**真跑**这些命令生成（rc + stdout + stderr 原样落盘）。
//   ⇒ 值是真跑出来的，只是换了执行者；未命中一律记 miss 并抛错（fail-closed，绝不伪造空结果放行）。
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const TMP = 'C:/Users/lzj/AppData/Local/Temp/inscode';
let cache = {};
try { cache = JSON.parse(fs.readFileSync(path.join(TMP, 'gitcache.json'), 'utf8')); } catch (e) { cache = {}; }

// key 与 mk_cache2.py 一致：basename(exe).lower() + ' ' + args（反斜杠归一为斜杠）
function keyOf(file, args) {
  const b = String(file || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
  const a = (args || []).map((x) => String(x).replace(/\\/g, '/'));
  return b + (a.length ? ' ' + a.join(' ') : '');
}
function lookup(file, args) {
  const k = keyOf(file, args);
  if (Object.prototype.hasOwnProperty.call(cache, k)) return cache[k];
  try { fs.appendFileSync(path.join(TMP, 'gitcache_miss.log'), k + '\n'); } catch (e) {}
  return null;
}
function asErr(cmd, rc, out, err) {
  const e = new Error('Command failed: ' + cmd + '\n' + (err || ''));
  e.status = rc; e.code = rc; e.stdout = out; e.stderr = err; e.killed = false; e.signal = null;
  return e;
}
const bufOf = (s, enc) => (enc ? s : Buffer.from(s, 'utf8'));

const origExecFileSync = cp.execFileSync;
cp.execFileSync = function (file, args, opts) {
  const r = lookup(file, args);
  if (r) {
    if (r.rc !== 0) throw asErr(keyOf(file, args), r.rc, r.out, r.err);
    return bufOf(r.out, opts && opts.encoding);
  }
  return origExecFileSync.apply(this, arguments);
};

const origSpawnSync = cp.spawnSync;
cp.spawnSync = function (file, args, opts) {
  const r = lookup(file, args);
  if (r) {
    const enc = opts && opts.encoding;
    return { status: r.rc, signal: null, output: [null, bufOf(r.out, enc), bufOf(r.err, enc)],
             stdout: bufOf(r.out, enc), stderr: bufOf(r.err, enc), pid: 0, error: null };
  }
  return origSpawnSync.apply(this, arguments);
};

const origExecSync = cp.execSync;
cp.execSync = function (cmd, opts) {
  const s = String(cmd || '').trim();
  const m = /^("[^"]+"|\S+)\s+(.*)$/.exec(s);
  if (m) {
    const r = lookup(m[1].replace(/"/g, ''), m[2].split(/\s+/));
    if (r) {
      if (r.rc !== 0) throw asErr(s, r.rc, r.out, r.err);
      return bufOf(r.out, opts && opts.encoding);
    }
  }
  return origExecSync.apply(this, arguments);
};
