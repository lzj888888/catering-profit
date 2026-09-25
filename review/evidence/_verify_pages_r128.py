"""验证提审材料 §4 静态自检两句的数字真伪：
1) 17 页的 .js/.wxml/.json/.wxss 零缺失（tools/check_pages.js）
2) pages/*.js 内 N 处 /pages/... 引用 ⇒ 唯一 M 个目标，越界 0
"""
import os, re, subprocess, sys

ROOT = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"

# 1) 跑既有守卫
r = subprocess.run(["node", "tools/check_pages.js"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
out = (r.stdout or "") + (r.stderr or "")
print("### check_pages.js RC=", r.returncode)
for l in out.splitlines():
    if l.strip().startswith("❌") or "通过 /" in l or "通过/" in l:
        print("   ", l.strip()[:160])

# 2) 自算 app.json::pages 与实际文件
import json
app = json.load(open(os.path.join(ROOT, "app.json"), encoding="utf-8"))
pages = app.get("pages", [])
print("\n### app.json::pages 数量 =", len(pages))
missing = []
for p in pages:
    base = os.path.join(ROOT, p)
    for ext in (".js", ".wxml", ".json", ".wxss"):
        if not os.path.exists(base + ext):
            missing.append(p + ext)
print("缺失文件:", missing if missing else "零缺失 ✅")

# 3) 自算 pages/*.js 内 /pages/... 引用次数与唯一目标
refs = []
# 允许带参数（?a=b）与锚点，路径段只取到 ? 之前
pat = re.compile(r"['\"\`](/pages/[A-Za-z0-9_/\-]+)")
pdir = os.path.join(ROOT, "pages")
for dp, dn, fns in os.walk(pdir):
    for fn in fns:
        if fn.endswith(".js"):
            t = open(os.path.join(dp, fn), encoding="utf-8", errors="replace").read()
            for m in pat.findall(t):
                refs.append(m.split("?")[0])
uniq = sorted(set(refs))
print("\n### /pages/... 引用处数 =", len(refs), " 唯一目标数 =", len(uniq))
inpages = set(pages)
out_of_range = [u for u in uniq if u.lstrip("/") not in inpages]
print("越界目标:", out_of_range if out_of_range else "0 ✅")
print("唯一目标清单:", uniq)
