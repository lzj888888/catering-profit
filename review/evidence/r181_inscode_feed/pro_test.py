import json, urllib.request, urllib.error

t = json.load(open(r'C:/Users/lzj/.config/inscode/taotoken.json', encoding='utf-8'))
pro = t['pros'][0]
key = pro['api_key']
free_key = t['free']['api_key']

BASES = [
    'https://api.taotoken.net/v1',
    'https://api.taotoken.net/coding/v1',
    'https://api.taotoken.net/pro/v1',
]
MODELS = ['deepseek-v4-pro', 'glm-5.3', 'qwen3.7-max', 'deepseek-v4-flash']


def call(base, key, model):
    url = base + '/chat/completions'
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'ping'}],
                       'max_tokens': 16}).encode()
    req = urllib.request.Request(url, data=body, headers={
        'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=45)
        return r.status, r.read().decode()[:220]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]
    except Exception as e:
        return 'ERR', str(e)[:200]


print('=== PRO KEY 直连探测 (充值后) ===')
for base in BASES:
    for m in MODELS[:2]:
        s, b = call(base, key, m)
        print(f'[{base}] {m:18s} -> {s} {b[:150]}')
    print()

print('=== FREE KEY 对照 ===')
s, b = call('https://api.taotoken.net/coding/v1', free_key, 'deepseek-v4-flash')
print('free/deepseek-v4-flash ->', s, b[:150])

print()
print('=== 余额查询端点探测 ===')
for path in ['https://api.taotoken.net/v1/user/balance',
             'https://api.taotoken.net/v1/balance',
             'https://api.taotoken.net/v1/me',
             'https://api.taotoken.net/v1/models']:
    try:
        req = urllib.request.Request(path, headers={'Authorization': 'Bearer ' + key})
        r = urllib.request.urlopen(req, timeout=30)
        txt = r.read().decode()
        print(path, '->', r.status, txt[:400])
    except urllib.error.HTTPError as e:
        print(path, '->', e.code, e.read().decode()[:200])
    except Exception as e:
        print(path, '-> ERR', str(e)[:120])
