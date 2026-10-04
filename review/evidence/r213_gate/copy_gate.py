# -*- coding: utf-8 -*-
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
src = os.path.join(ROOT, 'review', 'evidence', 'r211_gate', 'run_gate4.py')
dst = os.path.join(HERE, 'run_gate4.py')
s = io.open(src, encoding='utf-8').read()
s = s.replace('r211_gate', 'r213_gate').replace('r210 门禁驱动', 'r213 门禁驱动')
io.open(dst, 'w', encoding='utf-8').write(s)
print('ok bytes=%d' % len(s))
