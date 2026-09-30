import json, io, urllib.request, urllib.error

CFG = r'C:\Users\lzj\.config\inscode\taotoken.json'
d = json.load(io.open(CFG, encoding='utf-8'))
print('顶层键 =', list(d.keys()))
pros = d.get('pros') or []
print('pros 条数 =', len(pros))
if pros:
    p0 = pros[0]
    print('pros[0] 键 =', list(p0.keys()))
    key = p0.get('api_key')
else:
    key = None
print('pro key 前 12 =', (key or '')[:12])

BASE = 'https://api.taotoken.net/v1'


def call(path, body=None, method='GET'):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Authorization', 'Bearer ' + (key or ''))
    req.add_header('Content-Type', 'application/json')
    data = json.dumps(body).encode() if body else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=40) as r:
            return r.status, r.read(4000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read(700).decode('utf-8', 'replace')
    except Exception as e:
        return -1, '%s: %s' % (type(e).__name__, e)


st, tx = call('/models')
print('--- GET /models ->', st)
if st == 200:
    try:
        ids = [m['id'] for m in json.loads(tx)['data']]
        print('模型数 =', len(ids))
        for want in ('deepseek-v4-pro', 'doubao-seed-2.1-pro', 'glm-5.3', 'kimi-k3'):
            print('   含 %-22s %s' % (want, want in ids))
    except Exception as e:
        print('parse err', e, tx[:200])
else:
    print(tx[:300])

print('--- 实测 deepseek-v4-pro 最小请求 ---')
st, tx = call('/chat/completions', {'model': 'deepseek-v4-pro',
                                    'messages': [{'role': 'user', 'content': 'hi'}],
                                    'max_tokens': 5}, 'POST')
print('status =', st)
print(tx[:600])
