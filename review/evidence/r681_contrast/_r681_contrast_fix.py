# -*- coding: utf-8 -*-
# R681：文字对比度修复 —— 把 8 档"暖灰"收成 3 档，最弱一档也 ≥4.5:1。
# 🔴 只改 `color:` 属性（文字），不改 background / border（那是装饰层，浅一点没关系）。
#    负向后顾 (?<![-\w]) 用来排除 border-color / background-color。
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEAK = '#776C5E'          # 最弱文字档：页底 4.63 / 卡面 5.05（≥4.5 达标）
MID = '#6B6157'           # 次要档：页底 5.46 / 卡面 5.95
MAP = {
    '#7C7264': WEAK,      # 4.26 → 4.63
    '#857A6B': WEAK,      # 3.79 → 4.63
    '#9A9083': WEAK,      # 2.83 → 4.63
    '#A99E8E': WEAK,      # 2.38 → 4.63
    '#B5AB9C': WEAK,
    '#9A9184': MID,       # tabBar 未选色 3.36 → 5.46
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

total = 0
changed = 0
detail = []
for p in files():
    with io.open(p, 'r', encoding='utf-8') as fh:
        src = fh.read()
    orig = src
    n = 0
    for old, rep in MAP.items():
        # 只命中属性名为 color 的（前面不能紧跟 - 或字母）
        pat = re.compile(r'(?<![-\w])color(\s*:\s*)' + re.escape(old), re.I)
        src, k = pat.subn(lambda m, rep=rep: 'color' + m.group(1) + rep, src)
        n += k
    if src != orig:
        with io.open(p, 'w', encoding='utf-8', newline='') as fh:
            fh.write(src)
        changed += 1
        total += n
        detail.append('%s (%d)' % (os.path.relpath(p, ROOT).replace('\\', '/'), n))
print('files %d / color decls %d' % (changed, total))
for d in detail:
    print('  ' + d)
