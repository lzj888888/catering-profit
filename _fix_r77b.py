# -*- coding: utf-8 -*-
"""round77 加固 v2：去重的判定收窄（filter(Boolean) 不算去重）"""
import hashlib

P = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\tools\selftest_ui_fix.js'
b = open(P, 'rb').read()

OLD = b"  const dedupe = /new Set\\(|indexOf|\\.filter\\(|\\.reduce\\(/.test(blk);"
NEW = (b"  // \u53bb\u91cd\u5fc5\u987b\u662f\u201c\u771f\u53bb\u91cd\u201d\uff1a`new Set(` \u6216 \u201cfilter/reduce + indexOf|includes\u201d"
       b"\u2014\u2014 \u5355\u7eaf `.filter(Boolean)` \u53ea\u662f\u53bb\u7a7a\uff0c\u4e0d\u7b97\uff08round77 A8 \u5b9e\u8bc1\uff09\u3002\n"
       b"  const dedupe = /new Set\\(/.test(blk)\n"
       b"    || ((/\\.filter\\(|\\.reduce\\(/.test(blk)) && /indexOf|includes\\(/.test(blk));")

if OLD not in b:
    print('ANCHOR MISS')
    raise SystemExit(1)
b2 = b.replace(OLD, NEW, 1)
open(P, 'wb').write(b2)
print('APPLIED  CRLF', b2.count(b'\r\n'), 'LF', b2.count(b'\n'))
