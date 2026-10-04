# -*- coding: utf-8 -*-
"""mk_cache3.py —— 读取 gitcache_miss.log，把上一轮未命中的命令用 Python 侧真跑补齐进缓存。
cwd 策略：先仓根；rc≠0 则改用脚本所在目录再跑一次（云函数 selftest 两类都有）。"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

cache = json.load(open(os.path.join(TMP, "gitcache.json"), encoding="utf-8"))
miss = []
seen = set()
p = os.path.join(TMP, "gitcache_miss.log")
if os.path.exists(p):
    for ln in open(p, encoding="utf-8"):
        k = ln.strip()
        if k and k not in seen:
            seen.add(k); miss.append(k)

def exe_of(base):
    return NODE if base == "node.exe" else PY if base == "python.exe" else base

added = 0
for k in miss:
    if k in cache:
        continue
    parts = k.split(" ")
    base, args = parts[0], parts[1:]
    exe = exe_of(base)
    script = args[-1] if args else ""
    cwds = [REPO]
    if script and os.path.isabs(script) and os.path.exists(script):
        cwds.append(os.path.dirname(script))
    best = None
    for cwd in cwds:
        try:
            r = subprocess.run([exe] + args, cwd=cwd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", env=ENV, timeout=240)
        except Exception as e:
            continue
        best = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        if r.returncode == 0:
            break
    if best is None:
        best = {"rc": 127, "out": "", "err": "cannot run"}
    cache[k] = best
    added += 1
    print(f"+ {k[:78]:<80} rc={best['rc']} lines={len(best['out'].splitlines())}")

json.dump(cache, open(os.path.join(TMP, "gitcache.json"), "w", encoding="utf-8"), ensure_ascii=False)
print(f"\nadded {added}, cache size = {len(cache)}")
