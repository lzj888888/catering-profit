import os, subprocess, sys
ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
# 扫描面：tools/ + prototype/ + verify_all.js（守卫/判据所在）
scanners = []
for d in ['tools', os.path.join('specs','dev-specs','prototype')]:
    p = os.path.join(ROOT, d)
    for fn in os.listdir(p):
        if fn.endswith('.js'):
            scanners.append(os.path.join(p, fn))
scanners.append(os.path.join(ROOT, 'verify_all.js'))
scanners.append(os.path.join(ROOT, 'tools', 'verify_docx.py'))
blob = {}
for s in scanners:
    try:
        blob[s] = open(s, 'rb').read().decode('utf-8', 'replace')
    except Exception:
        pass

# 被扫面：specs 全树 .md
mds = []
for dp, dn, fnames in os.walk(os.path.join(ROOT, 'specs')):
    if '.git' in dp:
        continue
    for f in fnames:
        if f.endswith('.md'):
            mds.append(os.path.join(dp, f))
print('MD_TOTAL', len(mds))

zero = []
for m in mds:
    base = os.path.basename(m)
    rel = os.path.relpath(m, ROOT).replace('\\', '/')
    stem = base[:-3]
    n = 0
    for s, txt in blob.items():
        if os.path.basename(s) == base:
            continue
        if stem in txt or base in txt or rel in txt:
            n += 1
    if n == 0:
        zero.append(rel)
print('ZERO_REF', len(zero))
for z in sorted(zero):
    print('  ', z)
