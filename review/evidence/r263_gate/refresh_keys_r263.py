# -*- coding: utf-8 -*-
"""refresh_keys_r260.py —— R255：刷 git 类键 + 刷受牵动套件键 + 补两个「从来没有过」的新键

WHY（本机沙箱禁 node 派生子进程，本轮探针实测 spawnSync(git ls-files) → EBUSY）：
  R255 新增 1 个云函数 + 2 个套件 + 改了 10 份既有文件，gitcache 里：
    ① git 类键（`ls-files` / `status --porcelain`）在 `git add`/commit 之后已过期 ⇒ 必须重跑；
    ② 一批 node 类键的输出**变了**（函数清单计数 / 断言数 / 扫描面文件数 / 鉴权调用点…）⇒ 不刷即假红；
    ③ 两个新套件在缓存里**从来没有过**（R250 类型②：全量重建也补不上）⇒ 必须显式补键。

顺序（技能 gate-under-sandbox §④/§⑥/§⑥-bis/§⑥-ter）：
  ① 刷 git 类键（直跑真 git，不注入 preload）→ 落盘；
  ② 刷受牵动的 node 类键（带 preload 真跑）→ 落盘；
  ③ 补新键 → 落盘；
  ④ 判据 = `rc!=0 == 0`。
🔴 与跑门禁必须**分成两次调用**（preload 读磁盘上的 gitcache.json）。
"""
import json, os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
OUTDIR = os.path.dirname(os.path.abspath(__file__))
ARCH = os.path.join(OUTDIR, "gitcache_rebuilt.json")

GITBIN = r"C:\Program Files\Git\bin"
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([GITBIN, r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

# 本轮输出**变了**的 node 类键（按脚本名匹配）
STALE_NODE_SUFFIX = [
    "tools/check_suite_assert_counts.js",
    "tools/check_suite_coverage.js",
    "tools/check_selftest_shape.js",
    "tools/check_js_syntax.js",
    "tools/check_requires.js",
    "tools/check_pack_size.js",
    "tools/check_fn_deps.js",
    "tools/selftest_r85.js",
    "tools/check_acceptance_counts.js",
    "tools/check_redline_inventory.js",
    "tools/check_evidence_meta.js",
    "tools/check_hint_fold.js",
    "tools/check_page_terms.js",
    "tools/check_dishreview_engine.js",
]

# 本轮「新出现」的键（缓存里从来没有过 ⇒ 必须显式补，全量重建补不上）
NEW_NODE = [
    # R263 新增套件：缓存里从来没有过（R250 类型②：全量重建也补不上，必须显式补）
    "node.exe C:/Users/lzj/WorkBuddy/Claw/catering-profit/tools/check_hub_guide.js",
]

cache = json.load(open(CACHE, encoding="utf-8"))
print("起始键数 =", len(cache))

def dump():
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def run_git(key):
    args = key.split(" ")[1:]
    r = subprocess.run(["git"] + args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV)
    return r.returncode, r.stdout, r.stderr

def run_node(key):
    args = key.split(" ")[1:]
    e2 = dict(ENV); e2["NODE_OPTIONS"] = "--require " + PRELOAD
    r = subprocess.run([NODE] + args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=e2)
    return r.returncode, r.stdout, r.stderr

# ① git 类键
git_keys = [k for k in cache if k.startswith("git ")]
print("\n[①] 刷 git 类键", len(git_keys), "个")
for k in git_keys:
    rc, out, err = run_git(k)
    cache[k] = {"rc": rc, "out": out, "err": err}
    print("   rc=%-3s %s" % (rc, k[:70]))
dump()

# ② 受牵动的 node 类键
# R260：本轮改了守卫/页面/契约/新增 utils ⇒ **全刷 node 键**（增量刷新是秒级，
#   而漏一个键就是一次 19 分钟的门禁假红 —— R238 已实证的取舍）
hits = [k for k in cache if k.startswith("node.exe ")]
print("\n[②] 刷 node 类键（输出变更）命中", len(hits), "个")
for k in hits:
    rc, out, err = run_node(k)
    cache[k] = {"rc": rc, "out": out, "err": err}
    tail = [l for l in (out or "").splitlines() if "通过" in l]
    print("   rc=%-3s %-64s %s" % (rc, k.replace("node.exe C:/Users/lzj/WorkBuddy/Claw/catering-profit/", "")[:64],
                                   (tail[-1].strip()[:36] if tail else "")))
dump()

# ③ 补新键
print("\n[③] 补新键", len(NEW_NODE), "个")
for k in NEW_NODE:
    rc, out, err = run_node(k)
    cache[k] = {"rc": rc, "out": out, "err": err}
    tail = [l for l in (out or "").splitlines() if "通过" in l]
    print("   rc=%-3s %-64s %s" % (rc, k.split("/")[-1], (tail[-1].strip()[:36] if tail else "")))
dump()

# ④ 判据
bad = [k for k in cache if cache[k].get("rc") != 0 and (k.startswith("node.exe ") or k.startswith("git "))]
json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n最终键数 =", len(cache), "| rc!=0 =", len(bad))
for k in bad[:12]:
    print("   ❌", k[:90], "rc=", cache[k].get("rc"))
print("判据：", "✅ 全部 rc=0" if not bad else "❌ 存在 rc≠0 键（需再跑一次循环）")
sys.exit(0 if not bad else 1)
