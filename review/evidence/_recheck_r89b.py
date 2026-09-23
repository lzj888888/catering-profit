# -*- coding: utf-8 -*-
"""round89 · V1 缺口的精确定界（不代修，只界定）：
G2 判据 = /min-height:\s*(<88 的数)rpx/ 且 20/40rpx 无条件豁免。
  V1b: 88→50rpx（不在豁免区）⇒ 应红  ⇒ 证明 G2 本体有效
  V1c: 只留 height:40rpx、删掉 min-height ⇒ 应红但 G2 不扫 height ⇒ 判绿（第二层缺口）
  V1d: 整个 .paste-btn 删掉 min-height 与 height（无高度声明）⇒ 同样不扫 ⇒ 判绿
"""
import os, subprocess

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
WXSS = 'pages/month/input.wxss'
AD = 'tools/selftest_ad_gates.js'

orig = open(os.path.join(ROOT, WXSS), 'rb').read()

def run(rel):
    r = subprocess.run([NODE, rel], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=180)
    out = (r.stdout or '') + (r.stderr or '')
    first = ''
    for l in out.splitlines():
        if '❌' in l:
            first = l.strip()[:90]; break
    return r.returncode == 0, first

def restore():
    open(os.path.join(ROOT, WXSS), 'wb').write(orig)

def v1b():
    a = b'min-height: 88rpx; height: 88rpx;'
    assert a in orig
    open(os.path.join(ROOT, WXSS), 'wb').write(orig.replace(a, b'min-height: 50rpx; height: 50rpx;', 1))

def v1c():
    a = b'min-height: 88rpx; height: 88rpx;'
    assert a in orig
    open(os.path.join(ROOT, WXSS), 'wb').write(orig.replace(a, b'height: 40rpx;', 1))

def v1d():
    a = b'min-height: 88rpx; height: 88rpx;'
    assert a in orig
    open(os.path.join(ROOT, WXSS), 'wb').write(orig.replace(a, b'', 1))

cases = [
    ('V1b', 'min-height 88→50rpx（不在 20/40 豁免区）', v1b, False),
    ('V1c', '只留 height:40rpx、删掉 min-height（G2 不扫 height）', v1c, False),
    ('V1d', '高度声明整个删除（无 min-height 也无 height）', v1d, False),
]
for mid, desc, fn, expect_green in cases:
    fn()
    g, first = run(AD)
    restore()
    g2, _ = run(AD)
    verdict = 'OK' if (g == expect_green and g2) else ('GAP' if (g != expect_green and g) else 'MISMATCH')
    print('%-4s %-8s expect=%-5s got=%-5s restore=%-5s %s | %s'
          % (mid, verdict, 'GREEN' if expect_green else 'RED', 'GREEN' if g else 'RED',
             'GREEN' if g2 else 'RED', desc, first))
