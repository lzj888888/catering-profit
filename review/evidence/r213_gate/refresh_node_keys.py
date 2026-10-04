# -*- coding: utf-8 -*-
"""refresh_node_keys.py —— 只刷新 gitcache 里**受影响脚本**的 node.exe 键。

WHY：mk_git_keys.py 明确跳过 node.exe / python.exe 开头的键（交给 mk_force.py），
而 check_suite_assert_counts.js 用 process.execPath 实跑子套件 ⇒ 键形如 `node.exe <abs>`，
若不刷新就会拿**旧输出**比对 ⇒ 假红（本轮实测：A2-check_paywall_coverage 声明 17 ≠ 实跑 13）。
mk_force.py 是"全刷"（慢）；本脚本按脚本名过滤精准刷，结果等价、可复现。
"""
import json
import os
import subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")

FILTER = ['check_paywall_coverage', 'check_entitlement_flow', 'check_rate_limit_params',
          'selftest_r85', 'check_suite_coverage', 'check_suite_assert_counts', 'check_fn_selftest_counts']

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

CACHE = os.path.join(TMP, "gitcache.json")
cache = json.load(open(CACHE, encoding="utf-8"))
keys = [k for k in cache
        if (k.startswith("node.exe ") or k.startswith("python.exe "))
        and any(f in k for f in FILTER)]
print("to refresh:", len(keys))
for k in keys:
    args = k.split(" ")[1:]
    exe = NODE if k.startswith("node.exe") else PY
    try:
        r = subprocess.run([exe] + args, cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=300)
        cache[k] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        print("  rc=%d  %s" % (r.returncode, k[:110]))
    except Exception as e:
        print("  ! skip %s :: %s" % (k[:80], e))

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
print("written")
