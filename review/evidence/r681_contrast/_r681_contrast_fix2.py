# -*- coding: utf-8 -*-
# R681 第二步：全站文字对比度补齐到 WCAG AA（≥4.5:1）。
# 分两类：
#   ① 浅底上的浅灰字 —— 收进三档制；
#   ② 语义色（红/绿/琥珀/蓝）本身在米白底上偏浅 —— 同色相压深，语义不变。
# 🔴 只改 `color:` 属性。同一色值当 background / border 用（色块、图标底）一律不动。
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WEAK = '#776C5E'   # 最弱文字档 4.63:1
MID = '#6B6157'    # 次要档 5.46:1
RED = '#c0392b'    # 危险/亏损 4.91:1（原 #e74c3c 仅 3.76）
GREEN = '#1a7d55'  # 正向/节约 4.61:1（原 #1e9e5a 仅 3.39）
AMBER = '#9A5B00'  # 提醒 4.90:1（原 #d68910 仅 2.77）
BLUE = '#1a5eb8'   # 链接 5.68:1（原 #2b7de9 仅 3.96）

MAP = {
    # ① 浅灰
    '#B3A894': WEAK, '#9aa3af': WEAK, '#8b97a7': MID, '#8a97a6': WEAK,
    '#8896ab': MID, '#8a93a0': WEAK, '#7b8794': MID, '#7a8698': WEAK,
    '#8a8a8a': MID, '#a8b6c8': WEAK, '#9a7b50': WEAK, '#bbb': WEAK,
    # ② 语义色
    '#e74c3c': RED, '#e2533a': RED,
    '#22a06b': GREEN, '#1e9e5a': GREEN, '#1f9254': GREEN,
    '#1e8e3e': GREEN, '#1e8e5a': GREEN,
    '#d68910': AMBER, '#b9770e': AMBER, '#a9761b': AMBER,
    '#c2701a': AMBER, '#a86a00': AMBER,
    '#2b7de9': BLUE,
}

def files():
    out = [os.path.join(ROOT, 'app.wxss')]
    for base in ('pages', 'subpkg'):
        for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
            dn[:] = [d for d in dn if d not in ('node_modules', 'miniprogram_npm')]
            for f in fn:
                if f.endswith('.wxss'):
                    out.append(os.path.join(dp, f))
    return out

total, changed, detail = 0, 0, []
for p in files():
    src = io.open(p, 'r', encoding='utf-8').read()
    orig = src
    n = 0
    for old, rep in MAP.items():
        pat = re.compile(r'(?<![-\w])color(\s*:\s*)' + re.escape(old) + r'(?![0-9a-fA-F])', re.I)
        src, k = pat.subn(lambda m, rep=rep: 'color' + m.group(1) + rep, src)
        n += k
    if src != orig:
        io.open(p, 'w', encoding='utf-8', newline='').write(src)
        changed += 1
        total += n
        detail.append('  %s (%d)' % (os.path.relpath(p, ROOT).replace('\\', '/'), n))
print('wxss files %d / color decls %d' % (changed, total))
print('\n'.join(detail))

# ③ wxml 内联 style 里的 color（与 wxss 同源，必须一起改，否则同一页两种红）
wchanged = wtotal = 0
for base in ('pages', 'subpkg'):
    for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
        dn[:] = [d for d in dn if d not in ('node_modules', 'miniprogram_npm')]
        for f in fn:
            if not f.endswith('.wxml'):
                continue
            p = os.path.join(dp, f)
            src = io.open(p, 'r', encoding='utf-8').read()
            orig = src
            n = 0
            for old, rep in MAP.items():
                pat = re.compile(r'color\s*:\s*' + re.escape(old) + r'(?![0-9a-fA-F])', re.I)
                src, k = pat.subn('color:' + rep, src)
                n += k
            if src != orig:
                io.open(p, 'w', encoding='utf-8', newline='').write(src)
                wchanged += 1
                wtotal += n
                print('  wxml %s (%d)' % (os.path.relpath(p, ROOT).replace('\\', '/'), n))
print('wxml files %d / inline colors %d' % (wchanged, wtotal))
