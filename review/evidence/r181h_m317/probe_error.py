# -*- coding: utf-8 -*-
"""只读：拿最近一轮 ProviderError 的具体错误细节 + sessions 表结构 + 末条消息。"""
import sqlite3, json, os

db = os.path.join(os.path.expanduser('~'), '.config', 'inscode', 'inscode.db')
con = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True)
con.row_factory = sqlite3.Row

print('=== 最近 3 轮的错误细节 ===')
for r in con.execute('SELECT rowid,* FROM turn_telemetry ORDER BY rowid DESC LIMIT 3'):
    d = dict(r)
    out = {k: d.get(k) for k in (
        'rowid', 'stop_reason', 'model', 'taotoken_plan', 'account_id',
        'error_detail', 'error_http_status', 'error_code', 'error_category',
        'retry_count', 'retry_wasted_ms', 'started_at', 'ended_at', 'duration_ms')}
    print(json.dumps(out, ensure_ascii=False))

print()
print('=== sessions 列 ===')
print([x[1] for x in con.execute('PRAGMA table_info(sessions)')])
print()
for r in con.execute('SELECT rowid,* FROM sessions ORDER BY rowid DESC LIMIT 2'):
    d = dict(r)
    print('--- rowid', d.get('rowid'), '| keys:', list(d.keys()))
    body = None
    for k in ('body', 'data', 'content', 'messages', 'session_data', 'value'):
        if k in d and isinstance(d[k], str) and d[k].strip().startswith('{'):
            body = d[k]; print('  body column =', k, '| len', len(body)); break
    if body:
        try:
            j = json.loads(body)
            msgs = j.get('messages', [])
            U = [m for m in msgs if m.get('role') == 'User']
            A = [m for m in msgs if m.get('role') != 'User']
            print('  total', len(msgs), '| User', len(U), '| other', len(A))
            if U:
                t = U[-1].get('text') or ''
                print('  last User len =', len(t), '| head', repr(t[:70]))
            if A:
                t = A[-1].get('text') or A[-1].get('content') or ''
                if not isinstance(t, str): t = json.dumps(t, ensure_ascii=False)
                print('  last Asst len =', len(t), '| tail', repr(t[-400:]))
        except Exception as e:
            print('  parse err', e)
