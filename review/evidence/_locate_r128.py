import os, re

ROOT = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"

s = open(os.path.join(ROOT, "verify_all.js"), encoding="utf-8").read()
i = s.index("const SUITES = [")
j = s.index("\n];", i)
blk = s[i:j]
print("=== SUITES 命中行 ===")
for l in blk.splitlines():
    if ("r85-takeaway" in l) or ("page-manifest" in l) or ("suite-assert-counts" in l):
        print(l.strip()[:160])

print()
print("=== tools/ 下含 page-manifest / takeaway 的文件 ===")
td = os.path.join(ROOT, "tools")
for fn in sorted(os.listdir(td)):
    if fn.endswith(".js") and ("manifest" in fn or "takeaway" in fn or "assert" in fn):
        print("  " + fn)

print()
print("=== 提审材料里 N= 声明 与 §4 ===")
cand = []
for dp, dn, fns in os.walk(os.path.join(ROOT, "specs")):
    for fn in fns:
        if "提审" in fn or "上线材料" in fn:
            cand.append(os.path.join(dp, fn))
for p in cand:
    print("FILE:", os.path.relpath(p, ROOT))
    t = open(p, encoding="utf-8", errors="replace").read()
    for k, l in enumerate(t.splitlines()):
        if re.search(r"(N\s*=\s*\d+|页面全集|^\s*#+\s*4)", l):
            print("   ", k + 1, l.strip()[:150])
