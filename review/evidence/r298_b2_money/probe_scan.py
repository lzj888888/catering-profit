# -*- coding: utf-8 -*-
"""R298 · B2「金额精度 / 四舍五入方向」静态扫描探针
目的：找出全仓所有「分↔元换算 / 取整 / 除法」点，并按"是否走 money 单源"分类。
"""
import os, re, io, sys

def find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        p = os.path.dirname(d)
        if p == d:
            raise RuntimeError('未找到仓根')
        d = p

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'node_modules', 'miniprogram_npm', '.git', '_probe_tmp', 'prototype'}

def walk(sub='', exts=('.js',)):
    out = []
    base = os.path.join(ROOT, sub) if sub else ROOT
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith(exts):
                out.append(os.path.relpath(os.path.join(dp, fn), ROOT).replace('\\', '/'))
    return sorted(out)

# 排除派生副本（cx_*.js 是 sync_common 从 common/ 复制来的，判单源只看源）
def is_derived(rel):
    return os.path.basename(rel).startswith('cx_')

files = [f for f in walk() if not is_derived(f)]

# ---------- 1. 裸换算模式（绕过 money 单源的高危写法）----------
PATTERNS = [
    ('A 元→分裸写',      re.compile(r'Math\.round\s*\(\s*[^()]*?\*\s*100\s*\)')),
    ('B 分→元裸写',      re.compile(r'Math\.round\s*\(\s*[^()]*?/\s*100\s*\)')),
    ('C 除法不取整',      re.compile(r'[A-Za-z_$][A-Za-z0-9_$.\[\]]*\s*/\s*100\b')),
    ('D toFixed(2)',     re.compile(r'\.toFixed\s*\(\s*2\s*\)')),
    ('E parseInt 截断',   re.compile(r'parseInt\s*\(')),
    ('F Math.floor',     re.compile(r'Math\.floor\s*\(')),
    ('G Math.ceil',      re.compile(r'Math\.ceil\s*\(')),
    ('H Math.trunc',     re.compile(r'Math\.trunc\s*\(')),
]

def strip_comments(s):
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s)
    return '\n'.join('' if re.match(r'^\s*//', l) else l for l in s.split('\n'))

print('=' * 78)
print('R298 · B2 金额精度静态扫描   （扫描面：%d 个 .js，已剔 cx_* 派生副本）' % len(files))
print('=' * 78)

hits = {}
for rel in files:
    try:
        s = io.open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    code = strip_comments(s)
    for name, rx in PATTERNS:
        for m in rx.finditer(code):
            ln = code[:m.start()].count('\n') + 1
            hits.setdefault(name, []).append((rel, ln, ' '.join(m.group(0).split())[:90]))

for name, _ in PATTERNS:
    lst = hits.get(name, [])
    print('\n### %s  —— 命中 %d' % (name, len(lst)))
    for rel, ln, txt in lst[:40]:
        print('   %-58s :%-5d %s' % (rel, ln, txt))
    if len(lst) > 40:
        print('   ...（另有 %d 处）' % (len(lst) - 40))

# ---------- 2. money 单源的调用面 ----------
print('\n' + '=' * 78)
print('### money 单源（cloudfunctions/common/money.js）被谁用')
print('=' * 78)
SRC = 'cloudfunctions/common/money.js'
print('\n-- 源文件本身 --')
print(io.open(os.path.join(ROOT, SRC), encoding='utf-8').read())
