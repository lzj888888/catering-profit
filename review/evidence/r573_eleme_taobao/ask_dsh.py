# -*- coding: utf-8 -*-
"""
DeepSeek 直连问询（本机 key 取自 ~/.dsh/.credentials.yaml，不落仓、不进 git）
用法: python review/evidence/r573_eleme_taobao/ask_dsh.py <prompt.md> <out.md>
"""
import json, sys, time, io, os, re
import urllib.request

prompt_path = sys.argv[1]
out_path = sys.argv[2]

CRED = os.path.expanduser("~/.dsh/.credentials.yaml")
txt = io.open(CRED, encoding="utf-8").read()
m = re.search(r"DEEPSEEK_API_KEY:\s*(\S+)", txt)
if not m:
    print("ERR: no DEEPSEEK_API_KEY found in", CRED)
    sys.exit(1)
key = m.group(1).strip()

with io.open(prompt_path, encoding="utf-8") as f:
    content = f.read()

system = ("你是 DeepSeek，扮演餐饮连锁财务顾问 + 严谨的成本会计。"
          "务实、抠口径、能被审计。每条必须标注确定度【确定】【大概率】【不确定】【不知道】，"
          "不知道就写不知道，不许编。不写代码。每条回答控制在 5 行以内。")

body = json.dumps({
    "model": "deepseek-chat",
    "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": content},
    ],
    "temperature": 0.3,
    "max_tokens": 2000,
    "stream": False,
}).encode("utf-8")

req = urllib.request.Request(
    "https://api.deepseek.com/chat/completions",
    data=body,
    headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
)
t0 = time.time()
try:
    r = urllib.request.urlopen(req, timeout=600)
    data = json.loads(r.read().decode("utf-8"))
    out = data["choices"][0]["message"]["content"]
    with io.open(out_path, "w", encoding="utf-8", newline="") as o:
        o.write(out)
    print("OK", round(time.time() - t0, 1), "s,", len(out), "chars ->", out_path)
except Exception as e:
    print("ERR", type(e).__name__, str(e)[:400], round(time.time() - t0, 1), "s")
    sys.exit(1)
