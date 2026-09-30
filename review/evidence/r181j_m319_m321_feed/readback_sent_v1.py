# -*- coding: utf-8 -*-
import sqlite3, json, io, sys
payload = io.open('resume_e.txt', encoding='utf-8').read()
c = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
b = c.execute("select body from sessions where id='831bd65c-70cb-4600-8fb6-7ebe07886768'").fetchone()[0]
msgs = json.loads(b)['messages']
us = [m for m in msgs if m.get('role') == 'User']
last = us[-1].get('text') or ''
print('User 条数 =', len(us))
print('载荷 chars =', len(payload))
print('末条 User chars =', len(last))
print('长度判据 (应 == 载荷):', 'PASS' if len(last) == len(payload) else 'FAIL (2x? %d)' % (len(last)//max(len(payload),1)))
print('逐字判据:', 'PASS (完全一致)' if last == payload else 'FAIL')
if last != payload:
    print('--- 末条前 200 字 ---'); print(last[:200])
    print('--- 载荷前 200 字 ---'); print(payload[:200])
