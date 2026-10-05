# -*- coding: utf-8 -*-
"""mk_git_keys.py —— 用 Python 侧**真跑** git，刷新 gitcache.json 里的 git 类条目。
理由：沙箱下 node 派生任何子进程都 EBUSY，gitcache_preload.js 只能回放缓存；
      仓库文件/提交变了不刷新 ⇒ 假红/假绿。只刷新非 node/python 的键（那些交给 mk_force.py）。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
CACHE = r"C:/Users/lzj/AppData/Local/Temp/inscode/gitcache.json"

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")

cache = json.load(open(CACHE, encoding="utf-8"))
keys = [k for k in cache if not (k.startswith("node.exe ") or k.startswith("python.exe "))]
print("git keys:", len(keys))

for k in keys:
    parts = k.split(" ")
    exe, args = parts[0], parts[1:]
    r = subprocess.run([exe] + args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=120)
    old = cache[k]["rc"]
    cache[k] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    flag = "" if old == r.returncode else f"  <-- rc {old} -> {r.returncode}"
    print(f"  {k}  rc={r.returncode} len(out)={len(r.stdout)}{flag}")

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("written:", CACHE)
