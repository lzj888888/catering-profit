# -*- coding: utf-8 -*-
"""mk_cache_fix201.py —— 强制覆盖指定的 gitcache 键（真跑，且带上 preload 让内层 git/python 命中缓存）。
用途：mk_cache_r201.py 首次补的键是在**沙箱里**跑的，rc=1 是 EBUSY 假红；
     preload 会忠实回放 ⇒ 必须用「带 preload 的真跑」覆盖成真值。
argv = 脚本路径列表
"""
import json, os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
CACHE_PATH = os.path.join(TMP, "gitcache.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

cache = json.load(open(CACHE_PATH, encoding="utf-8"))
for rel in sys.argv[1:]:
    fp = rel if os.path.isabs(rel) else os.path.join(REPO, rel)
    key = "node.exe " + fp.replace("\\", "/")
    r = subprocess.run([NODE, fp], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=300)
    cache[key] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    tail = [l for l in r.stdout.strip().splitlines() if l.strip()][-1:] or ["(no output)"]
    print(f"rc={r.returncode}  {os.path.basename(fp):<34} {tail[0][:90]}", flush=True)
print("cache =", len(cache), flush=True)
