# -*- coding: utf-8 -*-
"""round89 · 独立复核并发方 commit e1056b2（外卖 UI 两行渲染 + 粘贴按钮轻量化）。
① 门禁全量（e1056b2 之后）② 定向变异：热区/字号改小 ⇒ AD 套件必须转红（证明其改动在门禁监管下，非漏网）
③ 反向：不改（干净态）⇒ 绿。还原一律字节快照回写（不动行尾、不碰他人内容）。"""
import os, subprocess

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
WXSS = 'pages/month/input.wxss'
AD = 'tools/selftest_ad_gates.js'

def run(rel):
    r = subprocess.run([NODE, rel], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=180)
    out = (r.stdout or '') + (r.stderr or '')
    green = (r.returncode == 0)
    first = ''
    for l in out.splitlines():
        if '❌' in l:
            first = l.strip()[:80]; break
    return green, r.returncode, first, out

orig = open(os.path.join(ROOT, WXSS), 'rb').read()
print('wxss CRLF=%d LF=%d EQU=%s' % (orig.count(b'\r\n'), orig.count(b'\n'), orig.count(b'\r\n') == orig.count(b'\n')))

def restore():
    open(os.path.join(ROOT, WXSS), 'wb').write(orig)

def mutate_hotzone():
    d = orig
    a = b'min-height: 88rpx; height: 88rpx;'
    assert a in d, 'hotzone anchor missing'
    open(os.path.join(ROOT, WXSS), 'wb').write(d.replace(a, b'min-height: 40rpx; height: 40rpx;', 1))

def mutate_font():
    lines = orig.split(b'\n')
    hit = 0
    for i, l in enumerate(lines):
        if b'.paste-btn {' in l and b'font-size: 28rpx' in l:
            lines[i] = l.replace(b'font-size: 28rpx', b'font-size: 20rpx', 1); hit += 1; break
    assert hit == 1, 'font anchor missing'
    open(os.path.join(ROOT, WXSS), 'wb').write(b'\n'.join(lines))

cases = [
    ('V0-clean', '干净态（e1056b2 原样）', None, True),
    ('V1-hotzone', '粘贴按钮热区 88rpx→40rpx（AD G2 触控）', mutate_hotzone, False),
    ('V2-font', '粘贴按钮字号 28rpx→20rpx（AD G1 字号）', mutate_font, False),
]
bad = []
for mid, desc, fn, expect_green in cases:
    if fn: fn()
    else: restore()
    g, rc, first, _ = run(AD)
    restore()
    g2, _, _, _ = run(AD)
    ok = (g == expect_green) and g2
    if not ok: bad.append(mid)
    print('%-11s %-8s expect=%-5s got=%-5s restore=%-5s %s | %s'
          % (mid, 'OK' if ok else 'MISMATCH', 'GREEN' if expect_green else 'RED',
             'GREEN' if g else 'RED', 'GREEN' if g2 else 'RED', desc, first))

# 门禁全量（e1056b2 之后）
g, rc, first, out = run('verify_all.js')
tail = [l for l in out.splitlines() if '总览' in l]
print('\n门禁全量（e1056b2 之后）：rc=%d %s' % (rc, tail[-1].strip() if tail else 'NO_SUMMARY'))
if not g: bad.append('gate')
print('\n===== 独立复核汇总：异常 %d 项 =====' % len(bad))
for b in bad: print('  ', b)
