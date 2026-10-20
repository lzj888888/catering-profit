# -*- coding: utf-8 -*-
"""R391 反恒真：把文档副本里某一处声明删掉，验证双面判据会红在目标键上。"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DOC = os.path.join(REPO, "specs/dev-specs/core/10_云函数清单与接口契约.md")
PY = sys.executable

CASES = [
    # (函数, 要从该行出参列里删掉的键)
    ("getShopContext", "no_shop"),
    ("manageShop", "replayed"),
    ("saveMaterial", "deleted"),
]

src = open(DOC, encoding="utf-8").read()
fail = 0
for fn, key in CASES:
    lines = src.split("\n")
    hit = -1
    for i, ln in enumerate(lines):
        if ln.startswith("| `" + fn + "`"):
            hit = i
            break
    if hit < 0:
        print("[SETUP-FAIL] 找不到 %s 行" % fn)
        fail += 1
        continue
    # 只在出参列里删：键可能写成 `k,` / `k: true,` 两种形态（简写 vs 带值）
    line = lines[hit]
    mutated = line
    for pat in (key + ", ", key + ",", key + ": true, ", key + ": true,"):
        cand = mutated.replace(pat, "", 1)
        if cand != mutated:
            mutated = cand
            break
    if mutated == line:
        print("[SETUP-FAIL] %s 行里没有 %s 可删" % (fn, key))
        fail += 1
        continue
    lines[hit] = mutated
    tmp = os.path.join(HERE, "_mut_doc_%s.md" % fn)
    open(tmp, "w", encoding="utf-8").write("\n".join(lines))
    env = dict(os.environ)
    env["R391_DOC"] = tmp
    r = subprocess.run([PY, os.path.join(HERE, "verify_out_params.py")],
                       capture_output=True, text=True, env=env, encoding="utf-8")
    out = r.stdout or ""
    target_line = [x for x in out.splitlines() if fn in x and key in x]
    red_on_target = ("FAIL" in out) and r.returncode != 0 and any("FAIL" in x for x in target_line)
    print("[%s] 删 %s.%s ⇒ rc=%d · %s · %s"
          % ("PASS" if red_on_target else "FAIL", fn, key, r.returncode,
             "红在目标键" if red_on_target else "没红在目标键",
             (target_line[0].strip() if target_line else "目标键不在输出里")))
    if not red_on_target:
        print("--- 输出尾 ---")
        print("\n".join(out.splitlines()[-6:]))
        fail += 1
    os.remove(tmp)

print("-" * 60)
print("反恒真：%d/%d 变异被抓" % (len(CASES) - fail, len(CASES)))
sys.exit(0 if fail == 0 else 1)
