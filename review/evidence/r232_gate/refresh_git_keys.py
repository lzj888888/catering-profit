# -*- coding: utf-8 -*-
"""refresh_git_keys.py —— 健壮版刷 git 类缓存键（跳过首 token 不是可执行文件的键）"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
CACHE = r"C:/Users/lzj/AppData/Local/Temp/inscode/gitcache.json"
ENV = dict(os.environ)
ENV["PATH"] = (r"C:\Program Files\Git\bin" + os.pathsep + r"C:\Program Files\Git\cmd"
               + os.pathsep + ENV.get("PATH", ""))

cache = json.load(open(CACHE, encoding="utf-8"))
keys = [k for k in cache if not (k.startswith("node.exe ") or k.startswith("python.exe "))]
print("git-ish keys:", len(keys), "->", keys)
for k in keys:
    parts = k.split(" ")
    exe, args = parts[0], parts[1:]
    try:
        r = subprocess.run([exe] + args, cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=120)
        cache[k] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        print("  OK  %-52s rc=%s len(out)=%d" % (k, r.returncode, len(r.stdout)))
    except Exception as e:
        print("  SKIP %-50s %s %s" % (k, type(e).__name__, str(e)[:60]))
json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("written:", CACHE)
