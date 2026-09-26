# -*- coding: utf-8 -*-
"""round129 · M3 关键字段落地扫描（只读）"""
import os, io

R = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
KEYS = ['card_type', 'line_type', 'sub_card_ref', 'sub_version', 'specs_json',
        'price_promo', 'commission', 'takeaway', 'combo', 'per100g',
        's_user', 's_merchant', 'aliases', 'input_type', 'is_virtual']

targets = []
for base in ['cloudfunctions', 'pages', 'miniprogram', 'tools']:
    d = os.path.join(R, base)
    if not os.path.isdir(d):
        continue
    for root, dirs, files in os.walk(d):
        for f in files:
            if f.endswith(('.js', '.wxml', '.json', '.wxss')):
                targets.append(os.path.join(root, f))

hit = {k: [] for k in KEYS}
for p in targets:
    try:
        t = io.open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    rel = os.path.relpath(p, R)
    rel = rel.replace(os.sep, '/')
    for k in KEYS:
        if k in t:
            hit[k].append(rel)

print('=== 字段落地扫描（0 = 代码里完全没有这个概念）===')
for k in KEYS:
    n = len(hit[k])
    if n:
        print('  %-14s 命中 %2d 文件  例: %s' % (k, n, ' | '.join(hit[k][:3])))
    else:
        print('  %-14s 命中  0 文件   —— 无' % k)

print()
print('=== 找 collections.js ===')
for root, dirs, files in os.walk(R):
    if 'collections.js' in files:
        print('  ', os.path.relpath(os.path.join(root, 'collections.js'), R).replace(os.sep, '/'))
