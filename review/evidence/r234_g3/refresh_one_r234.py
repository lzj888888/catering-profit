# -*- coding: utf-8 -*-
"""refresh_one_r234.py —— 只刷新 gitcache 里 `selftest_batch8b.js` 这一个键。

WHY：本轮改了 tools/selftest_batch8b.js（178 -> 179 条断言）。门禁逐套件是 python 直跑（真跑），
但 `check_suite_assert_counts.js` **内部**用 node 的 execFileSync 再派生各套件 ⇒ 该调用被
gitcache_preload 拦截、读到**旧缓存**（178）⇒ 守卫报「声明 179 ≠ 实跑 178」= **假红**。
（同族于 mk_force.py docstring：「仓库文件变化后，套件输出可能变，旧缓存会造成假绿/假红」。）
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
KEY = "node.exe " + REPO.replace("/", "/") + "/tools/selftest_batch8b.js"
CACHE = os.path.join(TMP, "gitcache.json")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

cache = json.load(open(CACHE, encoding="utf-8"))
print("key 存在:", KEY in cache)
before = cache.get(KEY, {}).get("out", "")
import re
m = re.search(r"(\d+) 通过 / (\d+) 失败", before)
print("刷新前 cached 结果:", m.group(0) if m else "(未匹配)")

r = subprocess.run([NODE, os.path.join(REPO, "tools/selftest_batch8b.js")], cwd=REPO,
                   capture_output=True, text=True, encoding="utf-8", errors="replace",
                   env=ENV, timeout=300)
cache[KEY] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

m2 = re.search(r"(\d+) 通过 / (\d+) 失败", cache[KEY]["out"] or "")
print("刷新后 cached 结果:", m2.group(0) if m2 else "(未匹配)", "| rc =", r.returncode)
print("cache size =", len(cache))
ok = bool(m2) and m2.group(1) == "179" and r.returncode == 0
print("结果：", "刷新成功（179 通过）" if ok else "!! 未达预期")
raise SystemExit(0 if ok else 1)
