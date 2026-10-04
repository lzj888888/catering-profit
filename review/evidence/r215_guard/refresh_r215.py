# -*- coding: utf-8 -*-
"""refresh_r215.py —— R215 门禁缓存刷新（三阶段，全部用 Python 侧**真跑**）

WHY：本机 `node` 的 `spawnSync`/`execFileSync` 对任何子进程恒 EBUSY（**非沙箱模式下同样**，
     2026-10-04 实测），所以 `run_gate4.py` 靠 `gitcache_preload.js` 回放缓存。
     仓库文件/套件集变了不刷新 ⇒ **假红**（本轮实测：verify_all.js 从 136 涨到 137 套件）。
     缓存值必须是**真跑**出来的，只是换了执行者（Python subprocess 可正常派生 git / node）。

三阶段（顺序不可颠倒 —— preload 读的是**磁盘上的** gitcache.json）：
  A 刷 git 类键（真跑 git）
  B 刷受影响脚本的 node.exe 键（带 preload 跑，使它们内部的 spawn 走 A 的新缓存）
  C 补**新增套件**的 spawn 键（check_suite_assert_counts 会 execFileSync 每个 CASES.rel）
"""
import json
import os
import re
import subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
CACHE = os.path.join(TMP, "gitcache.json")
PRELOAD = os.path.join(TMP, "gitcache_preload.js")

# B 阶段：受本轮改动影响的脚本（按文件名过滤 node.exe 键）
FILTER = ['selftest_r85', 'check_suite_coverage', 'check_suite_count_claims',
          'check_suite_assert_counts', 'check_fn_selftest_counts', 'check_js_syntax',
          'check_evidence_meta', 'check_fn_public_surface']

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV_PRELOAD = dict(ENV)
ENV_PRELOAD["NODE_OPTIONS"] = "--require " + PRELOAD

cache = json.load(open(CACHE, encoding="utf-8"))
print("cache 初始键数:", len(cache))


def run(argv, use_preload):
    try:
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace",
                           env=(ENV_PRELOAD if use_preload else ENV), timeout=420)
        return r.returncode, r.stdout or "", r.stderr or ""
    except Exception as e:
        return -9, "", "RUNNER-ERR: " + str(e)


# ---------- A：git 类键 ----------
print("\n=== A 阶段：git 类键 ===")
git_keys = [k for k in cache if not (k.startswith("node.exe ") or k.startswith("python.exe "))]
for k in git_keys:
    parts = k.split(" ")
    rc, out, err = run([parts[0]] + parts[1:], use_preload=False)
    old = cache[k]["rc"]
    cache[k] = {"rc": rc, "out": out, "err": err}
    flag = "" if old == rc else "  <-- rc %d -> %d" % (old, rc)
    print("  %-52s rc=%d len=%d%s" % (k[:52], rc, len(out), flag))
json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("  [A 已落盘]")

# ---------- B：受影响脚本的 node 键 ----------
print("\n=== B 阶段：受影响 node 键（带 preload）===")
b_keys = [k for k in cache
          if (k.startswith("node.exe ") or k.startswith("python.exe "))
          and any(f in k for f in FILTER)]
for k in b_keys:
    parts = k.split(" ")
    exe = NODE if parts[0].startswith("node") else PY
    rc, out, err = run([exe] + parts[1:], use_preload=True)
    old = cache[k]["rc"]
    cache[k] = {"rc": rc, "out": out, "err": err}
    flag = "" if old == rc else "  <-- rc %d -> %d" % (old, rc)
    print("  %-74s rc=%d%s" % (k[:74], rc, flag))
json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("  [B 已落盘]")

# ---------- C：补齐 CASES 里每个 rel 的 spawn 键 ----------
print("\n=== C 阶段：补缺 spawn 键 ===")
src = open(os.path.join(REPO, 'tools/check_suite_assert_counts.js'), encoding='utf-8').read()
rels = re.findall(r"rel:\s*'([^']+)'", src)
added = 0
for rel in rels:
    abs_rel = os.path.join(REPO, rel).replace('\\', '/')
    k = 'node.exe ' + abs_rel
    if k in cache:
        continue
    rc, out, err = run([NODE, abs_rel], use_preload=True)
    cache[k] = {"rc": rc, "out": out, "err": err}
    added += 1
    print("  + %-70s rc=%d" % (rel, rc))
print("  新增 %d 个键" % added)
json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n最终键数:", len(cache))
print("written:", CACHE)
