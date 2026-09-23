# -*- coding: utf-8 -*-
"""round81 防回潮扫描：specs 全树 md 被 tools/+prototype/ 引用次数（0 引用 = 候选面）"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
while os.path.basename(ROOT) != 'catering-profit':
    ROOT = os.path.dirname(ROOT)
os.chdir(ROOT)

# 扫描面 = specs 全树（round79 教训：不能只扫 core/ + dev-specs/*.md）
r = subprocess.run(['git', '-c', 'core.quotepath=false', 'ls-files', 'specs'],
                   capture_output=True, text=True, encoding='utf-8')
docs = [p for p in r.stdout.splitlines() if p.lower().endswith('.md')]
print('扫描面 specs/*.md 份数 =', len(docs))

# 引用面 = tools/ + prototype/ 下所有 js/py
ref_files = []
for d in ['tools', 'specs/dev-specs/prototype']:
    for dp, dn, fn in os.walk(d):
        for f in fn:
            if f.endswith(('.js', '.py', '.json')):
                ref_files.append(os.path.join(dp, f).replace('\\', '/'))
ref_files.append('verify_all.js')
print('引用面文件数 =', len(ref_files))

corpus = {}
for p in ref_files:
    try:
        corpus[p] = open(p, 'r', encoding='utf-8', errors='ignore').read()
    except Exception:
        pass

zero = []
for d in docs:
    base = os.path.basename(d)
    stem = os.path.splitext(base)[0]
    hits = 0
    for p, c in corpus.items():
        if base in c or (stem and stem in c):
            hits += 1
    if hits == 0:
        zero.append(d)
    print('%3d  %s' % (hits, d))

print('\n===== 零引用候选 (%d) =====' % len(zero))
for z in zero:
    print('  ', z)
