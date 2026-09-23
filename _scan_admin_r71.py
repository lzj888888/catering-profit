# -*- coding: utf-8 -*-
"""round71 探查：全仓对后台鉴权参数（锁阈值/锁时长/token 有效期）的陈述面"""
import os, re, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
r = subprocess.run(['git', '-c', 'core.quotepath=false', 'ls-files'], cwd=ROOT,
                   capture_output=True, text=True, encoding='utf-8', errors='replace')
files = [l.strip() for l in r.stdout.splitlines() if l.strip().endswith('.md')]

ANCHOR = re.compile(r'ADMIN_LOCKED|locked_until|adminAuth|adminLogin|密码错|密码错误|token|令牌|超管|管理端鉴权|后台鉴权')
NUM = re.compile(r'(\d+)\s*(次|分钟|分|天|小时)')

for f in files:
    p = os.path.join(ROOT, f)
    if not os.path.exists(p):
        print('MISSING', f); continue
    txt = open(p, encoding='utf-8', errors='replace').read()
    for i, line in enumerate(txt.splitlines(), 1):
        if not ANCHOR.search(line):
            continue
        for m in NUM.finditer(line):
            idx = m.start()
            near = line[max(0, idx-40): idx+40]
            if ANCHOR.search(near):
                print('%s:%d  [%s]  %s' % (f, i, m.group(0), line.strip()[:160]))
                break
