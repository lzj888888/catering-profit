# -*- coding: utf-8 -*-
"""R188 第二轮：可疑目录内容 + 体积 Top + 引用检查（只读）"""
import os, subprocess

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"

def walk_files(p):
    out = []
    for d, dirs, files in os.walk(p):
        for f in files:
            out.append(os.path.join(d, f))
    return out

def du(p):
    if os.path.isfile(p):
        try: return os.path.getsize(p)
        except OSError: return 0
    t = 0
    for f in walk_files(p):
        try: t += os.path.getsize(f)
        except OSError: pass
    return t

def mb(n): return round(n/1048576.0, 2)

print("=== A. 可疑空目录 ===")
for n in ["--version", ".exe", ".atomcode", ".inscode"]:
    p = os.path.join(ROOT, n)
    if not os.path.isdir(p):
        print("%-12s <不存在>" % n); continue
    fs = walk_files(p)
    print("%-12s 文件数=%-6d 体积=%s MB" % (n, len(fs), mb(du(p))))
    for f in fs[:10]:
        print("      ", os.path.relpath(f, ROOT), os.path.getsize(f))

print()
print("=== B. _m3/ 内容构成 ===")
p = os.path.join(ROOT, "_m3")
if os.path.isdir(p):
    fs = walk_files(p)
    ext = {}
    for f in fs:
        e = os.path.splitext(f)[1].lower() or "(noext)"
        ext[e] = ext.get(e, 0) + 1
    print("文件总数:", len(fs), " 总体积:", mb(du(p)), "MB")
    for e, c in sorted(ext.items(), key=lambda x: -x[1]):
        print("   %-10s %d" % (e, c))
    print("--- 最大 10 个文件 ---")
    fs.sort(key=lambda f: -os.path.getsize(f))
    for f in fs[:10]:
        print("   %8.2f MB  %s" % (mb(os.path.getsize(f)), os.path.relpath(f, ROOT)))
    # 二级目录
    print("--- 一级子目录 ---")
    for n in sorted(os.listdir(p)):
        sp = os.path.join(p, n)
        if os.path.isdir(sp):
            print("   %-30s %s MB" % (n, mb(du(sp))))

print()
print("=== C. review/evidence 体积 Top15 ===")
ev = os.path.join(ROOT, "review", "evidence")
if os.path.isdir(ev):
    rows = []
    for n in sorted(os.listdir(ev)):
        sp = os.path.join(ev, n)
        if os.path.isdir(sp):
            rows.append((mb(du(sp)), n))
    rows.sort(reverse=True)
    tot = sum(r[0] for r in rows)
    for s, n in rows[:15]:
        print("   %8.2f MB  %s" % (s, n))
    print("   evidence 合计: %.2f MB (%d 个批次目录)" % (tot, len(rows)))

print()
print("=== D. review/ 一级构成 ===")
rv = os.path.join(ROOT, "review")
rows = []
for n in sorted(os.listdir(rv)):
    sp = os.path.join(rv, n)
    rows.append((mb(du(sp)), n, "DIR" if os.path.isdir(sp) else "file"))
rows.sort(reverse=True)
for s, n, k in rows[:12]:
    print("   %8.2f MB  %-40s %s" % (s, n, k))
print("   review 合计: %.2f MB" % mb(du(rv)))

print()
print("=== E. 仓内对 _m3 / --version / .exe 的文本引用 ===")
for kw in ["_m3", "--version", ".exe/"]:
    r = subprocess.run(["git", "grep", "-c", "-F", "--", kw], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [l for l in r.stdout.splitlines() if l.strip()]
    print("  [%s] 命中 %d 个已跟踪文件" % (kw, len(lines)))
    for l in lines[:8]:
        print("      ", l)
