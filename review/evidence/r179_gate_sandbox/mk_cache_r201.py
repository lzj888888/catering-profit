# -*- coding: utf-8 -*-
"""mk_cache_r201.py —— 增量补 gitcache：每跑完一条立刻落盘，避免长跑被 SIGTERM 全盘丢失。
只补 miss 名单里 cache 没有的键（不覆盖别人已跑好的）= gate-under-sandbox 坑④ 的正确顺序。
支持分片：argv[1]=起始序号 argv[2]=条数。
"""
import json, os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

CACHE_PATH = os.path.join(TMP, "gitcache.json")
cache = json.load(open(CACHE_PATH, encoding="utf-8"))

miss, seen = [], set()
p = os.path.join(TMP, "gitcache_miss.log")
if os.path.exists(p):
    for ln in open(p, encoding="utf-8"):
        k = ln.strip()
        if k and k not in seen:
            seen.add(k); miss.append(k)
todo = [k for k in miss if k not in cache]

start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
count = int(sys.argv[2]) if len(sys.argv) > 2 else 12
chunk = todo[start:start + count]
print(f"todo={len(todo)} slice=[{start}:{start + len(chunk)}]", flush=True)


def exe_of(base):
    return NODE if base == "node.exe" else PY if base == "python.exe" else base


for i, k in enumerate(chunk):
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
                               encoding="utf-8", errors="replace", env=ENV, timeout=200)
        except Exception:
            continue
        best = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        if r.returncode == 0:
            break
    if best is None:
        best = {"rc": 127, "out": "", "err": "cannot run"}
    cache[k] = best
    # 关键：每条立刻落盘
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    print(f"[{start + i + 1}/{len(todo)}] rc={best['rc']} lines={len(best['out'].splitlines())} {os.path.basename(script or k)[:52]}", flush=True)

print(f"DONE cache={len(cache)}", flush=True)
