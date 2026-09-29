# -*- coding: utf-8 -*-
"""check_timeout.py —— 真云回读 42 个云函数的 timeout（只读，不改任何东西）。
用法：python check_timeout.py
判据：cli 输出表里每行的 timeout 列 == R86 定值表。
"""
import json, os, re, subprocess, sys

REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
CLI = r"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
ENV_ID = "cloud1-d4gphpoxy337f2a25"

d = json.load(open(os.path.join(REPO, "review/evidence/r86_final_20260919/final_readback.json"), encoding="utf-8"))
names = list(d.keys())
expect = {k: v["expect"] for k, v in d.items()}
print(f"函数数 = {len(names)}")

cmd = [CLI, "cloud", "functions", "info", "--project", REPO, "-e", ENV_ID, "--names", ",".join(names)]
r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                   timeout=400, shell=False)
out = (r.stdout or "") + "\n" + (r.stderr or "")
print("rc =", r.returncode)
print(out[:6000])
open(r"C:/Users/lzj/AppData/Local/Temp/inscode/timeout_readback_raw.txt", "w", encoding="utf-8").write(out)

# 解析表格行：│ name │ 'Active' │ 20 │ 'Nodejs16.13' │
got = {}
for ln in out.splitlines():
    m = re.match(r"^\s*[│|]\s*([A-Za-z][A-Za-z0-9_]*)\s*[│|]\s*'?(\w+)'?\s*[│|]\s*(\d+)\s*[│|]", ln)
    if m:
        got[m.group(1)] = int(m.group(3))
print("\n解析到", len(got), "行")
bad = [(k, expect[k], got.get(k)) for k in expect if got.get(k) != expect[k]]
if not got:
    print("!! 未解析到任何行 —— 看上面原始输出")
else:
    print("与 R86 定值表不一致的：", bad if bad else "无（42/42 一致）")
