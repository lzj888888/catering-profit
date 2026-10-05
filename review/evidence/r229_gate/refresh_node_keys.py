# -*- coding: utf-8 -*-
"""r229_refresh.py —— 按脚本名精准刷 node/python 键（技能 ⑥-bis），落盘供下一次调用读"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

# 本轮改动的脚本名（含被改动文件影响的套件）
FILTER = ["selftest_ad_gates", "check_m2_ref_not_prefill", "check_stale_claims",
          "check_suite_assert_counts", "check_page_manifest", "check_terms_forbidden"]

CACHE = os.path.join(TMP, "gitcache.json")
cache = json.load(open(CACHE, encoding="utf-8"))
keys = [k for k in cache
        if (k.startswith("node.exe ") or k.startswith("python.exe "))
        and any(f in k for f in FILTER)]
print("to refresh:", len(keys))
for k in keys:
    parts = k.split(" ")
    exe = NODE if k.startswith("node.exe") else PY
    args = parts[1:]
    best = None
    for cwd in [REPO] + ([os.path.dirname(args[-1])] if args and os.path.isabs(args[-1]) and os.path.exists(args[-1]) else []):
        try:
            r = subprocess.run([exe] + args, cwd=cwd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", env=ENV, timeout=300)
        except Exception as e:
            continue
        best = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        if r.returncode == 0:
            break
    if best is None:
        best = {"rc": 127, "out": "", "err": "cannot run"}
    old = cache[k]["rc"]
    cache[k] = best
    flag = "" if old == best["rc"] else "  <-- rc %s -> %s" % (old, best["rc"])
    print("  %s  rc=%s%s" % (k[:100], best["rc"], flag))

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("written:", CACHE)
