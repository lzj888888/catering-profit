# -*- coding: utf-8 -*-
"""
R573 · engine-truth-audit §E 字段落地扫描（外卖平台键 / 冗余列双风险）

纪律：脚本落文件后跑（不内联 python -c）；命中要**看归属目录**再判定，不能只看命中数。
扫描目标：
  A 组 = 平台键（证明 eleme 是不是真的被用起来）
  B 组 = 账单费用列名（证明生产代码有没有碰「平台服务费」这条冗余汇总列）
扫描范围：主仓生产代码（排除 review/、_归档、node_modules、派生副本 cx_* 已单列统计）
"""
import io, os, sys
from collections import defaultdict

# 仓根 = 向上找到含 verify_all.js 的那一层（不靠数 parent 级数，避免 again 算错）
ROOT = os.path.dirname(os.path.abspath(__file__))
while True:
    if os.path.exists(os.path.join(ROOT, "verify_all.js")):
        break
    nxt = os.path.dirname(ROOT)
    if nxt == ROOT:
        raise SystemExit("找不到仓根（未发现 verify_all.js）")
    ROOT = nxt
SKIP_DIR = {"node_modules", ".git", "review", "_归档_过程件_202610", "_m3", "miniprogram_npm"}

A_KEYS = ["eleme", "饿了么", "taobao", "淘宝闪购", "jd_order", "jd_sku", "meituan"]
B_KEYS = ["平台服务费", "技术服务费", "配送服务费", "结算金额", "商家应收款", "应结金额"]

EXTS = (".js", ".wxml", ".json", ".md")


def walk():
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_DIR and not d.startswith("cx_")]
        for fn in fns:
            if fn.endswith(EXTS):
                yield os.path.join(dp, fn)


hits = defaultdict(list)
files = 0
for p in walk():
    files += 1
    try:
        src = io.open(p, encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    rel = os.path.relpath(p, ROOT).replace("\\", "/")
    for k in A_KEYS + B_KEYS:
        if k in src:
            hits[k].append(rel)

print("扫描文件数 =", files, "  根目录 =", ROOT)
print("\n" + "=" * 74)

print("\n[A 组] 平台键落地情况")
for k in A_KEYS:
    hs = hits.get(k, [])
    # 只统计生产代码（排除 docs/specs 文档面）
    prod = [h for h in hs if not h.startswith("review/") and not h.startswith("specs/")
            and not h.startswith("_归档")]
    print("  %-10s  命中文件 %3d 个（其中生产代码 %3d 个）" % (k, len(hs), len(prod)))
    if prod:
        print("      生产侧样例:", prod[:6])

print("\n[B 组] 账单费用列名落地情况")
for k in B_KEYS:
    hs = hits.get(k, [])
    prod = [h for h in hs if not h.startswith("review/") and not h.startswith("specs/")
            and not h.startswith("_归档")]
    print("  %-12s 命中文件 %3d 个（其中生产代码 %3d 个）" % (k, len(hs), len(prod)))
    if prod:
        print("      生产侧样例:", prod[:6])

print("\n" + "=" * 74)
print("判读规则：生产代码 0 命中 ⇒ 该概念在代码里不存在；命中但只在写侧 ⇒ 半截；读写侧都有 ⇒ 真落地")
