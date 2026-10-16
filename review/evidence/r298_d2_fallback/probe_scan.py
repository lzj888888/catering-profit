# -*- coding: utf-8 -*-
"""R298-D2 探针：扫描全仓「业务比率字段 + 缺省 0」形态，输出判定表原始清单。
只读，不写任何仓库文件。用法：python r298_d2_scan.py
"""
import os, re, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SCAN = ['pages', 'utils', 'cloudfunctions', 'miniprogram']
SKIP = {'node_modules', '.git', 'review', 'tools', '_probe_tmp', '_bak_r70',
        'specs', 'admin-h5', 'web-preview', 'images'}

# 比率 / 费率 语义字段（词尾 Rate/Pct/Ratio 或含 yield/loss）
FIELD = re.compile(
    r'\b(yield_rate|loss_rate|loss_pct|commission_rate|commission_min_fen|'
    r'[A-Za-z_$]*[Rr]ent[Rr]?[Pp]ct|[A-Za-z_$]*[Pp]latformRate|[A-Za-z_$]*[Pp]ackRate|'
    r'[A-Za-z_$]*[Dd]iscountRate|[A-Za-z_$]*[Cc]ardRate|[A-Za-z_$]*[Gg]roupPlatformRate|'
    r'[A-Za-z_$]*[Tt]akeawayRatio|[A-Za-z_$]*[Gg]roupRatio|[A-Za-z_$]*[Mm]arginPct|'
    r'[A-Za-z_$]{2,}Pct|[A-Za-z_$]{2,}Rate|[A-Za-z_$]{2,}Ratio)\b')

# 缺省 0 的三种写法
ZERO_OR  = re.compile(r'\|\|\s*0\b')
ZERO_TRI = re.compile(r'[:?]\s*0\s*(?:[,;)\]]|$)')


def strip_line_comment(s):
    i = s.find('//')
    return s[:i] if i >= 0 else s


rows = []
for d in SCAN:
    base = os.path.join(ROOT, d)
    if not os.path.isdir(base):
        continue
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [x for x in dirnames if x not in SKIP]
        for fn in filenames:
            if not fn.endswith('.js'):
                continue
            ap = os.path.join(dirpath, fn)
            rel = os.path.relpath(ap, ROOT).replace('\\', '/')
            try:
                txt = open(ap, 'r', encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            for i, line in enumerate(txt.split('\n'), 1):
                code = strip_line_comment(line)
                if not FIELD.search(code):
                    continue
                if not (ZERO_OR.search(code) or ZERO_TRI.search(code)):
                    continue
                # 必须在同一行出现「字段 + 缺省 0」，且字段确实参与该缺省
                rows.append((rel, i, line.strip()))

# 按「字段族」分组
def fam(line):
    if 'yield_rate' in line:
        return 'yield_rate(出成率)'
    if 'loss_' in line:
        return 'loss_rate/pct(损耗率)'
    if 'commission' in line:
        return 'commission(佣金)'
    if 'Ratio' in line or 'ratio' in line:
        return 'ratio(渠道占比)'
    if re.search(r'Rate', line):
        return 'Rate(费率)'
    if re.search(r'[Pp]ct', line):
        return 'Pct(占比)'
    return 'other'

groups = {}
for rel, i, line in rows:
    groups.setdefault(fam(line), []).append((rel, i, line))

print('扫描目录: %s' % ', '.join(SCAN))
print('总命中: %d 行\n' % len(rows))
for k in sorted(groups):
    g = groups[k]
    print('=' * 70)
    print('### %s  —— %d 行' % (k, len(g)))
    for rel, i, line in g:
        print('  %s:%d' % (rel, i))
        print('      %s' % line[:150])
    print()
