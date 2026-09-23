# -*- coding: utf-8 -*-
"""round81 实扫：core/11 §2 微信审核硬红线口径，全仓引用面"""
import os, re, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
while os.path.basename(ROOT) != 'catering-profit':
    ROOT = os.path.dirname(ROOT)
os.chdir(ROOT)

F = 'specs/dev-specs/core/11_微信审核自查清单.md'
t = open(F, 'r', encoding='utf-8', errors='ignore').read()
lines = t.splitlines()

# 1) §2 硬红线清单实算（'> N. ' 形式，位于 §2 内）
start = None
for i, l in enumerate(lines):
    if '店算微信审核硬红线清单' in l:
        start = i
        break
rows = []
if start is not None:
    for l in lines[start:start + 15]:
        m = re.match(r'^>\s*(\d+)\.\s*(.+)$', l)
        if m:
            rows.append((int(m.group(1)), m.group(2).strip()))
print('=== §2 硬红线清单实算 ===')
for n, txt in rows:
    print('  %d. %s' % (n, txt[:70]))
print('实算条数 =', len(rows))
print('序号连续 =', [r[0] for r in rows] == list(range(1, len(rows) + 1)))

# 2) §6 勾选条数
cb = [l for l in lines if l.startswith('- [ ]')]
print('\n§6 勾选条数 =', len(cb))

# 3) 全仓「硬红线 / 审核红线」+ 数字 的陈述面
r = subprocess.run(['git', '-c', 'core.quotepath=false', 'ls-files'],
                   capture_output=True, text=True, encoding='utf-8')
files = [p for p in r.stdout.splitlines()
         if re.search(r'\.(md|txt|js|json)$', p) and not p.startswith('review/')]
print('\n扫描面文件数 =', len(files))
NUM = re.compile(r'(\d+)\s*(条|项)')
KW = ['硬红线', '审核红线', '一票否决', '驳回']
hits = []
for p in files:
    try:
        s = open(p, 'r', encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    for i, l in enumerate(s.splitlines(), 1):
        if not any(k in l for k in KW):
            continue
        for m in NUM.finditer(l):
            hits.append((p, i, m.group(0), l.strip()[:150]))
print('\n=== 全仓「红线类关键词 + 数字」命中 %d 处 ===' % len(hits))
for p, i, n, txt in hits:
    print('  %s:%d  [%s]' % (p, i, n))
    print('      %s' % txt)
