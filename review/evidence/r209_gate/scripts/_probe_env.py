# -*- coding: utf-8 -*-
# _probe_env.py —— 复刻 run_gate3.py 的 ENV 构造，让子进程自报 NODE_OPTIONS 是否到位
import os, subprocess, json

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"

# —— 与 run_gate3.py 完全一致的构造顺序 ——
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

print('① 父视角 NODE_OPTIONS =', repr(ENV.get("NODE_OPTIONS")))

# ② 子进程自报
r = subprocess.run([NODE, '-e', 'console.log("CHILD_SEES=" + JSON.stringify(process.env.NODE_OPTIONS || null))'],
                   cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV)
print('② 子进程自报:', (r.stdout or '').strip() or (r.stderr or '')[:300])

# ③ 跑一个依赖 spawn 的套件：绝对路径 vs 相对路径 vs 带 extra 参数三种形态
for label, argv in [
    ('绝对路径', [NODE, os.path.join(REPO, 'tools/check_suite_coverage.js')]),
    ('相对路径', [NODE, 'tools/check_suite_coverage.js']),
]:
    rr = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                        encoding="utf-8", errors="replace", timeout=180, env=ENV)
    out = (rr.stdout or '') + (rr.stderr or '')
    tail = [l.strip() for l in out.splitlines() if l.strip()][-2:]
    print('③ {0}: rc={1} EBUSY={2} | {3}'.format(label, rr.returncode, 'EBUSY' in out, ' / '.join(tail)[:140]))
