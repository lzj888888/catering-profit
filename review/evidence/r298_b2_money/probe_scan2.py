# -*- coding: utf-8 -*-
"""R298 · B2 补漏探针（第二轮）
目的：证明守卫 tools/check_money_precision.js 的元语义判据（标识符白名单
      yuan|price|amount|money）**有结构性缺口** —— 生产面里真·元→分 有 8 处用了
      别的名字（net / n / (income==null?0:income)），守卫一处都看不见。

做法：不做任何标识符过滤，把所有 `* 100` 乘积**连同上下文**打出来，由人判语义。
"""
import os, re, io

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
# 与守卫 tools/check_money_precision.js 的 SKIP_DIRS 完全一致（保证"同一张面"）
SKIP_DIRS = {'node_modules', 'miniprogram_npm', '.git', '.workbuddy', '_probe_tmp',
             'prototype', 'review', 'specs', 'tools'}

def walk():
    out = []
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith('.js') and not fn.startswith('cx_'):
                out.append(os.path.relpath(os.path.join(dp, fn), ROOT).replace('\\', '/'))
    return sorted(out)

def strip_comments(s):
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s)
    return '\n'.join('' if re.match(r'^\s*//', l) else l for l in s.split('\n'))

# 与守卫同源的「乘积」锚：但**不带标识符白名单**
RE_PROD = re.compile(r'([A-Za-z_$][A-Za-z0-9_$.]*)\s*\*\s*100(?!\d)')
# 括号形态：`(...) * 100` —— 守卫的 RE_PROD 因"需标识符紧邻"而**完全看不见**
RE_PAREN = re.compile(r'\)\s*\*\s*100(?!\d)')

files = walk()
print('=' * 80)
print('R298 · B2 补漏探针  扫描面 %d 个 .js（与守卫 SKIP_DIRS 完全一致）' % len(files))
print('=' * 80)

rows = []
for rel in files:
    try:
        s = io.open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    code = strip_comments(s)
    for m in RE_PROD.finditer(code):
        ln = code[:m.start()].count('\n') + 1
        win = ' '.join(code[max(0, m.start() - 70):m.start() + 22].split())
        rows.append((rel, ln, m.group(1), 'IDENT', win))
    for m in RE_PAREN.finditer(code):
        ln = code[:m.start()].count('\n') + 1
        win = ' '.join(code[max(0, m.start() - 80):m.start() + 20].split())
        rows.append((rel, ln, '(…)', 'PAREN', win))

ident_rows = [r for r in rows if r[3] == 'IDENT']
paren_rows = [r for r in rows if r[3] == 'PAREN']

YUAN_WORD = re.compile(r'yuan|price|amount|money', re.I)

print('\n### IDENT 形态（标识符紧邻 * 100）—— 共 %d 处' % len(ident_rows))
print('  守卫能看见的（标识符命中白名单）：')
for rel, ln, ident, _, win in ident_rows:
    if YUAN_WORD.search(ident):
        print('    ✓ %-56s :%-5d %s' % (rel, ln, win))
print('  守卫**看不见**的（标识符不在白名单）：')
for rel, ln, ident, _, win in ident_rows:
    if not YUAN_WORD.search(ident):
        print('    ✗ %-56s :%-5d ident=%-22s %s' % (rel, ln, ident, win))

print('\n### PAREN 形态（`) * 100`）—— 共 %d 处；守卫 RE_PROD **完全不可见**' % len(paren_rows))
for rel, ln, _, _, win in paren_rows:
    print('    ✗ %-56s :%-5d %s' % (rel, ln, win))

print('\n' + '=' * 80)
print('小结：守卫可见 %d 处 / 面内总计 %d 处 ⇒ 观测覆盖率 %.1f%%'
      % (len([r for r in ident_rows if YUAN_WORD.search(r[2])]), len(rows),
         100.0 * len([r for r in ident_rows if YUAN_WORD.search(r[2])]) / max(1, len(rows))))
print('=' * 80)
