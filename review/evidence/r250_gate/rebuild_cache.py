# -*- coding: utf-8 -*-
"""rebuild_cache.py —— R250：全量迭代收敛重建 gitcache（改过 tools/** 套件 ⇒ 门禁前置）

WHY：R250 改了 3 个套件（selftest_bill_parse 39→53 / check_shape_machine_value 18→27 /
     check_suite_assert_counts 声明同步），且改动面还覆盖 terms.js（单源 + 镜像）、
     pages/takeaway/index.{js,wxml}、cloudfunctions/importSalesBill/{index,service}.js
     ⇒ 牵动面远超 3 个套件，按技能 §〇-bis「改 tools/** 套件 ⇒ 刷缓存是门禁前置条件」
     与 §⑥-bis「只改一两个子套件可用 refresh_node_keys.py；牵动面广用全量迭代收敛」⇒ 走后者。

来源：review/evidence/r231b_gate2/rebuild_cache.py（R231b² 事故恢复版，语义一致）
      仅两处适配：① NODE 路径 22.22.2-3 → 22.22.2-6（本机只有 -6）；
                  ② ARCH 落到 review/evidence/r250_gate/（不覆盖别轮证据）。

🔴 纪律：所有值一律由 Python 侧**真跑**产生（同 rebuild_cache.py 的原始纪律）。
🔴 顺序：git/python 类直跑 → 落盘 → node 类（node 子进程读磁盘缓存）→ 落盘 → 迭代至 added=0 且 changed=0。
"""
import json, os, subprocess, time

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
BASE = os.path.join(REPO, "review/evidence/r179_gate_sandbox/gitcache.json")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r250_gate/gitcache_rebuilt.json")

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
    miss = miss_keys([os.path.join(TMP, "gitcache_miss.log")])
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
        print(f"[iter {it}] added={added} changed={changed} keys={len(cache)} rc!=0={len(bad)} "
              f"t={time.time()-t0:.0f}s", flush=True)
        for k in bad[:12]:
            print("   ! rc=%s %s" % (cache[k]["rc"], k[:100]), flush=True)
        if added == 0 and changed == 0:
            break

    final_keys = len(cache)
    n_bad = sum(1 for v in cache.values() if v["rc"] != 0)
    print(f"FINAL keys = {final_keys} | rc!=0 = {n_bad} | t={time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
