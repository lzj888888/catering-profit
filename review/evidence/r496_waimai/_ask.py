#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""豆包直连（自设超时版）。技能脚本 timeout 写死 300s，长回复偶发超时 ⇒ 本脚本可设 900s。
密钥只从本地 .ark_key 读，绝不落仓。用法：
  python _ask.py <question_file> <out_file> [system_text]
"""
import json, os, sys, urllib.request

API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
ENDPOINT = os.environ.get("ARK_ENDPOINT", "ep-20261011210929-mgqd6")

def read_key():
    for p in (os.environ.get("ARK_API_KEY"),
              "C:/Users/lzj/.workbuddy/.ark_key",
              "C:/Users/lzj/.workbuddy/skills/doubao-bridge/.ark_key"):
        if p and os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                s = f.read().strip()
            if s:
                return s
        elif p:
            return p
    raise SystemExit("no api key")

q = sys.argv[1]
out = sys.argv[2]
system = sys.argv[3] if len(sys.argv) > 3 else ""
with open(q, "r", encoding="utf-8") as f:
    msg = f.read()

messages = []
if system:
    messages.append({"role": "system", "content": system})
messages.append({"role": "user", "content": msg})

body = json.dumps({"model": ENDPOINT, "messages": messages}).encode("utf-8")
req = urllib.request.Request(
    API_URL, data=body,
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + read_key()},
    method="POST",
)
with urllib.request.urlopen(req, timeout=900) as resp:
    data = json.loads(resp.read().decode("utf-8"))

text = data["choices"][0]["message"]["content"]
with open(out, "w", encoding="utf-8") as f:
    f.write(text)
print("===== 豆包回复 =====")
print(text)
print("\n[已写入 %s]" % out)
