# -*- coding: utf-8 -*-
"""R245 第二批 · 增量刷新 gitcache 里受 P2~P8 影响的 node 套件键（改自 refresh_keys_r245.py）。

🔴 为什么必须刷：沙箱下 node 派生子进程全 EBUSY ⇒ `gitcache_preload.js` 回放**缓存里的旧输出**。
   本批改了 `utils/gradeGate.js` / `cloudfunctions/importSalesBill/service.js` / `validate.js`
   以及 4 个 tools 套件本身 ⇒ 不刷新就会出现「单独跑绿、门禁里红」或更糟的**缓存假绿**。

🔴 顺序有意义：先刷被 spawn 的子套件，最后刷读它们的 `check_suite_assert_counts.js`。
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
ARCH = os.path.join(REPO, "review/evidence/r245_gate/gitcache_r245b.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

# 顺序：子套件在前，读取它们的守卫在后
NAMES = [
    "selftest_bill_parse.js",        # 37 → 39
    "check_formc_shape.js",          # 15 → 21
    "check_formc_parse.js",          # 16 → 27
    "check_grade_gate_dual.js",      # A-③ detail 行含 enum，输出变了
    "check_m333_parse.js",           # require service.js（保守刷新）
    "check_shape_machine_value.js",  # require service.js（保守刷新）
    "selftest_grade_gate.js",        # require utils/gradeGate.js（保守刷新）
    "check_excel_date_utc.js",       # require service.js（保守刷新）
    "check_suite_assert_counts.js",  # 🔴 必须最后（它 spawn 上面这些）
]


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

    for name in NAMES:
        keys = [k for k in cache if k.startswith("node.exe") and k.endswith(name)]
        if not keys:
            print("  ⚠️ 无该键：", name)
            continue
        for k in keys:
            old_rc = cache[k].get("rc")
            new = run_key(k)
            cache[k] = new
            extra = ""
            for ln in new["out"].splitlines():
                if "结果" in ln or "通过 /" in ln:
                    extra = "  " + ln.strip()[:90]
            print("  %-32s rc %s → %s%s" % (name, old_rc, new["rc"], extra))
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False)
    bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
    print("刷新后 keys =", len(cache), "| rc!=0 =", len(bad))
    for k in bad:
        print("   ! rc=%s %s" % (cache[k]["rc"], k[:120]))
    print("已写回:", CACHE)


main()
