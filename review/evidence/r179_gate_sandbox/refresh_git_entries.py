# -*- coding: utf-8 -*-
"""refresh_git_entries.py —— 只刷新缓存里的 **git 条目**，保留 node/python 套件缓存。

为什么需要它（R585 实测）：
  门禁在沙箱下跑，node 派生子进程被拦 ⇒ 所有 git 输出都来自 `gitcache.json` 缓存。
  `mk_force.py` 只重跑 `node.exe` / `python.exe` 开头的条目，**从不刷 git 条目**；
  而 `mk_cache2.py` 是 `cache = {}` 整体重建（会清掉 177+ 条 node 缓存，代价太大）。
  ⇒ 一旦 git 跟踪的文件集合变了（新增/删除/重命名），`git ls-files` 的旧缓存就与事实不符：
     · `check_suite_coverage` 的 S7 会把"已登记豁免、但新文件还没进旧缓存"判成**僵尸条目** ⇒ 假红；
     · 反向也会假绿（新判据不在扫描面 ⇒ "零漏网"）。
  这是「改过 tools/** 先刷缓存」那条纪律**没覆盖到**的一格。

用法：python review/evidence/r179_gate_sandbox/refresh_git_entries.py
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
CACHE = os.path.join(TMP, "gitcache.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:/Program Files/Git/bin", r"C:/Program Files/Git/cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

CMDS = [
    ["git", "ls-files"],
    ["git", "-c", "core.quotepath=false", "ls-files"],
    ["git", "status", "--porcelain", "cloudfunctions/"],
    ["git", "status", "--porcelain"],
    ["git", "rev-parse", "--is-inside-work-tree"],
    ["git", "log", "--oneline", "-8"],
]

cache = json.load(open(CACHE, encoding="utf-8"))
before = len(cache)
norm = lambda s: s.replace("\\", "/")

for argv in CMDS:
    key = os.path.basename(argv[0]).lower() + " " + " ".join(norm(a) for a in argv[1:])
    try:
        p = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=120)
        # 🔴 字段名必须是 out/err —— preload 读的是 r.out / r.err（写 stdout/stderr 会读成 undefined，
        #   表现为 "Cannot read properties of undefined (reading 'split')"，很难一眼看出是键名错）
        cache[key] = {"rc": p.returncode, "out": p.stdout, "err": p.stderr}
        print("refreshed %-46s rc=%d stdout=%d chars" % (key[:46], p.returncode, len(p.stdout)))
    except Exception as e:
        print("FAILED %s: %s" % (key, e))

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
print("\ncache entries: %d -> %d（node/python 缓存未动）" % (before, len(cache)))
