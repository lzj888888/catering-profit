# -*- coding: utf-8 -*-
# _diag_gate.py —— 从 gate_1.txt 里抽出每个失败套件的报错片段（追为什么「单独跑绿、串跑红」）
import io, re, os

p = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r209_gate/gate_1.txt"
s = io.open(p, 'r', encoding='utf-8', errors='replace').read()

targets = ['docx-derive', 'suite-coverage', 'suite-count-claims', 'quota-limits',
           'collection-perms', 'privacy-collection', 'acceptance-counts',
           'suite-assert-counts', 'r85-takeaway', 'month-picker']

# 按 "===== [name] rel =====" 切块
parts = re.split(r'\n===== \[([^\]]+)\] ', s)
for i in range(1, len(parts), 2):
    name = parts[i]
    body = parts[i + 1] if i + 1 < len(parts) else ''
    if name not in targets:
        continue
    head = body.split('\n')[0]
    print('=' * 72)
    print('### [' + name + '] ' + head)
    ls = [l for l in body.split('\n')]
    if 'FAIL' in ''.join(ls[:3]):
        print('    ↓ 该套件在串跑中的输出尾部：')
        for l in ls[-25:]:
            t = l.strip()
            if t:
                print('      ' + t[:220])
    else:
        print('    （串跑中未判 FAIL）')
