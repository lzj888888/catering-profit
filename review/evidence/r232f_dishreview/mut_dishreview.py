# -*- coding: utf-8 -*-
"""R232f · 变异回灌：证明 check_dishreview_engine 真能抓到错（不是假绿）
硬判据：只红 RC 不算数，必须红在**目标断言名关键词**上；崩溃红（ReferenceError 等）不算有效红。
还原判据：git hash-object ≡ 基线 blob（不用 md5 —— universal-newlines 会抹平 CRLF 差异）。
"""
import io, os, sys, subprocess

REPO = "C:/Users/lzj/WorkBuddy/Claw/catering-profit"
SVC = os.path.join(REPO, "cloudfunctions/getDishReview/service.js")
BASE = "908b2304ec4a77d2f384f0bf77c81ec72e178753"   # service.js 基线 blob

MUTS = [
    # (编号, 说明, 原文, 变异, 期望命中的目标断言名关键词)
    ("M1", "版本选取改错：取 version 最小（旧成本）⇒ 毛利偏移",
     "if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(cc, c);",
     "if (!cur || (c.version || 0) < (cur.version || 0)) latestByCode.set(cc, c);",
     ["最新版本"]),

    ("M2", "未匹配被静默归零：把 unmatched 也塞进 ranked（红线 17 破）",
     "      unmatched.push({ dish_key: dishKey, name: dishKey, qty: a.qty, amountFen: a.amountFen });\n      continue;",
     "      ranked.push({ dish_key: dishKey, name: dishKey, qty: a.qty, amountFen: a.amountFen,\n        totalCostFen: 0, grossFen: a.amountFen, marginPct: 100, snapshot_month: toMonth(null) });\n      continue;",
     ["未匹配"]),

    ("M3", "毛利率不防零除：去掉 a.amountFen > 0 判断 ⇒ 营收 0 时产 NaN",
     "const marginPct = a.amountFen > 0 ? Math.round((grossFen / a.amountFen) * 10000) / 100 : 0;",
     "const marginPct = Math.round((grossFen / a.amountFen) * 10000) / 100;",
     ["营收 0"]),

    ("M4", "totals.qty 漏掉未匹配：合计销量小于实际",
     "qty: ranked.reduce((s, x) => s + x.qty, 0) + unmatched.reduce((s, x) => s + x.qty, 0),",
     "qty: ranked.reduce((s, x) => s + x.qty, 0),",
     ["totals.qty 含未匹配"]),

    ("M5", "月份走本地时区（C-10 复发）：toMonth 换成 getFullYear/getMonth",
     "      snapshot_month: toMonth(card.created_at),",
     "      snapshot_month: (function (v) { const d = new Date(v); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })(card.created_at),",
     ["snapshot_month"]),

    ("M6", "聚合改为不累加（每次覆盖）⇒ qty/amount 取最后一行",
     "    a.qty += (Number(s.qty) || 0);\n    a.amountFen += (Number(s.amount) || 0);",
     "    a.qty = (Number(s.qty) || 0);\n    a.amountFen = (Number(s.amount) || 0);",
     ["聚合"]),
]

GUARD = os.path.join(REPO, "tools/check_dishreview_engine.js")
NODE = "C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"

def run_guard():
    r = subprocess.run([NODE, GUARD], capture_output=True, text=True, cwd=REPO, timeout=120)
    return r.returncode, (r.stdout or ""), (r.stderr or "")

def blob(p):
    r = subprocess.run(["git", "hash-object", p], capture_output=True, text=True, cwd=REPO)
    return (r.stdout or "").strip()

orig = io.open(SVC, encoding="utf-8", newline="").read()
print("基线 blob =", blob(SVC), "(期望", BASE + ")")
assert blob(SVC) == BASE, "基线 blob 不符，先确认工作树状态"

results = []
for mid, desc, old, new, keys in MUTS:
    if orig.count(old) != 1:
        results.append((mid, desc, "❌锚点不唯一(%d)" % orig.count(old), ""))
        continue
    mutant = orig.replace(old, new, 1)
    io.open(SVC, "w", encoding="utf-8", newline="").write(mutant)
    try:
        rc, out, err = run_guard()
        crashed = ("ReferenceError" in err or "TypeError" in err or "SyntaxError" in err) and ("❌" not in out)
        hit = [k for k in keys if k in out]
        ok = (rc != 0) and bool(hit) and not crashed
        verdict = ("✅有效红" if ok else ("⚠️崩溃红(无效)" if crashed else "❌打不红"))
        detail = "rc=%s 命中=%s" % (rc, hit if hit else "无")
        results.append((mid, desc, verdict, detail))
    finally:
        io.open(SVC, "w", encoding="utf-8", newline="").write(orig)

# ===== 还原自证 =====
after = blob(SVC)
restored = (after == BASE)
print("还原后 blob =", after, "|", "✅ 逐字节一致" if restored else "❌ 不一致！")
r = subprocess.run(["git", "status", "--porcelain", "--", SVC], capture_output=True, text=True, cwd=REPO)
st = (r.stdout or "").strip()
print("git status =", repr(st), "|", "✅ 仍为已暂存(A/M)" if st and not st.endswith("M") is False else "")

print("\n===== 变异回灌汇总 =====")
eff = 0
for mid, desc, verdict, detail in results:
    print("%-4s %-46s %s  %s" % (mid, desc[:44], verdict, detail))
    if verdict == "✅有效红":
        eff += 1
print("---- %d/%d 有效红 ----" % (eff, len(MUTS)))
sys.exit(0 if (eff == len(MUTS) and restored) else 1)
