# -*- coding: utf-8 -*-
"""投喂前余额探针：pros[0].api_key + /v1 + deepseek-v4-pro，max_tokens=1。
200 = 可投；429 insufficient_quota = 欠费。只读，不泄露 key。"""
import json, os, urllib.request

P = os.path.expanduser(r"~\AppData\Roaming\com.inscode.app\taotoken.json")
if not os.path.exists(P):
    for c in [r"C:\Users\lzj\.config\inscode\taotoken.json",
              os.path.expanduser(r"~\AppData\Roaming\inscode\taotoken.json")]:
        if os.path.exists(c):
            P = c
            break
print("taotoken.json =", P, "exists =", os.path.exists(P))

tab = json.load(open(P, encoding="utf-8"))
pros = tab.get("pros")
if isinstance(pros, list):
    key = pros[0].get("api_key")
    print("pool = pros[0] (余额/按量)")
else:
    key = (pros or {}).get("api_key")
    print("pool = pros (obj)")
print("key len =", len(key or ""))

url = "https://api.taotoken.net/v1/chat/completions"
body = json.dumps({
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 1,
}).encode()
req = urllib.request.Request(url, data=body, headers={
    "Authorization": "Bearer " + key, "Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=40)
    print("HTTP", r.status, "=> PROBE-OK 可投")
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read()[:300].decode("utf-8", "ignore"))
except Exception as e:
    print("ERR", type(e).__name__, e)
