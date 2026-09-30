# -*- coding: utf-8 -*-
import sqlite3, json, io
payload = io.open('resume_e.txt', encoding='utf-8').read()
c = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
b = c.execute("select body from sessions where id='831bd65c-70cb-4600-8fb6-7ebe07886768'").fetchone()[0]
us = [m for m in json.loads(b)['messages'] if m.get('role') == 'User']
last = us[-1].get('text') or ''
print('载荷 =', len(payload), '| 末条 =', len(last), '| diff =', len(payload) - len(last))
print('重复判据 (末条应远小于 2x):', 'PASS 未重复' if len(last) < len(payload)*1.5 else 'FAIL 疑似重复')
print('逐字判据 (last == payload.rstrip):', 'PASS' if last == payload.rstrip('\n') else 'FAIL')
print('reversed-tail 对齐:', repr(last[-40:]), '||', repr(payload.rstrip('\n')[-40:]))
