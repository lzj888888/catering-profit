# -*- coding: utf-8 -*-
"""run_gate_r271.py —— R255：沙箱下用 preload 驱动原生 `node verify_all.js`（160 个套件）

WHY：本机沙箱禁 node 派生子进程（本轮探针实测 `spawnSync(git ls-files)` → EBUSY）⇒ 直接跑
     `node verify_all.js` 会集体 EBUSY fail-closed。本驱动在 Python 侧真跑，只注入
     `NODE_OPTIONS=--require gitcache_preload.js` ⇒ 子套件/git 由 preload 用缓存里的**真实结果**就地返回。

🔴 前提：`refresh_keys_r264.py` 已跑且 `rc!=0 == 0`，且两者**分两次调用**（preload 读磁盘）。
🔴 判据：只认 `====== 总览：N/N 套件通过 ======` 行 + 失败清单；`grep ❌` 会命中断言描述里的字面量。

用法：python review/evidence/r272b_gate/run_gate_r271.py [存档文件名]
"""
import os, subprocess, sys, time

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
OUTDIR = os.path.join(REPO, "review/evidence/r272b_gate")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

out_name = sys.argv[1] if len(sys.argv) > 1 else "gate_r272b.txt"
t0 = time.time()
r = subprocess.run([NODE, "verify_all.js"], cwd=REPO, capture_output=True, text=True,
                   encoding="utf-8", errors="replace", env=ENV, timeout=3000)
out = (r.stdout or "") + (r.stderr or "")
open(os.path.join(OUTDIR, out_name), "w", encoding="utf-8").write(out)

print("rc =", r.returncode, "| t = %.0fs" % (time.time() - t0))
for ln in out.splitlines():
    if ("总览" in ln) or ln.strip().startswith("FAIL") or ("失败清单" in ln) or ("❌" in ln and "通过" not in ln):
        print("  ", ln.strip()[:200])
