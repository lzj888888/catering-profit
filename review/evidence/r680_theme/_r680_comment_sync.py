# -*- coding: utf-8 -*-
# R680 配套：把 pages/ subpkg/ 的 **wxss 注释**里引用的旧冷色值同步成新暖色值。
# 只动注释（生效代码上面已由 _r680_theme_apply.py 改完），app.wxss 跳过：
#   app.wxss 头注里「替代原冷蓝三色（#f5f6f8 / #f3f7fb / #e8eff7）」是**历史对照**，必须保留原值。
import os, re, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = [
    ('#f5f6f8', '#F6F3EC'), ('#f2f4f7', '#F6F3EC'),
    ('#f3f7fb', '#FBF6EC'), ('#f5f8fc', '#FBF6EC'),
    ('#e8eff7', '#F5EBD8'), ('#eef2f7', '#F0E9DC'), ('#eef1f5', '#F0E9DC'),
    ('#f0f0f0', '#EFE8DA'), ('#f5f5f5', '#F3ECDF'), ('#f2f5f9', '#F3ECDF'),
    ('#cfdae8', '#DCD2C0'), ('#e3e9f2', '#EDE6D8'), ('#c8d4e4', '#DCD0BB'),
    ('#6b7a90', '#7C7264'), ('#4a5b70', '#6B6157'), ('#5a6678', '#6B6157'),
    ('#646a73', '#6B6157'), ('#8a94a6', '#9A9184'), ('#9aa4b2', '#A99E8E'),
]

def files():
    out = []
    for base in ('pages', 'subpkg'):
        for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
            dn[:] = [d for d in dn if d not in ('node_modules', 'miniprogram_npm')]
            for f in fn:
                if f.endswith('.wxss'):
                    out.append(os.path.join(dp, f))
    return out

n_files = n_hits = 0
for p in files():
    with io.open(p, 'r', encoding='utf-8') as fh:
        src = fh.read()
    parts = re.split(r'(/\*[\s\S]*?\*/)', src)
    hit = 0
    for i, seg in enumerate(parts):
        if not seg.startswith('/*'):
            continue
        new = seg
        for old, rep in MAP:
            for variant in (old, old.upper()):
                if variant in new:
                    hit += new.count(variant)
                    new = new.replace(variant, rep)
        parts[i] = new
    if hit:
        with io.open(p, 'w', encoding='utf-8', newline='') as fh:
            fh.write(''.join(parts))
        n_files += 1
        n_hits += hit
        print('  %s  (%d)' % (os.path.relpath(p, ROOT).replace('\\', '/'), hit))
print('comment files: %d / hits: %d' % (n_files, n_hits))
