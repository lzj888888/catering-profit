# -*- coding: utf-8 -*-
# _probe_red.py —— 逐个复跑 r209 门禁的红套件，打印其**真实 stdout 尾部**（不用肉眼猜红了什么）
import os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

RELS = [
    'tools/check_month_picker.js',
    'tools/check_suite_assert_counts.js',
    'tools/check_suite_coverage.js',
    'tools/check_suite_count_claims.js',
    'tools/check_acceptance_counts.js',
    'tools/check_quota_limits.js',
    'tools/check_collection_perms.js',
    'tools/check_privacy_collection.js',
    'tools/check_docx_derive.js',
    'tools/selftest_r85.js',
]

for rel in RELS:
    print('=' * 70)
    print('### ' + rel)
    try:
        r = subprocess.run([NODE, rel], cwd=REPO, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=180, env=ENV)
    except subprocess.TimeoutExpired:
        print('TIMEOUT'); continue
    out = (r.stdout or '') + (r.stderr or '')
    print('rc =', r.returncode)
    tail = [l for l in out.splitlines() if l.strip()][-14:]
    for l in tail:
        print('   ' + l.strip()[:200])
