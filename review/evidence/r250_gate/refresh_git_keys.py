# -*- coding: utf-8 -*-
"""refresh_git_keys.py —— R250：`git add` 之后刷新 **git 类**缓存键

WHY：`git ls-files` / `git status --porcelain …` 也是 gitcache 的键，而门禁里若干守卫
     （R92 套件入库、面 B 扫描面、common 同步面等）**读的就是它们**。
     若 `git add` 了新文件而不刷这几个键 ⇒ 守卫读到的是**添加前**的旧列表 ⇒
     要么漏判（新文件看不见）、要么与当前树脱节（同 R249 的「README 改在门禁之后」教训）。
     ⇒ 纪律：**先 `git add` → 刷 git 键 → 再跑门禁 → 最后 commit**。

🔴 顺序：git 类不用 preload（直跑真 git）⇒ 一次落盘即可。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r250_gate/gitcache_rebuilt.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
# 🔴 直跑真 git ⇒ **不注入** NODE_OPTIONS preload
ENV.pop("NODE_OPTIONS", None)

cache = json.load(open(CACHE, encoding="utf-8"))
targets = [k for k in cache if k.startswith("git")]
print("git 类键 =", len(targets))
for k in targets:
    parts = k.split(" ")
    argv = ["git"] + parts[1:]
    try:
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=120)
        old = cache[k].get("rc")
        cache[k] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        nl = len([x for x in r.stdout.splitlines() if x.strip()])
        print("  key=%-42s rc %s→%s  out.lines=%d" % (" ".join(parts[:4]), old, r.returncode, nl))
    except Exception as e:
        print("  ! skip", k, e)

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False)
bad = [k for k, v in cache.items() if v["rc"] != 0]
print("FINAL keys = %d | rc!=0 = %d" % (len(cache), len(bad)))
for k in bad:
    print("   ! rc=%s %s" % (cache[k]["rc"], k[:110]))
