# -*- coding: utf-8 -*-
"""验投喂：读 ins code.db 末条 User 消息长度 + 与载荷逐字比对；并读遥测 stop_reason / model。"""
import sqlite3, json, io, sys

PAYLOAD = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181j_m319_m321_feed/feed_e.txt'
payload = io.open(PAYLOAD, encoding='utf-8').read()
print('payload chars =', len(payload), flush=True)

con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
try:
    infl = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
    print('inflight rows =', infl, flush=True)
    row = con.execute('SELECT id, body, model, provider FROM sessions ORDER BY updated_at DESC LIMIT 1').fetchone()
    sid, body, model, provider = row
    msgs = json.loads(body).get('messages', []) if body else []
    U = [m for m in msgs if m.get('role') == 'User']
    A = [m for m in msgs if m.get('role') == 'Assistant' and (m.get('text') or '').strip()]
    print('session id =', sid, '| model =', model, '| provider =', provider, flush=True)
    print('User count =', len(U), '| Assistant(non-empty) =', len(A), flush=True)
    last = (U[-1].get('text') or '') if U else ''
    print('last User chars =', len(last), flush=True)
    print('EXACT-MATCH =', last == payload, flush=True)
    print('HEAD:', repr(last[:60]), flush=True)
    print('TAIL:', repr(last[-80:]), flush=True)
finally:
    con.close()

try:
    con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
    cur = con.execute('SELECT * FROM turn_telemetry ORDER BY rowid DESC LIMIT 1')
    cols = [d[0] for d in cur.description]
    r = cur.fetchone()
    keep = ('model', 'rounds', 'stop_reason', 'error_category', 'error_http_status', 'provider_host', 'taotoken_plan')
    print('telemetry:', {c: r[i] for i, c in enumerate(cols) if c in keep}, flush=True)
    con.close()
except Exception as e:
    print('telemetry err:', e, flush=True)
