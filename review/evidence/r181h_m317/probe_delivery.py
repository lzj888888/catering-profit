# -*- coding: utf-8 -*-
"""投喂送达核验：末条 User 文本长度/首行，与载荷逐字比对；并读 turn_telemetry 的 model/stop_reason。"""
import sqlite3, json, os

PAY = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317/feed_m317.txt'
payload = open(PAY, encoding='utf-8').read()
print('payload chars =', len(payload))

con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
con.row_factory = sqlite3.Row
infl = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
print('inflight_turn rows =', infl)

cols = [d[1] for d in con.execute('PRAGMA table_info(sessions)').fetchall()]
print('sessions cols =', cols)
row = con.execute('SELECT rowid,body FROM sessions ORDER BY rowid DESC LIMIT 1').fetchone()
msgs = json.loads(row['body']).get('messages', [])
U = [m for m in msgs if m.get('role') == 'User']
print('session rowid =', row['rowid'], '| User msgs =', len(U), '| Assistant =',
      len([m for m in msgs if m.get('role') == 'Assistant' and (m.get('text') or '').strip()]))
last = (U[-1].get('text') or '')
print('last User len =', len(last))
print('len match payload =', len(last) == len(payload))
print('exact match      =', last == payload)
print('head =', last[:60].replace('\n', ' / '))
print('tail =', last[-60:].replace('\n', ' / '))

try:
    cur = con.execute('SELECT * FROM turn_telemetry ORDER BY rowid DESC LIMIT 2')
    names = [d[0] for d in cur.description]
    for r in cur.fetchall():
        d = dict(zip(names, r))
        keep = {k: d[k] for k in ('model', 'stop_reason', 'error_http_status', 'taotoken_plan',
                                  'provider_host', 'rounds', 'tool_call_count') if k in d}
        print('turn_telemetry:', keep)
except Exception as e:
    print('telemetry err', e)
con.close()
