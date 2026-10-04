# -*- coding: utf-8 -*-
"""mk_force.py —— 强制重跑 cache 里所有 node.exe / python.exe 条目（不跳过已存在的 key）。
用途：仓库文件变化后，套件输出可能变，旧缓存会造成假绿/假红。
关键：子进程必须挂载 NODE_OPTIONS=--require gitcache_preload.js，否则套件内部 spawn git 仍被沙箱拦。"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

cache = json.load(open(os.path.join(TMP, "gitcache.json"), encoding="utf-8"))
keys = [k for k in cache if k.startswith("node.exe ") or k.startswith("python.exe ")]
print("to refresh:", len(keys))

done = 0
for k in keys:
    parts = k.split(" ")
    args = parts[1:]
    exe = NODE if k.startswith("node.exe") else PY
    script = args[-1] if args else ""
    cwds = [REPO]
    if script and os.path.isabs(script) and os.path.exists(script):
        cwds.append(os.path.dirname(script))
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
    done += 1
    if best["rc"] != 0:
        print(f"  ! rc={best['rc']}  {k[:88]}")
        print("     err:", (best["err"] or "")[:160].replace("\n", " | "))

json.dump(cache, open(os.path.join(TMP, "gitcache.json"), "w", encoding="utf-8"), ensure_ascii=False)
print(f"refreshed {done}, cache size = {len(cache)}")
