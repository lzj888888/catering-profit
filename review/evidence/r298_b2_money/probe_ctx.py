# -*- coding: utf-8 -*-
"""R298 B2 补漏：把「* 100」全部命中点连同上下文导出，供人工逐点语义分类。

与守卫 SKIP_DIRS 完全一致 —— 保证分析的是"同一张面"。
输出：probe_ctx_out.txt
"""
import os, re, io

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SKIP_DIRS = {'node_modules', 'miniprogram_npm', '.git', '.workbuddy', '_probe_tmp',
             'prototype', 'review', 'specs', 'tools'}

RE_IDENT = re.compile(r'([A-Za-z_$][A-Za-z0-9_$.]*)\s*\*\s*100(?!\d)')
RE_PAREN = re.compile(r'\)\s*\*\s*100(?!\d)')


def walk(root):
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith('.js') and not fn.startswith('cx_'):
                out.append(os.path.join(dp, fn))
    return sorted(out)


def strip_comments_lines(src):
    """剥块注释为空格（保留换行），行注释置空 —— 与守卫同口径，但保留行数组。"""
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), src)
    return [(l if not re.match(r'^\s*//', l) else '') for l in s.split('\n')]


files = walk(ROOT)
rows = []
for f in files:
    try:
        raw = io.open(f, 'r', encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    lines_raw = raw.split('\n')
    lines_clean = strip_comments_lines(raw)
    rel = os.path.relpath(f, ROOT).replace('\\', '/')
    for i, lc in enumerate(lines_clean):
        for m in RE_IDENT.finditer(lc):
            rows.append((rel, i + 1, 'IDENT', m.group(1), lines_raw[i]))
        for m in RE_PAREN.finditer(lc):
            rows.append((rel, i + 1, 'PAREN', '<expr>', lines_raw[i]))

rows.sort(key=lambda r: (r[0], r[1]))

with io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_ctx_out.txt'),
             'w', encoding='utf-8') as w:
    w.write('=' * 96 + '\n')
    w.write('R298 B2 补漏 · 「* 100」全命中点上下文  （扫描面 %d 个 .js）\n' % len(files))
    w.write('=' * 96 + '\n\n')
    cur = None
    for rel, ln, form, ident, text in rows:
        if rel != cur:
            cur = rel
            w.write('\n' + '-' * 96 + '\n### %s\n' % rel)
        w.write('  L%-5d [%-5s] ident=%-22s | %s\n' % (ln, form, ident, text.strip()[:190]))
    w.write('\n' + '=' * 96 + '\n')
    w.write('总计 %d 处\n' % len(rows))
    w.write('=' * 96 + '\n')

print('rows=%d files=%d' % (len(rows), len(files)))
print('IDENT=%d PAREN=%d' % (sum(1 for r in rows if r[2] == 'IDENT'),
                             sum(1 for r in rows if r[2] == 'PAREN')))
