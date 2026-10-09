# -*- coding: utf-8 -*-
"""refresh_keys_r253.py —— R253：刷 git 类键 + 刷受牵动套件键（含"从来没有过"的新键）

WHY（本机沙箱禁 node 派生子进程，探针实测 spawnSync(node -v) → EBUSY）：
  R253 改了两份 detectPlatform（加 AMBIGUOUS 哨兵）+ getDishReview 的映射接线，
  并改了**两个套件**的断言：
    · `tools/selftest_bill_parse.js`      53 → 67（新增 D 段 14 条）
    · `tools/check_dishreview_engine.js`  47 → 60（新增 ⑦ 段 13 条）
  ⇒ gitcache 里：
    ① git 类键 = `git add` 之前的事实（`git ls-files` / `status --porcelain` 也是键）⇒ 必须重跑；
    ② `check_suite_assert_counts` 用 process.execPath **实跑子套件** ⇒ 上述两套件的
       键值**已过期**（缓存里还是 53/47）⇒ 不刷就会「声明 67 ≠ 实跑 53」**假红**；
    ③ 本轮**新增**了 4 个 review/evidence 归档脚本（非套件，但会被 `git ls-files` 收录）。

顺序（技能 gate-under-sandbox §④/§⑥/§⑥-bis/§⑥-ter）：
  ① 刷 git 类键（直跑真 git，**不注入** preload）→ **落盘**；
  ② 刷 node 类键（带 preload 真跑；**每阶段之间落盘**，子进程才读得到新值）；
  ③ 判据 = `rc!=0 == 0`。
🔴 与跑门禁必须**分成两次调用**（preload 读磁盘，内存改动对它不可见）。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r253_gate/gitcache_rebuilt.json")

GITBIN = r"C:\Program Files\Git\bin"
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([GITBIN, r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

# 本轮输出**变了**的 node 类键（改了断言数 ⇒ 缓存值过期）
STALE_NODE_SUFFIX = [
    "tools/selftest_bill_parse.js",
    "tools/check_dishreview_engine.js",
    "tools/check_suite_assert_counts.js",
    "tools/check_suite_coverage.js",
    "tools/selftest_r85.js",          # 读 git status ⇒ 工作树变了
]
# 本轮「新出现」的键（缓存里从来没有过）：无新增套件/云函数 ⇒ 空
NEW_NODE = []

cache = json.load(open(CACHE, encoding="utf-8"))
print("起始键数 =", len(cache))

def dump():
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def run_git(key):
    args = key.split(" ")[1:]                      # 去掉开头的 'git'
    r = subprocess.run(["git"] + args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV)
    return r.returncode, r.stdout, r.stderr

def run_node(key):
    args = key.split(" ")[1:]                      # 去掉开头的 'node.exe'
    e2 = dict(ENV); e2["NODE_OPTIONS"] = "--require " + PRELOAD
    r = subprocess.run([NODE] + args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=e2)
    return r.returncode, r.stdout, r.stderr

# ---- ① git 类键：直跑真 git，全部重跑（工作树变了，任何 git 键都可能过期）----
git_keys = [k for k in cache if k.startswith("git ")]
print("\n[①] 刷 git 类键", len(git_keys), "个")
for k in git_keys:
    rc, out, err = run_git(k)
    cache[k] = {"rc": rc, "out": out, "err": err}
    if rc != 0:
        print("   ⚠️ rc=%s  %s" % (rc, k))
dump()                                             # 🔴 落盘：后面的 node 子进程要读

# ---- ② node 类键：刷「输出变了」的那批 ----
print("\n[②] 刷 node 类键（输出变更）")
hits = [k for k in cache if k.startswith("node.exe ")
        and any(s in k for s in STALE_NODE_SUFFIX)]
for k in hits:
    rc, out, err = run_node(k)
    cache[k] = {"rc": rc, "out": out, "err": err}
    tail = [l for l in (out or "").splitlines() if "通过" in l]
    print("   rc=%-3s %-70s %s" % (rc, k[:70], (tail[-1].strip()[:40] if tail else "")))
dump()                                             # 🔴 再落盘

# ---- ③ 新键（若有）：显式补 ----
if NEW_NODE:
    print("\n[③] 补新键", len(NEW_NODE), "个")
    for k in NEW_NODE:
        rc, out, err = run_node(k)
        cache[k] = {"rc": rc, "out": out, "err": err}
        print("   rc=%-3s %s" % (rc, k))
    dump()

# ---- 判据 ----
bad = [k for k in cache if cache[k].get("rc") != 0 and (
        k.startswith("node.exe ") or k.startswith("git "))]
json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n最终键数 =", len(cache), "| rc!=0 =", len(bad))
for k in bad[:10]:
    print("   ❌", k, "rc=", cache[k].get("rc"))
print("判据：", "✅ 全部 rc=0" if not bad else "❌ 存在 rc≠0 键（需再跑一次循环）")
