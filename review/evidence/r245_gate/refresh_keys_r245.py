# -*- coding: utf-8 -*-
"""R245 · 增量刷新 gitcache 里 P1 影响的两个键（改自 r238_guide/refresh_cache_keys.py）。

本轮真变过的套件：
  tools/selftest_bill_parse.js      : 15 → 20 条（加 P1 京东串味回归 5 条）
  tools/check_suite_assert_counts.js: 上面那个的声明同步（它自己的输出也变）

🔴 顺序有意义：先刷被 spawn 的子套件，再刷读它的守卫。
🔴 每轮 dump 落盘（坑⑥-ter：同进程内子进程只读磁盘上的值）。
"""
import json
import os
import subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r245_gate/gitcache_r245.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD


def run_key(key):
    parts = key.split(" ")
    argv = [NODE] + parts[1:]
    r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=600)
    return {"rc": r.returncode, "out": r.stdout, "err": r.stderr}


def main():
    assert os.path.exists(PRELOAD), "缺 preload: " + PRELOAD
    cache = json.load(open(CACHE, encoding="utf-8"))
    print("刷新前 keys =", len(cache))

    for name in ["selftest_bill_parse.js", "check_suite_assert_counts.js"]:
        keys = [k for k in cache if k.startswith("node.exe") and k.endswith(name)]
        if not keys:
            print("  ⚠️ 无该键：", name); continue
        for k in keys:
            old_rc = cache[k].get("rc")
            new = run_key(k)
            cache[k] = new
            extra = ""
            if name == "selftest_bill_parse.js":
                for ln in new["out"].splitlines():
                    if "自测结果" in ln:
                        extra = "  " + ln.strip()
            print("  %-32s rc %s → %s%s" % (name, old_rc, new["rc"], extra))
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False)
    bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
    print("刷新后 keys =", len(cache), "| rc!=0 =", len(bad))
    for k in bad:
        print("   ! rc=%s %s" % (cache[k]["rc"], k[:120]))
    print("已写回:", CACHE)


main()
