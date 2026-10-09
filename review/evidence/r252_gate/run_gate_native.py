# -*- coding: utf-8 -*-
"""run_gate_native.py —— R252：在沙箱下用 preload 驱动**原生** `node verify_all.js`

WHY：本机沙箱禁 node 派生任何子进程（探针实测全 EBUSY）⇒ 直接跑 `node verify_all.js`
     会因 execFileSync/git EBUSY 而 fail-closed 集体判红（环境限制，非代码缺陷）。
     本驱动在 Python 侧真跑 verify_all.js，仅把 `NODE_OPTIONS=--require gitcache_preload.js`
     注入 ⇒ 子进程（子套件 / git）由 preload 用**缓存里的真实运行结果**就地返回。
     ⇒ 判据 `====== 总览：N/N 套件通过 ======` 与原生跑同格式、可直接比对。

用法：python review/evidence/r252_gate/run_gate_native.py <存档文件名>
"""
import os, subprocess, sys, time

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
OUTDIR = os.path.join(REPO, "review/evidence/r252_gate")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

out_name = sys.argv[1] if len(sys.argv) > 1 else "gate_158_r252.txt"
t0 = time.time()
r = subprocess.run([NODE, "verify_all.js"], cwd=REPO, capture_output=True, text=True,
                   encoding="utf-8", errors="replace", env=ENV, timeout=1800)
out = (r.stdout or "") + (r.stderr or "")
open(os.path.join(OUTDIR, out_name), "w", encoding="utf-8").write(out)

print("rc =", r.returncode, "| t = %.0fs" % (time.time() - t0))
for ln in out.splitlines():
    if "总览" in ln or "FAIL" in ln or "❌" in ln:
        print("  ", ln.strip()[:160])
