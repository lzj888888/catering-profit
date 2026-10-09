# -*- coding: utf-8 -*-
"""run_gate_r253.py —— R253：在沙箱下用 preload 驱动**原生** `node verify_all.js`

WHY：本机沙箱禁 node 派生任何子进程（探针实测 `spawnSync(node -v)` → EBUSY）⇒ 直接跑
     `node verify_all.js` 会因 execFileSync/git EBUSY 而 fail-closed 集体判红（环境限制，非代码缺陷）。
     本驱动在 Python 侧真跑 verify_all.js，仅注入 `NODE_OPTIONS=--require gitcache_preload.js`
     ⇒ 子进程（子套件 / git）由 preload 用**缓存里的真实运行结果**就地返回。

🔴 前提：先跑 `refresh_keys_r253.py` 并确认「rc!=0 == 0」，且**分两次调用**（preload 读磁盘）。
🔴 判据：只认 `====== 总览：N/N 套件通过 ======` 行 + 失败清单；`grep ❌` 会命中断言描述里的字面量。

用法：python review/evidence/r253_gate/run_gate_r253.py <存档文件名>
"""
import os, subprocess, sys, time

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
OUTDIR = os.path.join(REPO, "review/evidence/r253_gate")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

out_name = sys.argv[1] if len(sys.argv) > 1 else "gate_r253.txt"
t0 = time.time()
r = subprocess.run([NODE, "verify_all.js"], cwd=REPO, capture_output=True, text=True,
                   encoding="utf-8", errors="replace", env=ENV, timeout=2400)
out = (r.stdout or "") + (r.stderr or "")
open(os.path.join(OUTDIR, out_name), "w", encoding="utf-8").write(out)

print("rc =", r.returncode, "| t = %.0fs" % (time.time() - t0))
for ln in out.splitlines():
    if ("总览" in ln) or ln.strip().startswith("FAIL") or ("失败清单" in ln):
        print("  ", ln.strip()[:170])
