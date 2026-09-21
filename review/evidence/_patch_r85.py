# -*- coding: utf-8 -*-
"""round85：给 4 份「仅扫 index」的守卫补工作树扫描面（坑⑱ 收尾）。
字节级替换，保持行尾不变（坑⑰/⑳）。不新增断言，避免触发 R107 声明漂移。
"""
import os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
T = lambda *a: os.path.join(ROOT, 'tools', *a)

def rw(p):
    with open(p, 'rb') as f:
        return f.read()

def wr(p, b):
    with open(p, 'wb') as f:
        f.write(b)

def crlf_info(b):
    return b.count(b'\r\n'), b.count(b'\n')

results = []

# ---------- 1 & 2: collection_perms / quota_limits（同款块，作用域 = specs/）----------
OLD_A = (b"try {\r\n"
         b"  files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })\r\n"
         b"    .split('\\n').filter(Boolean);\r\n"
         b"} catch (_) { files = []; }")

ADD_A = (b"\r\n"
         b"// —— 坑\u2461\u2088 \u5de5\u4f5c\u6811\u8865\u9762\uff1a`git ls-files` \u53ea\u626b index\uff0c\u5de5\u4f5c\u6811\u91cc\u65b0\u589e\u4f46\u672a `git add` \u7684 .md \u96f6\u8986\u76d6\r\n"
         b"//    \uff08round68 \u9996\u6b21\u5b9e\u8bc1\u3001round85 \u6536\u5c3e\uff09\u3002\u5b9a\u5f0f\u4e0e check_admin_auth_params / check_income_channel_seed \u4e00\u81f4\uff1a\r\n"
         b"//    \u626b\u63cf\u9762 = index \u222a \u5de5\u4f5c\u6811\u9012\u5f52\uff0c\u4e14\u4e0d\u6539\u53d8\u65ad\u8a00\u6570\u3002\r\n"
         b"try {\r\n"
         b"  const wt = [];\r\n"
         b"  const walkSpecs = (dir) => {\r\n"
         b"    let ents = [];\r\n"
         b"    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }\r\n"
         b"    for (const e of ents) {\r\n"
         b"      const p = path.join(dir, e.name);\r\n"
         b"      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walkSpecs(p); }\r\n"
         b"      else wt.push(path.relative(ROOT, p).replace(/\\\\/g, '/'));\r\n"
         b"    }\r\n"
         b"  };\r\n"
         b"  walkSpecs(path.join(ROOT, 'specs'));\r\n"
         b"  const seen = new Set(files);\r\n"
         b"  for (const f of wt) if (!seen.has(f)) { seen.add(f); files.push(f); }\r\n"
         b"} catch (_) { /* \u5de5\u4f5c\u6811\u4e0d\u53ef\u8bfb\uff1a\u9000\u5316\u4e3a\u7eaf index \u626b\u63cf */ }")

for name in ('check_collection_perms.js', 'check_quota_limits.js'):
    p = T(name)
    b = rw(p)
    c0, l0 = crlf_info(b)
    if OLD_A in b:
        b = b.replace(OLD_A, OLD_A + ADD_A, 1)
        wr(p, b)
        c1, l1 = crlf_info(rw(p))
        results.append('%s OK  CRLF %d->%d  LF %d->%d' % (name, c0, c1, l0, l1))
    else:
        results.append('%s MISS 锚点未命中（CRLF=%d LF=%d）' % (name, c0, l0))

# ---------- 3: check_suite_count_claims ----------
p = T('check_suite_count_claims.js')
b = rw(p)
OLD_3 = (b"  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })\r\n"
         b"    .split(/\\r?\\n/)\r\n"
         b"    .filter(Boolean);\r\n"
         b"}")
ADD_3 = (b"\r\n"
         b"  // \u5751\u2461\u2088 \u5de5\u4f5c\u6811\u8865\u9762\uff08round85\uff09\uff1a\u53ea\u626b index \u4f1a\u8ba9\u672a `git add` \u7684\u65b0 .md \u96f6\u8986\u76d6\u3002\r\n"
         b"  // \u4e0e gitTracked \u540c\u4e00\u6392\u9664\u9762\uff08review/ \u3001node_modules \u3001.git\uff09\uff0c\u4e14\u53ea\u6536 .md \u514d\u5f97\u628a\u53d6\u8bc1\u8fc7\u7a0b\u4ef6\u626b\u8fdb\u6765\u3002\r\n"
         b"  const fs2 = require('fs');\r\n"
         b"  const path2 = require('path');\r\n"
         b"  const wt = [];\r\n"
         b"  const walk = (dir) => {\r\n"
         b"    let ents = [];\r\n"
         b"    try { ents = fs2.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }\r\n"
         b"    for (const e of ents) {\r\n"
         b"      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'miniprogram_npm' || e.name === 'review') continue;\r\n"
         b"      const p = path2.join(dir, e.name);\r\n"
         b"      if (e.isDirectory()) walk(p);\r\n"
         b"      else if (e.name.endsWith('.md')) wt.push(path2.relative(ROOT, p).replace(/\\\\/g, '/'));\r\n"
         b"    }\r\n"
         b"  };\r\n"
         b"  walk(ROOT);\r\n"
         b"  return [...new Set([...out, ...wt])];\r\n"
         b"}")
NEW_3 = (b"  const out2 = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })\r\n"
         b"    .split(/\\r?\\n/)\r\n"
         b"    .filter(Boolean);\r\n") + ADD_3
if OLD_3 in b:
    b = b.replace(OLD_3, NEW_3, 1)
    wr(p, b)
    results.append('check_suite_count_claims.js OK')
else:
    results.append('check_suite_count_claims.js MISS 锚点未命中')

# ---------- 4: check_suite_coverage ----------
p = T('check_suite_coverage.js')
b = rw(p)
OLD_4 = (b"  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })\r\n"
         b"    .split(/\\r?\\n/).filter(Boolean);\r\n"
         b"}")
NEW_4 = (b"  const out2 = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })\r\n"
         b"    .split(/\\r?\\n/).filter(Boolean);\r\n"
         b"  // \u5751\u2461\u2088 \u5de5\u4f5c\u6811\u8865\u9762\uff08round85\uff09\uff1a\u5224\u636e\u811a\u672c\u5199\u5b8c\u8fd8\u6ca1 `git add` \u65f6\u4e0d\u5728 index \u91cc\r\n"
         b"  // \u21d2 \u9762 A \u5f53\u573a\u5931\u660e\uff08round70 \u5b9e\u8bc1\uff09\u3002\u8865\u9762\u8303\u56f4 = \u9762 A \u7684\u56db\u4e2a\u6839\u76ee\u5f55\uff0c\u53ea\u6536 .js\u3002\r\n"
         b"  const fs2 = require('fs');\r\n"
         b"  const path2 = require('path');\r\n"
         b"  const wt = [];\r\n"
         b"  const walkDir = (dir) => {\r\n"
         b"    let ents = [];\r\n"
         b"    try { ents = fs2.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }\r\n"
         b"    for (const e of ents) {\r\n"
         b"      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'miniprogram_npm') continue;\r\n"
         b"      const p = path2.join(dir, e.name);\r\n"
         b"      if (e.isDirectory()) walkDir(p);\r\n"
         b"      else if (e.name.endsWith('.js')) wt.push(path2.relative(ROOT, p).replace(/\\\\/g, '/'));\r\n"
         b"    }\r\n"
         b"  };\r\n"
         b"  for (const d of ['tools', path2.join('specs', 'dev-specs', 'prototype'), 'cloudfunctions']) walkDir(path2.join(ROOT, d));\r\n"
         b"  return [...new Set([...out2, ...wt])];\r\n"
         b"}")
if OLD_4 in b:
    b = b.replace(OLD_4, NEW_4, 1)
    wr(p, b)
    results.append('check_suite_coverage.js OK')
else:
    results.append('check_suite_coverage.js MISS 锚点未命中')

for r in results:
    print(r)
