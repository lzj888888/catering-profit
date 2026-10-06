# -*- coding: utf-8 -*-
"""add_key_r233.py —— 为新套件补一条 node 缓存键（真跑、真录，不伪造）。
`check_suite_assert_counts` 内部用 process.execPath 实跑每个 CASES 套件 ⇒ 新套件必须先在缓存里。"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

NEW_ABS = os.path.join(REPO, "tools", "check_fn_deps.js").replace("\\", "/")
key = "node.exe " + NEW_ABS

cache = json.load(open(os.path.join(TMP, "gitcache.json"), encoding="utf-8"))
r = subprocess.run([NODE, NEW_ABS], cwd=REPO, capture_output=True, text=True,
                   encoding="utf-8", errors="replace", env=ENV, timeout=300)
cache[key] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
json.dump(cache, open(os.path.join(TMP, "gitcache.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("added key:", key, "-> rc =", r.returncode)
print("tail:", (r.stdout or "").strip().splitlines()[-1] if r.stdout else "(empty)")
