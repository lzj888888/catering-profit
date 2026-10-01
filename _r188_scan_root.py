# -*- coding: utf-8 -*-
"""R188 仓库整理：根下一级条目盘点（体积 / 跟踪态 / ignore 态）
零删除零移动：本脚本只读。
"""
import os, subprocess, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"

def du(p):
    if os.path.isfile(p):
        try:
            return os.path.getsize(p)
        except OSError:
            return 0
    tot = 0
    for d, dirs, files in os.walk(p):
        for f in files:
            try:
                tot += os.path.getsize(os.path.join(d, f))
            except OSError:
                pass
    return tot

def mb(n):
    return round(n / 1048576.0, 2)

def git(args):
    r = subprocess.run(["git"] + args, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.stdout.strip()

names = sorted(os.listdir(ROOT))
tracked = set()
for line in git(["ls-files"]).splitlines():
    if line:
        tracked.add(line.replace("/", os.sep))

rows = []
for n in names:
    p = os.path.join(ROOT, n)
    size = du(p)
    isdir = os.path.isdir(p)
    # 跟踪态：目录看其下是否有 tracked 文件
    if isdir:
        sub = git(["ls-files", "--", n]).splitlines()
        tstate = "TRACKED(%d)" % len(sub) if sub else "untracked"
    else:
        tstate = "TRACKED" if n in tracked else "untracked"
    if tstate.startswith("untracked"):
        ig = git(["check-ignore", "-v", "--", n])
        istate = ig.splitlines()[0] if ig else "-"
    else:
        istate = "n/a"
    rows.append((n, "DIR" if isdir else "file", mb(size), tstate, istate))

rows.sort(key=lambda r: -r[2])
print("=== ROOT LEVEL (total %d entries) ===" % len(rows))
for n, k, s, t, i in rows:
    print("%-28s %-5s %10.2f MB  %-14s %s" % (n, k, s, t, i))

print()
print("=== SIZE SUM ===")
print("total MB:", mb(sum(r[2] for r in rows) * 1048576))
