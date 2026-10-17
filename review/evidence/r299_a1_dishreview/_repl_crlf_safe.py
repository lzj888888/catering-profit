# -*- coding: utf-8 -*-
"""CRLF 安全替换（按原始字节读写，行尾零改动）。改动写在本文件 REPS_BY_FILE 里。"""
import io

REPS_BY_FILE = {
    'specs/dev-specs/★知识存储点_2026-09-10.md': [
        ('串 **180** 个套件', '串 **181** 个套件'),
        ('现 **180**；2026-09-17', '现 **181**；2026-09-17'),
    ],
}

for p, reps in REPS_BY_FILE.items():
    raw = io.open(p, 'rb').read()
    s = raw.decode('utf-8')
    crlf = s.count('\r\n')
    lf_only = s.count('\n') - crlf
    for a, b in reps:
        n = s.count(a)
        assert n == 1, '命中 %d 处（要求恰 1）：%s' % (n, a[:50])
        s = s.replace(a, b)
    io.open(p, 'wb').write(s.encode('utf-8'))
    print('%s  CRLF=%d 纯LF=%d  →  CRLF=%d 纯LF=%d' % (
        p, crlf, lf_only, s.count('\r\n'), s.count('\n') - s.count('\r\n')))
