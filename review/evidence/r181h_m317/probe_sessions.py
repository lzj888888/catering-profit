# -*- coding: utf-8 -*-
"""只读：列出全部 session 快照 + 找出 M3.17 载荷所在轮次 + 最后一条助手输出。"""
import sqlite3, json, os, time

db = os.path.join(os.path.expanduser('~'), '.config', 'inscode', 'inscode.db')
con = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True)
con.row_factory = sqlite3.Row

print('=== 全部 sessions 快照（按 updated_at DESC）===')
for r in con.execute('SELECT rowid,* FROM sessions ORDER BY updated_at DESC'):
    d = dict(r)
    body = d.get('body') or ''
    msgs = []
    try:
        msgs = json.loads(body).get('messages', [])
    except Exception:
        pass
    U = [m for m in msgs if m.get('role') == 'User']
    A = [m for m in msgs if m.get('role') != 'User']
    lu = (U[-1].get('text') or '') if U else ''
    la = ''
    if A:
        t = A[-1].get('text') or A[-1].get('content') or ''
        la = t if isinstance(t, str) else json.dumps(t, ensure_ascii=False)
    print('--- rowid %s | id %s' % (d.get('rowid'), str(d.get('id'))[:36]))
    print('    dir=%s | msgs=%s | model=%s | provider=%s' % (
        d.get('working_dir'), d.get('message_count'), d.get('model'), d.get('provider')))
    print('    updated_at=%s | parsed total=%d User=%d other=%d' % (d.get('updated_at'), len(msgs), len(U), len(A)))
    print('    lastUser  len=%d | %r' % (len(lu), lu[:90]))
    print('    lastAsst  len=%d | tail %r' % (len(la), la[-300:]))

print()
print('=== 目标：len≈4204 的 M3.17 载荷是否在库 ===')
hit = 0
for r in con.execute('SELECT rowid, body FROM sessions'):
    body = r['body'] or ''
    if 'M3.17' in body or '外卖单均' in body:
        hit += 1
        print('rowid', r['rowid'], '含 M3.17/外卖单均 字样，body len', len(body))
if not hit:
    print('!! 未命中：M3.17 载荷不在任何 session body 中')

print()
print('=== store_meta ===')
for r in con.execute('SELECT * FROM store_meta'):
    print(dict(r))
