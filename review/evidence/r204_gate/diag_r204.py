# -*- coding: utf-8 -*-
"""diag_r204.py —— 逐个真跑本轮门禁里红的套件，打印其 ❌ 明细（stdout 末 6 行）。"""
import os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"

TARGETS = [
    "tools/check_docx_derive.js",
    "tools/check_suite_coverage.js",
    "tools/check_suite_count_claims.js",
    "tools/check_quota_limits.js",
    "tools/check_collection_perms.js",
    "tools/check_privacy_collection.js",
    "tools/check_acceptance_counts.js",
    "tools/check_suite_assert_counts.js",
    "tools/selftest_r85.js",
]

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

for t in TARGETS:
    p = subprocess.run([NODE, t], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=300)
    out = p.stdout or ""
    bad = [l for l in out.split("\n") if "❌" in l]
    print("=" * 70)
    print(t, "rc=", p.returncode, " 红条数=", len(bad))
    for l in bad[:12]:
        print("   ", l.strip()[:200])
    if not bad:
        print("    (无 ❌，末 3 行:)", " | ".join(out.split("\n")[-3:])[:300])
