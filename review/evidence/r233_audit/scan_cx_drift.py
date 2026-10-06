# -*- coding: utf-8 -*-
"""R233 变动面审计 · 检查 1：cx_*.js 派生副本 vs cloudfunctions/common/ 单源 一致性"""
import os, hashlib, sys

ROOT = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
SRC = os.path.join(ROOT, "cloudfunctions", "common")
CFDIR = os.path.join(ROOT, "cloudfunctions")


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


srcs = {}
for n in sorted(os.listdir(SRC)):
    if n.endswith(".js"):
        srcs[n] = md5(os.path.join(SRC, n))
print("单源 cloudfunctions/common/ 共 %d 个：%s" % (len(srcs), ", ".join(sorted(srcs))))
print()

fns = []
drift = []
orphan = []
missing = []
nopair = []

for fn in sorted(os.listdir(CFDIR)):
    d = os.path.join(CFDIR, fn)
    if not os.path.isdir(d) or fn == "common":
        continue
    cx = sorted(f for f in os.listdir(d) if f.startswith("cx_") and f.endswith(".js"))
    # 该目录下引用了 cx_* / common 的 js 才算"该有副本"
    jsfiles = [f for f in os.listdir(d) if f.endswith(".js")]
    uses = False
    for f in jsfiles:
        try:
            t = open(os.path.join(d, f), encoding="utf-8").read()
        except Exception:
            continue
        if "cx_" in t:
            uses = True
            break
    if not cx:
        if uses:
            nopair.append(fn)
        continue
    fns.append(fn)
    have = set()
    for f in cx:
        name = f[3:]
        have.add(name)
        if name not in srcs:
            orphan.append((fn, f))
            continue
        if md5(os.path.join(d, f)) != srcs[name]:
            drift.append((fn, f))
    for name in srcs:
        if name not in have:
            missing.append((fn, name))

print("含 cx_* 的云函数数：%d" % len(fns))
print("DRIFT（副本与单源不一致）：%d" % len(drift))
for r in drift:
    print("   ✗ %s / %s" % r)
print()
print("ORPHAN（副本在、单源无）：%d" % len(orphan))
for r in orphan:
    print("   ✗ %s / %s" % r)
print()
print("MISSING（引用了 cx_ 但该函数缺副本）：%d 行" % len(missing))
_byfn = {}
for fn, name in missing:
    _byfn.setdefault(fn, []).append(name)
for fn, names in _byfn.items():
    print("   - %s 缺 %d 个：%s" % (fn, len(names), ", ".join(names[:5]) + ("…" if len(names) > 5 else "")))
print()
print("引用了 cx_ 但目录内一个 cx_ 都没有：%d" % len(nopair))
for fn in nopair:
    print("   ✗ %s" % fn)
print()
print("=== 汇总：DRIFT=%d ORPHAN=%d NO_PAIR=%d ===" % (len(drift), len(orphan), len(nopair)))
sys.exit(0 if (not drift and not orphan and not nopair) else 1)
