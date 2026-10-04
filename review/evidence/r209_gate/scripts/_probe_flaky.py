# -*- coding: utf-8 -*-
# _probe_flaky.py —— 判定「沙箱禁 node 派生子进程」是否为时有时无的抖动
#   A 组：带 preload（NODE_OPTIONS）跑 N 次
#   B 组：不带 preload 跑 N 次
#   两组都够样本，才能区分「缓存没命中」与「沙箱抖动」。
import os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"

def run(rel, use_preload):
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + env.get("PATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    if use_preload:
        env["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")
    else:
        env.pop("NODE_OPTIONS", None)
    try:
        r = subprocess.run([NODE, rel], cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=120, env=env)
    except subprocess.TimeoutExpired:
        return 'TIMEOUT'
    out = (r.stdout or '') + (r.stderr or '')
    return ('OK' if r.returncode == 0 else 'RED') + ('|EBUSY' if 'EBUSY' in out else '')

TARGETS = ['tools/check_suite_coverage.js', 'tools/selftest_r85.js', 'tools/check_suite_assert_counts.js']
N = 5
for t in TARGETS:
    a = [run(t, True) for _ in range(N)]
    b = [run(t, False) for _ in range(N)]
    print('### ' + t)
    print('   带 preload : ' + ' '.join(a))
    print('   不带 preload: ' + ' '.join(b))
