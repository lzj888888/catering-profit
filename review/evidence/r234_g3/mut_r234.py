# -*- coding: utf-8 -*-
"""mut_r234.py —— A9-⑱（「开库存」口径三副本对拍）变异回灌。

纯内存字节备份；每条变异：命中数必须 == 1 → 改 → 跑 tools/selftest_batch8b.js →
只看 **A9-⑱ 那一行**是否转红（崩溃红 / 其它断言红都不算数）→ 立即还原 →
末尾逐字节还原自证。

该红者（口径锁破 / 倒轧破）必须红在 A9-⑱；等价改写必须保持绿（证明判行为不判字面）。
运行： python review/evidence/r234_g3/mut_r234.py
"""
import os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
SUITE = "tools/selftest_batch8b.js"

TARGETS = [
    "cloudfunctions/saveLedger/service.js",
    "cloudfunctions/getLedger/service.js",
    "cloudfunctions/calcMonthlyProfit/service.js",
]


def rb(rel):
    return open(os.path.join(REPO, rel), "rb").read()


def wb(rel, b):
    open(os.path.join(REPO, rel), "wb").write(b)


backup = {t: rb(t) for t in TARGETS}


def run():
    r = subprocess.run([NODE, SUITE], cwd=REPO, capture_output=True, timeout=180)
    out = (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
    hit = [l for l in out.splitlines() if "A9-⑱" in l]
    return r.returncode, (hit[0] if hit else "(未找到 A9-⑱ 行)"), out


MUTS = [
    ("M1", "cloudfunctions/saveLedger/service.js",
     b"Math.round(incomeTotalFen - expenseTotalFen - directConsumeFen - effectiveLumpSumFen)",
     b"Math.round(incomeTotalFen - expenseTotalFen - realConsumeFen - effectiveLumpSumFen)",
     "RED", "口径锁破：参考利润改用倒轧值（916000 -> 816000）"),
    ("M2", "cloudfunctions/getLedger/service.js",
     b"num0(inv.openingFen) + num0(inv.purchaseFen) - num0(inv.closingFen)",
     b"num0(inv.openingFen) + num0(inv.purchaseFen)",
     "RED", "倒轧破：真实消耗漏减期末存货（2300000 -> 3000000）"),
    ("M3", "cloudfunctions/calcMonthlyProfit/service.js",
     b"const operationRefProfitFen = fenRoundN(\n    incomeTotalFen - expenseTotalFen - directConsumeFen - effectiveLumpSumFen\n  );",
     b"const operationRefProfitFen = fenRoundN(incomeTotalFen - expenseTotalFen - directConsumeFen - effectiveLumpSumFen);",
     "GREEN", "等价改写（换行改单行）：行为不变 ⇒ 必须保持绿"),
]

print("=== R234 变异回灌：A9-⑱「开库存」口径三副本对拍 ===")
ok_all = True
for mid, rel, old, new, expect, desc in MUTS:
    b = backup[rel]
    n = b.count(old)
    if n != 1:
        print("  [锚点异常] %s 命中数=%d（必须 1）⇒ 跳过：%s" % (mid, n, desc))
        ok_all = False
        continue
    try:
        wb(rel, b.replace(old, new))
        rc, line, _ = run()
    finally:
        wb(rel, b)
    verdict = "RED" if "\u274c" in line else "GREEN"
    good = (verdict == expect)
    if not good:
        ok_all = False
    print("  %s %s [%s 期望%s] rc=%s · %s" % ("OK " if good else "BAD", mid, verdict, expect, rc, desc))
    print("      " + line[:140])

print("\n=== 逐字节还原自证 ===")
for t in TARGETS:
    same = rb(t) == backup[t]
    if not same:
        ok_all = False
    print("  %s %s 逐字节相等 = %s" % ("OK " if same else "BAD", t, same))

print("\n结果：" + ("全部如期" if ok_all else "有偏差"))
sys.exit(0 if ok_all else 1)
