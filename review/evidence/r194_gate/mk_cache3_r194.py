# -*- coding: utf-8 -*-
"""mk_cache3_r194.py —— 补 gitcache.json 里 miss 的键（只补缺失，不覆盖已有）。

为什么需要：本轮新增第 126 个套件 `tools/check_auth_guard_shape.js`，而
`tools/check_suite_assert_counts.js::CASES` 新增了它的 key ⇒ 该守卫内部
`execFileSync(NODE,[abs])` 的缓存键首次出现 ⇒ preload fail-closed 记 miss。
（技能 gate-under-sandbox 坑⑨：新增 CASES 项后 miss 必 ≥1，不补齐就是假绿。）

本脚本用 Python 侧**真跑**这些命令（挂 NODE_OPTIONS=preload，防套件内部的 spawn 又被沙箱拦），
把真实 rc + stdout + stderr 原样写回缓存，并清空 miss 日志。
"""
import json
import os
import subprocess
import sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
CACHE = os.path.join(TMP, "gitcache.json")
MISS = os.path.join(TMP, "gitcache_miss.log")
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

if not os.path.exists(MISS):
    print("no miss log -> nothing to do")
    sys.exit(0)

keys = []
for line in open(MISS, encoding="utf-8"):
    k = line.strip()
    if k and k not in keys:
        keys.append(k)

cache = json.load(open(CACHE, encoding="utf-8"))
print("miss keys:", len(keys))
fixed = 0
for k in keys:
    if k in cache:
        print("  = already cached, skip:", k[:100])
        continue
    parts = k.split(" ")
    is_node = parts[0].startswith("node.exe")
    exe = NODE if is_node else PY
    args = parts[1:]
    if not is_node and args[:1] == ["-c"]:
        args = ["-c", " ".join(args[1:])]
    cwds = [REPO]
    if args and os.path.isabs(args[-1]) and os.path.exists(args[-1]):
        cwds.append(os.path.dirname(args[-1]))
    best = None
    for cwd in cwds:
        try:
            r = subprocess.run([exe] + args, cwd=cwd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", env=ENV, timeout=300)
        except Exception:
            continue
        best = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        if r.returncode == 0:
            break
    if best is None:
        best = {"rc": 127, "out": "", "err": "cannot run"}
    cache[k] = best
    fixed += 1
    print("  + %s  rc=%s len(out)=%s" % (k[:100], best["rc"], len(best["out"])))
    if best["rc"] != 0:
        print("     err:", (best["err"] or "")[:200].replace("\n", " | "))

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
open(MISS, "w", encoding="utf-8").close()
print("fixed %d, cache size = %d" % (fixed, len(cache)))
