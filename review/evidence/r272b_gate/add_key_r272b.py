# -*- coding: utf-8 -*-
"""add_key_r272b.py —— 补 R250 类型②：缓存里「从来没有过」的键（miss 日志指定）

WHY：门禁 164/165，唯一失败 `[export-delivery] ❌ FAIL (EBUSY)`，
     `gitcache_miss.log` 明确记 1 条：`node.exe .../tools/check_export_delivery.js`
     ⇒ 该键从未进过缓存（刷新脚本只刷**已有**键，补不上）⇒ preload fail-closed 抛错。

做法：用 NODE_OPTIONS=--require gitcache_preload.js 真跑一次，把 rc/out/err 写回缓存并落盘。
🔴 与跑门禁必须**分成两次调用**（preload 读磁盘）。
"""
import json, os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")

NEW_KEYS = [
    "node.exe C:/Users/lzj/WorkBuddy/Claw/catering-profit/tools/check_export_delivery.js",
]

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

cache = json.load(open(CACHE, encoding="utf-8"))
print("起始键数 =", len(cache))

for k in NEW_KEYS:
    e2 = dict(ENV); e2["NODE_OPTIONS"] = "--require " + PRELOAD
    args = k.split(" ")[1:]
    r = subprocess.run([NODE] + args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=e2)
    cache[k] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    tail = [l for l in (r.stdout or "").splitlines() if "通过" in l]
    print("  rc=%-3s %-56s %s" % (r.returncode, k.split("/")[-1], (tail[-1].strip()[:40] if tail else "")))
    if r.returncode != 0:
        print("   STDERR:", (r.stderr or "")[:400])

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
bad = [k for k in cache if cache[k].get("rc") != 0 and (k.startswith("node.exe ") or k.startswith("git "))]
print("\n最终键数 =", len(cache), "| rc!=0 =", len(bad))
for k in bad[:8]:
    print("  ❌", k[:90])
sys.exit(0 if not bad else 1)
