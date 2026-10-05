# -*- coding: utf-8 -*-
"""
run_gate4.py —— r213 门禁驱动（每套件一个**独立 python 进程**）

WHY（本轮实测，非推测）：
  review/evidence/r223_gate/run_gate3.py 用**单个** python 进程连续派生 135 个 node 子进程时，
  依赖 spawn 的 9 个套件稳定红（`spawnSync git EBUSY` / `spawnSync python EBUSY`）；而把这 9 个
  套件**单独**、或在短序列（≤40 个）里用**同一个 ENV、同一份 preload** 驱动，实证 **5/5 通过**
  （证据：`flaky_1.txt` 的 A/B 对照组、`_probe_env.py` 的子进程自报、`min_1.txt` 阶段 A/B）。
  ⇒ 这是**长时间连续派生的执行面限制**，不是代码缺陷，也不是缓存缺键（miss 日志无对应条目）。
  为保证「套件是否通过」这一事实不被执行形态污染，本驱动把每个套件放进**独立 python 进程**执行，
  形态与已验证成功的单独驱动完全一致；判据（R92 / R66 / R69）逐条复用 run_gate3.py 的等价实现。
"""
import json, os, re, subprocess, sys, time

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
OUTDIR = os.path.join(REPO, "review/evidence/r223_gate", "per_suite")
os.makedirs(OUTDIR, exist_ok=True)

SNIPPET = r'''
import os, subprocess, sys
rel, outp = sys.argv[1], sys.argv[2]
REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")
extra = sys.argv[3:]
try:
    r = subprocess.run([NODE, rel] + extra, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=180, env=ENV)
    out = (r.stdout or "") + (r.stderr or "")
    rc = r.returncode
except subprocess.TimeoutExpired as e:
    out = "TIMEOUT>180s"; rc = 124
open(outp, "w", encoding="utf-8").write(out)
sys.stdout.write("RC=" + str(rc))
'''

# ---------- 1. SUITES ----------
dump_js = r"""
const fs = require('fs');
const src = fs.readFileSync('verify_all.js', 'utf8');
const s = src.indexOf('const SUITES = [');
const e = src.indexOf('\n];', s);
console.log(JSON.stringify(eval(src.slice(s + 'const SUITES = '.length, e + 3))));
"""
open(os.path.join(TMP, "dump_suites.js"), "w", encoding="utf-8").write(dump_js)
p = subprocess.run([NODE, os.path.join(TMP, "dump_suites.js")], cwd=REPO, capture_output=True,
                   text=True, encoding="utf-8")
SUITES = json.loads(p.stdout.strip())
print("SUITES =", len(SUITES))

# ---------- 2. R92（真 git） ----------
GITENV = dict(os.environ)
GITENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + GITENV.get("PATH", "")
g = subprocess.run(["git", "-c", "core.quotepath=false", "ls-files"], cwd=REPO,
                   capture_output=True, text=True, encoding="utf-8", env=GITENV)
tracked = set(x.strip() for x in g.stdout.splitlines() if x.strip())
r92_missing = [s[1] for s in SUITES if s[1] and s[1].replace("\\", "/") not in tracked]
print("R92:", "✅ " + str(len(SUITES)) + " 个套件全部入库" if not r92_missing else "❌ " + str(r92_missing))

# ---------- 3. R66 / R69 审计（等价复刻 verify_all.js） ----------
SECTION_HEAD = re.compile(r"^(={3,}|-{3,}|─{3,}|═{3,})[ \t]*(.*?)[ \t]*(={3,}|-{3,}|─{3,}|═{3,})[ \t]*$")
SUMMARY_TAIL = re.compile(r"通过\s*/\s*\d+\s*失败")
TAIL_SUMMARY = re.compile(r"\d+\s*通过")
NO_SUMMARY_TAIL = {"specs/dev-specs/prototype/check_error_codes.js", "cloudfunctions/calcMonthlyProfit/selftest.js",
                   "tools/check_requires.js", "tools/check_pages.js", "tools/check_compliance.js",
                   "tools/check_admincore.js"}

def is_delim_only(s):
    return s == "" or re.fullmatch(r"[=\-─═]+", s) is not None

def audit(out, rel):
    secs, cur = [], None
    for ln in out.splitlines():
        h = SECTION_HEAD.match(ln)
        if h and not is_delim_only(h.group(2).strip()):
            if cur: secs.append(cur)
            cur = {"title": h.group(2).strip(), "marks": ln.count("✅")}
        elif cur is not None:
            cur["marks"] += ln.count("✅")
    if cur: secs.append(cur)
    zero = [s for i, s in enumerate(secs)
            if s["marks"] == 0 and not (i == len(secs) - 1 and SUMMARY_TAIL.search(s["title"]))]
    is_delim_row = lambda s: re.fullmatch(r"[=\-─═\s]{3,}", s) is not None
    tail1 = [l.strip() for l in out.splitlines() if l.strip() and not is_delim_row(l.strip())][-1:]
    tail = any(TAIL_SUMMARY.search(l) for l in tail1) or (rel in NO_SUMMARY_TAIL)
    return {"total": out.count("✅"), "zero": zero, "sections": len(secs), "tail": tail}

# ---------- 4. 逐个跑（每套件独立 python 进程） ----------
lines, failed = [], []
t0 = time.time()
for name, rel, *rest in SUITES:
    extra = rest[0] if rest and isinstance(rest[0], list) else []
    outp = os.path.join(OUTDIR, name.replace('/', '_') + ".out")
    head = "\n===== [%s] %s =====" % (name, rel)
    lines.append(head)
    try:
        r = subprocess.run([PY, "-c", SNIPPET, rel, outp] + extra, cwd=REPO, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=200)
    except subprocess.TimeoutExpired:
        failed.append((name, rel, "TIMEOUT>200s"))
        lines.append("  [%s] ❌ FAIL (timeout)" % name)
        sys.stdout.write("T"); sys.stdout.flush()
        continue
    out = ""
    try:
        out = open(outp, "r", encoding="utf-8", errors="replace").read()
    except Exception:
        pass
    m = re.search(r"RC=(-?\d+)", (r.stdout or ""))
    rc = int(m.group(1)) if m else -1
    lines.append(out.rstrip())
    if rc != 0:
        failed.append((name, rel, "exit=%d" % rc))
        lines.append("  [%s] ❌ FAIL (exit=%d)" % (name, rc))
        sys.stdout.write("X"); sys.stdout.flush()
        continue
    a = audit(out, rel)
    if a["zero"]:
        failed.append((name, rel, "R66 段标题下零断言：" + "、".join("「%s」" % z["title"] for z in a["zero"])))
        lines.append("  [%s] ❌ FAIL (R66)" % name)
    elif not a["tail"]:
        failed.append((name, rel, "R69 未走完收尾"))
        lines.append("  [%s] ❌ FAIL (R69)" % name)
    elif a["total"] == 0:
        failed.append((name, rel, "0 断言"))
        lines.append("  [%s] ❌ FAIL (0 断言)" % name)
    else:
        lines.append("  [%s] ✅ PASS  (✅ %d 条 / 段 %d)" % (name, a["total"], a["sections"]))
    sys.stdout.write("."); sys.stdout.flush()

r92_ok = not r92_missing
total_failed = len(failed) + (0 if r92_ok else 1)
lines.append("\n===== 总览：%d/%d 套件通过 =====" % (len(SUITES) - total_failed, len(SUITES)))
lines.append("R92（套件入库，真 git 判定）：%s" % ("✅" if r92_ok else "❌"))
if failed:
    lines.append("失败清单：")
    for n, rl, why in failed:
        lines.append("  - [%s] %s :: %s" % (n, rl, why))
lines.append("耗时 %.1fs" % (time.time() - t0))

open(os.path.join(REPO, "review/evidence/r223_gate", "gate_full.txt"), "w", encoding="utf-8").write("\n".join(lines))
print()
print("=" * 60)
print("总览：%d/%d 通过   耗时 %.1fs" % (len(SUITES) - total_failed, len(SUITES), time.time() - t0))
print("R92:", "✅" if r92_ok else "❌ " + str(r92_missing))
for n, rl, why in failed:
    print("  ❌ [%s] %s :: %s" % (n, rl, why))
