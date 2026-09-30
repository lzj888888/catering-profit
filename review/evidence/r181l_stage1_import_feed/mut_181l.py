# -*- coding: utf-8 -*-
"""批次 F 变异回灌：证明守卫/自测真能抓到错。

硬判据（项目纪律）：必须红在**目标断言名**上 ——
只红 RC 不算数、崩溃红（ReferenceError 等）不算数。
逐条独立注入 → 跑 → 判定 → 立即还原 → 终态 md5 必须与基线全等。
"""
import io, os, subprocess, hashlib, json

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
BP = os.path.join(ROOT, "utils", "billParse.js")
GG = os.path.join(ROOT, "utils", "gradeGate.js")
ISB = os.path.join(ROOT, "cloudfunctions", "importSalesBill", "index.js")

MUTANTS = [
    ("M1", BP, "function detectPlatform(header) {",
     "function detectPlatform(header) {\n  return 'meituan';",
     ["node", "tools/selftest_bill_parse.js"], "detectPlatform 淘宝表头 → taobao"),
    ("M2", BP, "function parseBillMatrix(matrix, opts) {",
     "function parseBillMatrix(matrix, opts) {\n  return { totals: { rowCount: 0, amountFen: 0, qty: 0 }, rows: [], months: [], excluded: { rows: 0 } };",
     ["node", "tools/selftest_bill_parse.js"], "淘宝 行数 156"),
    ("M3", GG, "function checkGradeA(input, schema) {",
     "function checkGradeA(input, schema) {\n  return { pass: true, level: 'A', failures: [] };",
     ["node", "tools/selftest_grade_gate.js"], "① rows 空 → pass=false"),
    ("M4", ISB, "const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);",
     "const prior = null;",
     ["node", "tools/check_idempotency.js"], "importSalesBill 含幂等预检"),
]

base = {}
for _, path, *_ in MUTANTS:
    if path not in base:
        base[path] = io.open(path, encoding="utf-8").read()


def md5(s):
    return hashlib.md5(s.encode("utf-8")).hexdigest()


results = []
for tag, path, old, new, cmd, target in MUTANTS:
    orig = base[path]
    assert orig.count(old) == 1, "[%s] 锚点不唯一：%s" % (tag, old[:50])
    mutated = orig.replace(old, new, 1)
    try:
        io.open(path, "w", encoding="utf-8", newline="").write(mutated)
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, timeout=180)
        out = (p.stdout or b"").decode("utf-8", "replace") + (p.stderr or b"").decode("utf-8", "replace")
        rc = p.returncode
    finally:
        io.open(path, "w", encoding="utf-8", newline="").write(orig)

    hit_target = ("❌" in out and target in out)
    crashed = ("ReferenceError" in out or "SyntaxError" in out or "TypeError" in out)
    ok = hit_target and not crashed
    results.append({"tag": tag, "target": target, "rc": rc, "hit_target": hit_target,
                    "crashed": crashed, "valid": ok,
                    "line": [l.strip() for l in out.split("\n") if target in l and "❌" in l][:1]})
    print("[%s] rc=%s 命中目标断言=%s 崩溃=%s ⇒ %s" % (tag, rc, hit_target, crashed, "✅ 有效红" if ok else "❌ 无效"))

# 终态 md5 自证
print("\n终态 md5（必须与基线全等）：")
tail = {}
for path, txt0 in base.items():
    now = io.open(path, encoding="utf-8").read()
    same = (now == txt0)
    tail[os.path.basename(path)] = md5(now)
    print("  %-28s %s  %s" % (os.path.basename(path), md5(now), "✅ 已还原" if same else "❌ 未还原"))

valid = sum(1 for r in results if r["valid"])
print("\n===== 变异回灌：%d/%d 有效红 =====" % (valid, len(MUTANTS)))
json.dump({"results": results, "final_md5": tail},
          io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mut_181l_result.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
