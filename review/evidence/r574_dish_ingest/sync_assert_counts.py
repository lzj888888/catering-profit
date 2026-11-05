# -*- coding: utf-8 -*-
"""同步知识存储点第 44 行的两处断言数（二进制读写，保住 CRLF）。"""
import sys

P = 'specs/dev-specs/★知识存储点_2026-09-10.md'
PAIRS = [('`check_m333_parse`=23', '`check_m333_parse`=30'),
         ('`check_dishreview_engine`=119', '`check_dishreview_engine`=132')]

b = open(P, 'rb').read()
crlf_before = b.count(b'\r\n')
for old, new in PAIRS:
    n = b.count(old.encode('utf-8'))
    print('%-34s 命中 %d' % (old, n))
    if n != 1:
        print('❌ 命中数不为 1，中止（不改文件）')
        sys.exit(1)
for old, new in PAIRS:
    b = b.replace(old.encode('utf-8'), new.encode('utf-8'))
open(P, 'wb').write(b)

b2 = open(P, 'rb').read()
print('CRLF 保持:', b2.count(b'\r\n') == crlf_before)
for _, new in PAIRS:
    print('新值在场:', new, b2.count(new.encode('utf-8')))
