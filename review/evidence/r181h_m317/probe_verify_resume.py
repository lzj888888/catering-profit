# -*- coding: utf-8 -*-
"""核验续做载荷是否入库（逐字长度 + 头尾）+ 本轮模型/通道。"""
import sqlite3, json, os, io, sys

db = os.path.join(os.path.expanduser('~'), '.config', 'inscode', 'inscode.db')
con = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True)
con.row_factory = sqlite3.Row

payload = io.open(r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317/feed_m317_resume.txt',
                  encoding='utf-8').read()
print('本地载荷 len =', len(payload))

row = con.execute('SELECT rowid,updated_at,body,model,provider FROM sessions ORDER BY updated_at DESC LIMIT 1').fetchone()
msgs = json.loads(row['body']).get('messages', [])
U = [m for m in msgs if m.get('role') == 'User']
A = [m for m in msgs if m.get('role') != 'User']
print('session rowid =', row['rowid'], '| model =', row['model'], '| provider =', row['provider'])
print('User =', len(U), '| other =', len(A))
if U:
    t = U[-1].get('text') or ''
    print('末条 User len =', len(t))
    print('  本地去尾换行 len =', len(payload.rstrip('\n')))
    print('  逐字一致 =', t == payload or t == payload.rstrip('\n') or t.rstrip('\n') == payload.rstrip('\n'))
    print('  head =', repr(t[:120]))
    print('  tail =', repr(t[-120:]))
if A:
    t = A[-1].get('text') or A[-1].get('content') or ''
    if not isinstance(t, str):
        t = json.dumps(t, ensure_ascii=False)
    print('末条 Asst len =', len(t), '| head', repr(t[:120]))

print()
print('=== turn_telemetry 最近 2 行 ===')
for r in con.execute('SELECT rowid,* FROM turn_telemetry ORDER BY rowid DESC LIMIT 2'):
    d = dict(r)
    print(json.dumps({k: d.get(k) for k in ('rowid', 'stop_reason', 'model', 'taotoken_plan',
                                            'input_tokens', 'output_tokens', 'duration_ms',
                                            'error_detail', 'error_category')}, ensure_ascii=False))

print()
print('=== inflight_turn ===')
for r in con.execute('SELECT * FROM inflight_turn'):
    d = dict(r)
    d['user_text'] = (d.get('user_text') or '')[:80] + '…'
    print(json.dumps(d, ensure_ascii=False))
