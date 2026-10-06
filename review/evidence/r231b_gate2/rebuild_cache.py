# -*- coding: utf-8 -*-
"""rebuild_cache.py —— 重建被截断的 gitcache.json（R231b² 事故恢复）

事故：误跑了 `mk_gitcache.py`（Sep 29 的 6 键残件，且键格式写错 —— 只有 args 不含 exe
      ⇒ 与 preload 的 `basename(exe) + args` 不匹配）⇒ 原 158 键缓存被覆盖成 6 个无效键
      ⇒ 第二轮门禁 9 个套件因 `spawnSync git/python EBUSY` 判红（135/144）。

恢复：以 `review/evidence/r179_gate_sandbox/gitcache.json`（48 个**格式正确**的真缓存）
      + 现存 cache 里格式正确的键 + miss log 里的键 = 起点；
      每轮：① 直跑 git/python 类（不经 preload，真跑）→ ② **落盘** → ③ 跑 node 类
      （node 子进程读的是**磁盘上的** cache ⇒ 必须先落盘，否则它读到的是旧缓存 ⇒ 假红。
      这是第一版脚本的 bug：只在循环末尾落盘，导致 add 进来的键对同轮 node 不可见）。
      重复至 added=0 且 changed=0。**绝不伪造**：所有值都由 Python 侧真跑产生。
"""
import json, os, subprocess, time

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
BASE = os.path.join(REPO, "review/evidence/r179_gate_sandbox/gitcache.json")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r231b_gate2/gitcache_rebuilt.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

OK_PREFIX = ("git", "node.exe", "python.exe")


def dump(cache):
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False)


def load_cache():
    cache = {}
    for path in (BASE, CACHE):
        if not os.path.exists(path):
            continue
        try:
            for k, v in json.load(open(path, encoding="utf-8")).items():
                if k.split(" ")[0] in OK_PREFIX:
                    cache[k] = v
        except Exception as e:
            print("load fail", path, e)
    return cache


def miss_keys(paths):
    keys, seen = [], set()
    for p in paths:
        if not os.path.exists(p):
            continue
        for ln in open(p, encoding="utf-8", errors="replace"):
            k = ln.strip()
            if k and k not in seen:
                seen.add(k)
                keys.append(k)
    return keys


def argv_of(key):
    parts = key.split(" ")
    exe, args = parts[0], parts[1:]
    if exe == "git":
        return ["git"] + args, [REPO]
    if exe == "python.exe":
        if args[:1] == ["-c"]:
            return [PY, "-c", " ".join(args[1:])], [REPO]
        argv = [PY] + args
    elif exe == "node.exe":
        argv = [NODE] + args
    else:
        return None, []
    cwds = [REPO]
    if args and os.path.isabs(args[-1]) and os.path.exists(args[-1]):
        cwds.append(os.path.dirname(args[-1]))
    return argv, cwds


def run(key, timeout=600):
    argv, cwds = argv_of(key)
    if not argv:
        return {"rc": 127, "out": "", "err": "unknown exe"}
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


def main():
    t0 = time.time()
    cache = load_cache()
    print("base keys =", len(cache), flush=True)
    miss = miss_keys([os.path.join(TMP, "gitcache_miss.log"),
                      os.path.join(TMP, "gitcache_miss_r231b2_run2.log")])
    print("miss keys =", len(miss), flush=True)

    for it in range(1, 7):
        added = 0
        for k in miss:
            if k not in cache:
                cache[k] = run(k)
                added += 1
        dump(cache)                                   # ① 先落盘：node 子进程读磁盘缓存

        non_node = [k for k in cache if not k.startswith("node.exe")]
        for k in non_node:
            cache[k] = run(k)
        dump(cache)

        changed = 0
        for k in [x for x in cache if x.startswith("node.exe")]:
            new = run(k)
            if cache[k].get("rc") != new["rc"]:
                changed += 1
            cache[k] = new
        dump(cache)

        bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
        # 收尾再刷一遍非 node（node 跑完可能产出新的 git 事实：本仓 git 事实由人改，不会变，但保险）
        print(f"[iter {it}] added={added} changed={changed} keys={len(cache)} rc!=0={len(bad)} "
              f"t={time.time()-t0:.0f}s", flush=True)
        for k in bad[:12]:
            print("   ! rc=%s %s" % (cache[k]["rc"], k[:100]), flush=True)
        if added == 0 and changed == 0:
            break

    dump(cache)
    print("written:", CACHE, "| archived:", ARCH, flush=True)
    print("final keys =", len(cache), "| rc!=0 =", sum(1 for v in cache.values() if v["rc"] != 0), flush=True)


main()
