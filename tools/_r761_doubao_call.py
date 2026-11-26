#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# R761：代金券「限用几张」口径评审（复用 R605 已验证的豆包直连参数）
import json, urllib.request, urllib.error

KEY = open("C:/Users/lzj/.workbuddy/.ark_key", "r", encoding="utf-8").read().strip()
ENDPOINT = "ep-20261011210929-mgqd6"
PROMPT_FILE = "review/evidence/r761_doubao_prompt.md"
OUT = "review/evidence/r761_doubao_reply.md"

msg = open(PROMPT_FILE, "r", encoding="utf-8").read()
body = json.dumps({
    "model": ENDPOINT,
    "messages": [{"role": "user", "content": msg}],
    "temperature": 0.3,
    "max_tokens": 700,
}).encode("utf-8")
req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    data=body,
    headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=280) as r:
        data = json.loads(r.read().decode("utf-8"))
    reply = data["choices"][0]["message"]["content"]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(reply)
    print("OK bytes=", len(reply))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode("utf-8", "replace")[:500])
except Exception as e:
    print("ERR", repr(e))
