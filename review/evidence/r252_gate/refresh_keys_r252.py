# -*- coding: utf-8 -*-
"""refresh_keys_r252.py —— R252：刷 git 类键 + 补「缓存里从来没有过」的新键 + 刷受牵动套件键

WHY（本机沙箱禁 node 派生子进程，探针全 EBUSY）：
  R252 新增了套件 `tools/check_salesbills.js`（42 断言）与 2 个新云函数
  （`getSalesBills` / `clearSalesBills`，各带 `selftest.js`），并改了若干既有套件
  ⇒ gitcache 里：
    ① git 类键 = `git add` 之前的事实（必须重跑，`git ls-files`/`status` 也是键）；
    ② 新套件 / 新云函数 selftest 的键**从来没有过**（R250 同型「缺键」，
       全量重建也补不上 —— 必须按 miss 日志或显式名单补）；
    ③ 改动过的套件（`check_suite_assert_counts` spawn 子套件、`selftest_r85` 已改）
       的键值过期 ⇒ 必须重跑，否则门禁拿旧输出比对 ⇒ **假红**。

顺序（技能 gate-under-sandbox §④/§⑥-bis/§⑥-ter）：
  ① 刷 git 类键（直跑真 git，不注入 preload）→ 落盘；
  ② 补/刷 node 类键（带 preload 真跑；**每阶段之间落盘**，子进程才读得到新值）；
  ③ 判据 = `rc!=0 == 0`。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r252_gate/gitcache_rebuilt.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

# 本轮「新出现」的 node 类键（缓存里从来没有过）—— 显式列出，别只依赖 miss 日志
NEW_NODE = [
    "node.exe tools/check_salesbills.js",
    "node.exe cloudfunctions/getSalesBills/selftest.js",
    "node.exe cloudfunctions/clearSalesBills/selftest.js",
]
# 本轮「输出变了」的 node 类键（改了断言/断言数声明）—— 重跑刷新
STALE_NODE_SUFFIX = [
    "tools/check_suite_assert_counts.js",   # 新增 CASES 项 ⇒ 输出变
    "tools/selftest_r85.js",                # A15 白名单新增 4 条
    "tools/check_fn_inventory.js",          # 新函数登记 ⇒ F2/F3/F4/F5 数变
    "tools/check_privacy_collection.js",    # 收集项/白名单核验
    "tools/check_idempotency.js",           # clearSalesBills「+幂等」被识别
    "tools/check_requires.js",              # 新 require 引用
    "tools/check_suite_coverage.js",        # SUITES 覆盖（spawn 子套件，须最后刷）
]


def run_git(key, timeout=120):
    parts = key.split(" ")
    argv = ["git"] + parts[1:]
    r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=timeout)
    return {"rc": r.returncode, "out": r.stdout, "err": r.stderr}


def run_node(key, timeout=600):
    parts = key.split(" ")
    argv = [NODE] + parts[1:]
    env = dict(ENV)
    env["NODE_OPTIONS"] = "--require " + PRELOAD
    cwds = [REPO]
    if parts[1:] and os.path.isabs(parts[-1]) and os.path.exists(parts[-1]):
        cwds.append(os.path.dirname(parts[-1]))
    best = None
    for cwd in cwds:
        try:
            r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", env=env, timeout=timeout)
        except Exception as e:
            best = {"rc": 124, "out": "", "err": str(e)}
            continue
        best = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
        if r.returncode == 0:
            break
    return best


def dump(cache):
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False)


cache = json.load(open(CACHE, encoding="utf-8"))
print("before keys =", len(cache), flush=True)

# ---- ① git 类（真跑 + 落盘）----
print("--- [1] git 类键 ---", flush=True)
for k in [x for x in cache if x.startswith("git")]:
    old = cache[k].get("rc")
    cache[k] = run_git(k)
    print("  %-44s rc %s→%s" % (" ".join(k.split(" ")[:4]), old, cache[k]["rc"]), flush=True)
dump(cache)

# ---- ② 新键（真跑 + 落盘）----
print("--- [2] 新键（缓存里从来没有过）---", flush=True)
for k in NEW_NODE:
    cache[k] = run_node(k)
    print("  + rc=%d %s" % (cache[k]["rc"], k[:110]), flush=True)
dump(cache)

# ---- ③ 过期键（真跑 + 落盘；spawner 排最后）----
print("--- [3] 过期套件键 ---", flush=True)
for suffix in STALE_NODE_SUFFIX:
    for k in [x for x in cache if x.startswith("node.exe ") and x.endswith(suffix)]:
        cache[k] = run_node(k)
        print("  ~ rc=%d %s" % (cache[k]["rc"], k[:110]), flush=True)
    dump(cache)

bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
print("FINAL keys = %d | rc!=0 = %d" % (len(cache), len(bad)), flush=True)
for k in bad:
    print("   ! rc=%s %s" % (cache[k]["rc"], k[:120]))
