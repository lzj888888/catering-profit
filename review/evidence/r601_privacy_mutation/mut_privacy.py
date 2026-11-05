# -*- coding: utf-8 -*-
"""R601 真变异：证明隐私守卫能抓「代码有剪贴板 / 文档没登记」。

变异 M1：从隐私政策 §二 表格里删掉第 8 行（剪贴板），保留声明数 8。
预期：C4-①（声明 8 ≠ 表格 7）红 + C6（getClipboardData 未登记）红。
还原后必须复绿；任何异常都在 finally 里还原并校验 md5。
"""
import hashlib
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DOC = os.path.join(ROOT, 'specs', 'dev-specs', '上线材料_隐私政策_v1.md')
GUARD = os.path.join(ROOT, 'tools', 'check_privacy_collection.js')
OUT = os.path.join(os.path.dirname(__file__), 'mut_privacy_result.txt')

def md5(p):
    with open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

orig_md5 = md5(DOC)
with open(DOC, 'r', encoding='utf-8') as f:
    original = f.read()

lines = original.split('\n')
target = [i for i, l in enumerate(lines) if '剪贴板内容' in l and l.strip().startswith('|')]
if len(target) != 1:
    print('ABORT: 目标行定位失败，命中 %d 行' % len(target))
    sys.exit(2)

result = []
try:
    mutated = '\n'.join(lines[:target[0]] + lines[target[0] + 1:])
    with open(DOC, 'w', encoding='utf-8', newline='') as f:
        f.write(mutated)
    p = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    red = [l for l in out.split('\n') if l.strip().startswith('❌')]
    result.append('M1 rc=%d 红项=%d' % (p.returncode, len(red)))
    for l in red:
        result.append('   ' + l.strip())
finally:
    with open(DOC, 'w', encoding='utf-8', newline='') as f:
        f.write(original)
    restored = md5(DOC) == orig_md5
    result.append('还原 md5 一致: %s' % restored)
    p2 = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True,
                        encoding='utf-8', errors='replace')
    back = [l for l in ((p2.stdout or '') + (p2.stderr or '')).split('\n') if l.strip().startswith('❌')]
    result.append('还原后 rc=%d 红项=%d' % (p2.returncode, len(back)))

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(result) + '\n')
print('\n'.join(result))
