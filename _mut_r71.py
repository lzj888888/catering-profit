# -*- coding: utf-8 -*-
"""round71 独立变异回灌：复核 commit 48bf7c9（round70 口径折叠 + 渠道行两行）新增守卫"""
import subprocess, shutil, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = ['pages/month/input.wxml', 'pages/month/input.wxss', 'pages/month/input.js']
SNAP = {f: open(os.path.join(ROOT, f), 'rb').read() for f in FILES}

def run(scripts):
    rcs = []
    for s in scripts:
        p = subprocess.run(['node', s], cwd=ROOT, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        tail = [l for l in p.stdout.splitlines() if '通过 /' in l or '失败' in l][-1:] 
        rcs.append((s, p.returncode, tail[0].strip() if tail else ''))
    return rcs

SCRIPTS = ['tools/selftest_batch8b.js', 'tools/selftest_batch8c.js', 'tools/selftest_ad_gates.js']

def apply(f, old, new, count=None):
    path = os.path.join(ROOT, f)
    d = open(path, 'rb').read().decode('utf-8')
    n = d.count(old)
    if n == 0:
        return 0
    d = d.replace(old, new)
    open(path, 'wb').write(d.encode('utf-8'))
    return n

def restore():
    for f, b in SNAP.items():
        open(os.path.join(ROOT, f), 'wb').write(b)

def report(tag, expect, rcs):
    red = [s for s, rc, _ in rcs if rc != 0]
    got = 'RED' if red else 'GREEN'
    ok = (got == expect)
    print('%-6s expect=%-5s got=%-5s %s  %s' % (tag, expect, got, 'OK' if ok else 'MISMATCH', red))
    for s, rc, t in rcs:
        print('        %s rc=%d %s' % (s, rc, t))
    return ok

MUTS = [
 ('M1', '口径句退回常展开', 'RED',
  [('pages/month/input.wxml',
    '<view class="scope" wx:if="{{g.scopeOpen}}">{{g.scope}}</view>',
    '<view class="scope" wx:if="{{g.scope}}">{{g.scope}}</view>')]),
 ('M2', '金额框挪回行①（与渠道名抢宽）', 'RED',
  [('pages/month/input.wxml',
    '<input wx:if="{{!r.fixed}}" class="dine-name inp"',
    '<input wx:if="{{!r.fixed}}" class="dine-name inp dine-amt"')]),
 ('M3', '× 触控高度 88→60rpx（G2 硬约束）', 'RED',
  [('pages/month/input.wxss',
    '.btn-del {\n  flex: 0 0 auto; width: 72rpx; min-height: 88rpx;',
    '.btn-del {\n  flex: 0 0 auto; width: 72rpx; min-height: 60rpx;')]),
 ('M4', '仅换类名（两行结构不变）·判据强度', 'GREEN?',
  [('pages/month/input.wxml', 'class="dine-line1"', 'class="dine-rowA"'),
   ('pages/month/input.wxml', 'class="dine-line2"', 'class="dine-rowB"')]),
 ('M5', '正确实现换箭头字形（折叠机制不变）·不错杀', 'GREEN',
  [('pages/month/input.wxml',
    "<text class=\"scope-arrow\">{{g.scopeOpen ? '▾' : '▸'}}</text>",
    "<text class=\"scope-arrow\">{{g.scopeOpen ? '▲' : '▶'}}</text>")]),
 ('M6', '口径样式加间距（不改折叠结构）·不错杀', 'GREEN',
  [('pages/month/input.wxss', '.scope-fold { padding: 0 0 6rpx; }',
    '.scope-fold { padding: 0 0 10rpx; margin-top: 4rpx; }')]),
 ('M7', 'scopeOpen 初值改 true（默认展开）', 'RED',
  [('pages/month/input.js', 'scopeOpen: false,', 'scopeOpen: true,')]),
]

NOTE_APPLIED = []
allok = True
for tag, desc, expect, edits in MUTS:
    applied = []
    for f, old, new in edits:
        n = apply(f, old, new)
        # 若 CRLF 未命中，试 LF
        if n == 0 and '\r\n' not in old:
            n = apply(f, old.replace('\n', '\r\n'), new.replace('\n', '\r\n'))
        applied.append((f, n))
    if all(n == 0 for _, n in applied):
        print('%-6s %s => MUTATION_NOT_APPLIED %s' % (tag, desc, applied))
        restore()
        allok = False
        continue
    print('--- %s %s applied=%s' % (tag, desc, applied))
    rcs = run(SCRIPTS)
    exp = 'RED' if expect.startswith('RED') else 'GREEN'
    ok = report(tag, exp, rcs)
    if expect == 'GREEN?':
        ok = True
    allok = allok and ok
    restore()

print('=== 还原后 ===')
rcs = run(SCRIPTS)
for s, rc, t in rcs:
    print('  %s rc=%d %s' % (s, rc, t))
print('ALL_OK' if allok else 'HAS_MISMATCH')
