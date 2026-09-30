# -*- coding: utf-8 -*-
"""mut_m317.py —— M3.17 变异回灌：故意把生产单源改回错误写法，看守卫是否**红在目标断言名上**。

硬判据（本项目铁律）：
  - **只红 RC 不算数** ⇒ 必须从 stdout 里抓出「目标断言名」；抓不到即视为**无效红**。
  - 崩溃红（ReferenceError 等）**不算有效红**（变异自身写错也会崩溃）。
  - 每条变异独立（逐条备份→变异→跑→还原），还原后 md5 必须与原文一致。

跑两个靶子：
  ① tools/selftest_m3_takeaway.js   （生产自测，21 断言）
  ② review/evidence/r181i_m317_accept/m317_anchor_run.js （我方独立复算，31 断言）
"""
import io, os, re, json, hashlib, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TARGET = os.path.join(REPO, "utils", "takeawayDerive.js")
SELFTEST = os.path.join(REPO, "tools", "selftest_m3_takeaway.js")
ANCHOR = os.path.join(REPO, "review", "evidence", "r181i_m317_accept", "m317_anchor_run.js")
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"

orig = io.open(TARGET, encoding="utf-8").read()
orig_md5 = hashlib.md5(orig.encode("utf-8")).hexdigest()
print("原文 md5 =", orig_md5, "| 行数", len(orig.split(chr(10))))
print()

# (编号, 说明, 旧串, 新串, 期望变红的断言名关键词)
MUTS = [
    ("M1", "佣金基数改成「含打包费的支付额」（破铁律②）",
     "  const commission = resolveCommission(params, goodsTotal);",
     "  const commission = resolveCommission(params, goodsTotal + packFee);",
     ["T-a", "B-a 佣金", "A1", "B3"]),

    ("M2", "fixed 模式下让保底 min 也生效（破红线⑦）",
     "    return Math.round(Number(p.commission_fixed_fen) || 0);",
     "    return Math.max(Math.round(Number(p.commission_fixed_fen) || 0), Number(p.commission_min_fen) || 0);",
     ["T-d", "E2"]),

    ("M3", "补贴承担方未选 ⇒ 默认算商家（破 fail-closed）",
     "  if (p.s_user && p.s_user.payer === 'merchant') total += Number(p.s_user.amount_fen) || 0;",
     "  if (p.s_user) total += Number(p.s_user.amount_fen) || 0;",
     ["T-f", "E4"]),

    ("M4", "到手口径漏扣商家补贴 s（破口径①）",
     "  const receipt = payment - sMerchant - commission - d - deliverySubsidy;",
     "  const receipt = payment - commission - d - deliverySubsidy;",
     ["T-b", "B6"]),

    ("M5", "两套口径混数：cash.profit 直接抄总额法（破红线③）",
     "      profit_fen: Math.round(profit),",
     "      profit_fen: Math.round(accrualProfit),",
     ["T-g", "B7", "C3", "C4"]),

    ("M6", "反算分母丢掉 (1−c)，佣金不再进反算（破 M3.17 反算公式）",
     "  return Math.round(numerator / (1 - c / 100));",
     "  return Math.round(numerator);",
     ["T-c", "D1"]),

    ("M7", "保底从 max 改成 min（率算值高于保底时反而取保底）",
     "  return min > 0 ? Math.max(base, min) : base;",
     "  return min > 0 ? Math.min(base, min) : base;",
     ["T-a", "A1", "A3"]),
]

ANSI = re.compile(r"\x1b\[[0-9;]*m")

def run(script):
    r = subprocess.run([NODE, script], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=180)
    out = ANSI.sub("", (r.stdout or "") + (r.stderr or ""))
    return r.returncode, out

results = []
for tag, desc, old, new, targets in MUTS:
    assert orig.count(old) == 1, "%s 锚点未命中或多次: %s" % (tag, old[:50])
    io.open(TARGET, "w", encoding="utf-8", newline="\n").write(orig.replace(old, new))
    crash = False
    rows = []
    for name, script in (("selftest", SELFTEST), ("anchor", ANCHOR)):
        rc, out = run(script)
        bad = [ln.strip() for ln in out.splitlines() if "❌" in ln]
        # 崩溃红识别：有 ReferenceError/TypeError/SyntaxError 且无 ❌
        if not bad and re.search(r"(ReferenceError|TypeError|SyntaxError|is not defined)", out):
            crash = True
        rows.append({"name": name, "rc": rc, "fails": bad, "crash": crash})
    hit = []
    for r_ in rows:
        for b in r_["fails"]:
            if any(t in b for t in targets):
                hit.append("%s:%s" % (r_["name"], b[:110]))
    effective = bool(hit) and not crash
    results.append({"tag": tag, "desc": desc, "crash": crash,
                    "rc": [r_["rc"] for r_ in rows],
                    "nfail": sum(len(r_["fails"]) for r_ in rows),
                    "hit": hit, "effective": effective,
                    "sample": [b[:120] for r_ in rows for b in r_["fails"]][:3]})
    print("%s %s  rc=%s 崩=%s 目标命中=%d 有效红=%s" %
          (tag, "✅" if effective else "❌", [r_["rc"] for r_ in rows], crash, len(hit), effective))
    for h in hit[:3]:
        print("      →", h)
    if not effective:
        for s in results[-1]["sample"]:
            print("      raw:", s)

# ---------- 还原并自证 ----------
io.open(TARGET, "w", encoding="utf-8", newline="\n").write(orig)
back = io.open(TARGET, encoding="utf-8").read()
back_md5 = hashlib.md5(back.encode("utf-8")).hexdigest()
restored = (back_md5 == orig_md5 and back == orig)

n_eff = sum(1 for x in results if x["effective"])
print()
print("=" * 64)
print("变异回灌：%d/%d 有效红" % (n_eff, len(MUTS)))
print("还原自证：md5 %s == %s ⇒ %s" % (back_md5, orig_md5, "✅ 逐字节一致" if restored else "❌ 不一致！"))
json.dump({"orig_md5": orig_md5, "restored": restored, "n_effective": n_eff,
           "total": len(MUTS), "results": results},
          io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mut_m317_result.json"),
                  "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("明细已落 mut_m317_result.json")
sys.exit(0 if (n_eff == len(MUTS) and restored) else 1)
