# -*- coding: utf-8 -*-
"""refresh_missing_keys.py —— R250：补 2 个「缓存里从来没有过」的键 + 顺序刷受牵动的键

WHY：`tools/check_picker_platform.js`（今日 11:59）与 `tools/check_doc_write_isdeleted.js`
     （今日 13:19）是**本轮之前新增**的套件，而 gitcache 里从来没有它们的键
     ⇒ 沙箱下 verify_all 派生它们时 preload 未命中 ⇒ fail-closed 判 EBUSY
     ⇒ 门禁 153/155（**环境/缓存缺键，不是代码缺陷**，技能 gate-under-sandbox 三步法第 2~3 步）。

做法（严格按技能「先落盘、子进程才读得到新值」）：
  ① 读 `gitcache_miss.log` ⇒ 对每个缺键**用 Python 侧真跑**（不经 preload）→ **落盘**；
  ② 落盘后，再刷「会 spawn 子套件」的键（`check_suite_assert_counts`）—— 它的输出依赖子套件
     在磁盘缓存里的新值 ⇒ 必须排在第 ① 步落盘之后；
  ③ 再落盘。判据 = `rc!=0 == 0` 且缺键已补齐。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r250_gate/gitcache_rebuilt.json")
MISS = os.path.join(TMP, "gitcache_miss.log")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD


def run(key, timeout=600):
    parts = key.split(" ")
    exe, args = parts[0], parts[1:]
    if exe == "git":
        argv = ["git"] + args
    elif exe == "python.exe":
        argv = ([PY, "-c", " ".join(args[1:])] if args[:1] == ["-c"] else [PY] + args)
    elif exe == "node.exe":
        argv = [NODE] + args
    else:
        return {"rc": 127, "out": "", "err": "unknown exe"}
    cwds = [REPO]
    if args and os.path.isabs(args[-1]) and os.path.exists(args[-1]):
        cwds.append(os.path.dirname(args[-1]))
    best = None
    for cwd in cwds:
        try:
            r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", env=ENV, timeout=timeout)
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

# ---- ① 补缺键（真跑 → 落盘）----
miss = []
seen = set()
if os.path.exists(MISS):
    for ln in open(MISS, encoding="utf-8", errors="replace"):
        k = ln.strip()
        if k and k not in seen:
            seen.add(k)
            miss.append(k)
print("miss keys =", len(miss), flush=True)
for k in miss:
    cache[k] = run(k)
    print("  + rc=%d %s" % (cache[k]["rc"], k[:110]), flush=True)
dump(cache)                      # 🔴 先落盘：后面 spawn 子套件的键才读得到

# ---- ② 落盘后刷「会 spawn 子套件」的键（顺序有意义）----
SPAWNERS = ["check_suite_assert_counts.js", "check_suite_coverage.js"]
for name in SPAWNERS:
    for k in [x for x in cache if x.startswith("node.exe ") and x.endswith(name)]:
        cache[k] = run(k)
        print("  ~ rc=%d %s" % (cache[k]["rc"], k[:110]), flush=True)
    dump(cache)

# ---- ③ 判据 ----
final_keys = len(cache)
bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
print("FINAL keys = %d | rc!=0 = %d" % (final_keys, len(bad)))
for k in bad:
    print("   ! rc=%s %s" % (cache[k]["rc"], k[:110]))
