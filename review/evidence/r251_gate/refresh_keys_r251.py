# -*- coding: utf-8 -*-
"""refresh_keys_r251.py —— R251：按**依赖顺序**刷 gitcache 里被本轮改动牵动的键。

WHY：本机沙箱**禁 node 派生任何子进程**（探针实测连 `process.execPath` 都 EBUSY）
     ⇒ `node verify_all.js` 里的子套件派发与 `git ls-files` 全部 fail-closed 判红。
     技能 `gate-under-sandbox` 的正解 = 用 `gitcache_preload.js` 就地返回**缓存里的真实运行结果**。
     🔴 但缓存会**过期**：改过 `tools/**` 下任一 .js 套件后必须刷（R238 二次踩），
        否则「单独跑绿、门禁里红」——因为门禁读到的是**旧结果**。
     更要命的是 **spawner 类套件**（`check_suite_assert_counts` 会真跑子套件去数断言）
        ⇒ 它读的是**子套件在缓存里的值** ⇒ **子套件必须先落盘**，否则它按旧值判红。

依赖顺序（顺序本身是判据，别打乱）：
   ① git 类键（`git ls-files` / `git status --porcelain`）—— 它们被 check_suite_coverage / selftest_r85 读；
   ② 直接读到本轮改动文件的**子套件**；
   ③ 依赖 ① 的套件（check_suite_coverage / selftest_r85）；
   ④ 最后的 spawner：`check_suite_assert_counts.js`（它数的是 ②③ 的实跑值）。

用法：python review/evidence/r251_gate/refresh_keys_r251.py
"""
import json
import os
import subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
OUTDIR = os.path.join(REPO, "review/evidence/r251_gate")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

# ① git 键（真跑 git；Python 侧不受 node 子进程限制 ⇒ 不经 preload 也拿得到真值）
GIT_KEYS = ["git ls-files", "git status --porcelain", "git status --porcelain cloudfunctions/",
            "git -c core.quotepath=false ls-files"]

# ② 直接读到本轮改动文件（pages/m3/dishreview/** · miniprogram/i18n/terms.js · tools/*）的子套件
SUITE_KEYS = [
    "tools/check_dishreview_engine.js",   # 本轮改（36→47）
    "tools/check_page_terms.js",          # 读 pages/**/*.wxml + terms
    "tools/check_wxml_structure.js",      # 读 pages/**/*.wxml
    "tools/selftest_ad_gates.js",         # K11 terms 双副本逐字
    "tools/check_js_syntax.js",           # 编译全仓 .js（新增了 2 个证据脚本）
    "tools/check_shape_machine_value.js", # 同族（外卖卡）
]

# ③ 依赖 git 键的套件
GIT_DEP_KEYS = ["tools/check_suite_coverage.js", "tools/selftest_r85.js"]

# ④ 最后的 spawner（数 ②③ 的实跑值）
SPAWNER_KEYS = ["tools/check_suite_assert_counts.js"]


def run(key, timeout=900):
    parts = key.split(" ")
    exe, args = parts[0], parts[1:]
    if exe == "git":
        argv = ["git"] + args
    elif exe.endswith("node.exe"):
        argv = [NODE] + args
    else:
        argv = parts
    try:
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=timeout)
        return {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    except Exception as e:
        return {"rc": 124, "out": "", "err": str(e)}


def dump(cache):
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)


os.makedirs(OUTDIR, exist_ok=True)
cache = json.load(open(CACHE, encoding="utf-8"))
before = len(cache)
print("before keys =", before, flush=True)

buckets = [("① git 键", GIT_KEYS), ("② 子套件", SUITE_KEYS),
           ("③ 依赖 git 的套件", GIT_DEP_KEYS), ("④ spawner", SPAWNER_KEYS)]

for label, keys in buckets:
    print("\n" + label, flush=True)
    for rel in keys:
        key = rel if rel.startswith("git ") else ("node.exe " + os.path.join(REPO, rel).replace("\\", "/"))
        if key not in cache:
            print("  ! 键不在缓存里，跳过：%s" % key, flush=True)
            continue
        cache[key] = run(key)
        head = (cache[key]["out"] or "").strip().splitlines()
        tail = head[-1] if head else (cache[key]["err"] or "").strip().splitlines()[-1:] or ""
        print("  ~ rc=%d %s | %s" % (cache[key]["rc"], os.path.basename(rel), tail), flush=True)
    dump(cache)          # 🔴 每个桶落一次盘：后面的桶才读得到前面的新值

bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
print("\nFINAL keys = %d (before %d) | rc!=0 = %d" % (len(cache), before, len(bad)))
for k in bad:
    print("   ! rc=%s %s" % (cache[k]["rc"], k[:120]))
