# -*- coding: utf-8 -*-
"""只读：看 InsCode 最近若干轮的 stop_reason / 错误 / 会话末条消息。"""
import sqlite3, json, os

db = os.path.join(os.path.expanduser('~'), '.config', 'inscode', 'inscode.db')
con = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True)
con.row_factory = sqlite3.Row

print('=== turn_telemetry 最近 8 行（全列）===')
cols = [r[1] for r in con.execute('PRAGMA table_info(turn_telemetry)')]
print('cols:', cols)
rows = con.execute('SELECT * FROM turn_telemetry ORDER BY rowid DESC LIMIT 8').fetchall()
for r in rows:
    d = dict(r)
    keep = {}
    for k in ('rowid', 'session_id', 'turn_index', 'stop_reason', 'error', 'error_message',
              'model', 'provider', 'input_tokens', 'output_tokens', 'duration_ms',
              'started_at', 'ended_at', 'status', 'finish_reason', 'http_status'):
        if k in d:
            v = d[k]
            if isinstance(v, str) and len(v) > 300:
                v = v[:300] + '…'
            keep[k] = v
    print(json.dumps(keep, ensure_ascii=False))

print()
print('=== sessions 末条 body 的 message 统计 ===')
for r in con.execute('SELECT rowid, session_id, body FROM sessions ORDER BY rowid DESC LIMIT 3'):
    try:
        msgs = json.loads(r['body']).get('messages', [])
    except Exception as e:
        print('parse err', e); continue
    U = [m for m in msgs if m.get('role') == 'User']
    A = [m for m in msgs if m.get('role') != 'User']
    print('session', r['session_id'], '| total', len(msgs), '| User', len(U), '| other', len(A))
    if U:
        t = U[-1].get('text') or U[-1].get('content') or ''
        print('  last User len =', len(t), '| head:', repr(t[:80]))
    if A:
        t = A[-1].get('text') or A[-1].get('content') or ''
        if not isinstance(t, str):
            t = json.dumps(t, ensure_ascii=False)
        print('  last Asst len =', len(t), '| head:', repr(t[:200]))

print()
print('=== approval_audit 最近 6 行 ===')
acols = [x[1] for x in con.execute('PRAGMA table_info(approval_audit)')]
print('cols:', acols)
for r in con.execute('SELECT * FROM approval_audit ORDER BY rowid DESC LIMIT 6'):
    d = dict(r)
    out = {}
    for k, v in d.items():
        if isinstance(v, str) and len(v) > 160:
            v = v[:160] + '…'
        out[k] = v
    print(json.dumps(out, ensure_ascii=False))
