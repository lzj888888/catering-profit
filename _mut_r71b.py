# -*- coding: utf-8 -*-
"""round71 双向变异回灌：新守卫 tools/check_admin_auth_params.js（R106）"""
import subprocess, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
GUARD = 'tools/check_admin_auth_params.js'
SRC = 'cloudfunctions/_adminCore/adminAuth.js'
D09 = 'specs/dev-specs/core/09_统一错误码表.md'
D16 = 'specs/dev-specs/core/16_后台鉴权规范.md'

SNAP = {}
def snap(f):
    if f not in SNAP:
        SNAP[f] = open(os.path.join(ROOT, f), 'rb').read()
def restore():
    for f, b in SNAP.items():
        open(os.path.join(ROOT, f), 'wb').write(b)
    SNAP.clear()

def apply(f, old, new):
    snap(f)
    p = os.path.join(ROOT, f)
    d = open(p, 'rb').read().decode('utf-8')
    n = d.count(old)
    if n == 0:
        return 0
    open(p, 'wb').write(d.replace(old, new).encode('utf-8'))
    return n

def run():
    r = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return r.returncode, r.stdout

def report(tag, desc, expect):
    rc, out = run()
    got = 'RED' if rc != 0 else 'GREEN'
    reds = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
    ok = (got == expect)
    print('%-5s %-46s expect=%-5s got=%-5s %s' % (tag, desc[:46], expect, got, 'OK' if ok else 'MISMATCH'))
    for l in reds[:4]:
        print('        ' + l)
    return ok

MUTS = [
 ('M1', '单源 LOCK_AFTER_FAILS 5→10（放松锁阈值）', 'RED',
  [(SRC, 'const LOCK_AFTER_FAILS = 5;', 'const LOCK_AFTER_FAILS = 10;')]),
 ('M2', '单源 TOKEN_TTL_MS 7→30 天（放松有效期）', 'RED',
  [(SRC, 'const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;', 'const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;')]),
 ('M3', '单源 LOCK_DURATION_MS 30→15 分钟', 'RED',
  [(SRC, 'const LOCK_DURATION_MS = 30 * 60 * 1000;', 'const LOCK_DURATION_MS = 15 * 60 * 1000;')]),
 ('M4', '换另一文件写旧值（core/09 改 3 次/15 分钟）', 'RED',
  [(D09, '连续 5 次密码错误（锁 30 分钟）', '连续 3 次密码错误（锁 15 分钟）')]),
 ('M5', '删唯一声明行（fail-closed）', 'RED',
  [(D16, '> 🔐 **后台鉴权参数口径（唯一声明处）**：锁阈值 **5** 次 / 锁时长 **30** 分钟 / token 有效期 **7** 天。\n', '')]),
 ('M6', '声明换措辞「输错即锁 / 有效」（不错杀）', 'GREEN',
  [(D16, '锁阈值 **5** 次 / 锁时长 **30** 分钟 / token 有效期 **7** 天',
    '连续 **5** 次输错即锁 **30** 分钟，token 有效 **7** 天')]),
 ('M7', '无关计数（导出文件保留 7 天）·不错杀', 'GREEN',
  [(D16, '## 9. CSRF 防护（后台 H5 专有）', '## 9. CSRF 防护（后台 H5 专有）\n\n- 导出文件保留 7 天后清理。')]),
 ('M8', '扫描面两个通道全断（git+工作树根路径都错）', 'RED',
  [(GUARD, "const roots = ['specs', 'review', 'docs', 'delivery'];", "const roots = ['specs_typo'];"),
   (GUARD, "execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files']", "execFileSync('git_none', ['-c', 'core.quotepath=false', 'ls-files']")]),
 ('M9', 'P4 排除面写错（前提守卫非恒真）', 'RED',
  [(GUARD, "if (rel.startsWith('review/')) reviewHits.push(rec);", "if (rel.startsWith('review_none/')) reviewHits.push(rec);")]),
]

allok = True
for tag, desc, expect, edits in MUTS:
    applied = []
    for f, old, new in edits:
        n = apply(f, old, new)
        if n == 0 and '\n' in old and '\r\n' not in old:
            n = apply(f, old.replace('\n', '\r\n'), new.replace('\n', '\r\n'))
        applied.append((f, n))
    if all(n == 0 for _, n in applied):
        print('%-5s %s => MUTATION_NOT_APPLIED %s' % (tag, desc, applied))
        restore(); allok = False; continue
    ok = report(tag, desc, expect)
    allok = allok and ok
    restore()

print('=== 还原后 ===')
rc, out = run()
print('  rc=%d  %s' % (rc, [l for l in out.splitlines() if '守卫结果' in l][-1].strip()))
print('ALL_OK' if allok else 'HAS_MISMATCH')
