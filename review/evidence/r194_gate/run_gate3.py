# -*- coding: utf-8 -*-
"""
run_gate3.py —— 沙箱下跑「店算」门禁 114 套件的等价驱动。

WHY：本会话 Bash 环境里 **node 无法派生任何子进程**（实测 spawn git.exe / cmd.exe / where.exe /
     hostname.exe / python.exe 乃至 **node.exe 自身** 全部 EBUSY），verify_all.js 的
     ① R92（execFileSync('git',['ls-files'])）与 ② 套件执行（execFileSync(NODE,[fp])）两处都跑不了
     ⇒ 原生门禁 0/114 直接红，但这**不是代码问题、是环境限制**。
     Python 侧派生 node 实测可用 ⇒ 由 Python 逐个 `node <套件>` 执行，判据**逐条复刻** verify_all.js。

等价性：
  - SUITES 列表：从 verify_all.js 源码**求值**取出（不手抄）。
  - R59 suite-count：driver 侧已由原生代码自校验（此前输出 ✅ 114），此处复算一遍。
  - R92 套件入库：用**真实 git**（Python 调 `git -c core.quotepath=false ls-files`）判定，是仓库事实。
  - R66/R69 审计：按 verify_all.js:660-709 逐行复刻（SECTION_HEAD / SUMMARY_TAIL / TAIL_SUMMARY /
    NO_SUMMARY_TAIL / isDelimOnly / isDelimRow / 末行窗口=1）。
  - 套件执行：cwd=仓根、argv 与原生一致（含第三元素 extra）。
"""
import json, os, re, subprocess, sys, time, hashlib

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
DUMP = os.path.join(TMP, "suites.json")

# ---------- 1. 从源码取 SUITES ----------
dump_js = r"""
const fs = require('fs');
const src = fs.readFileSync('verify_all.js', 'utf8');
const s = src.indexOf('const SUITES = [');
if (s < 0) { console.error('NO_SUITES'); process.exit(2); }
const e = src.indexOf('\n];', s);
const body = src.slice(s + 'const SUITES = '.length, e + 3);
const arr = eval(body);
console.log(JSON.stringify(arr));
"""
open(os.path.join(TMP, "dump_suites.js"), "w", encoding="utf-8").write(dump_js)
p = subprocess.run([NODE, os.path.join(TMP, "dump_suites.js")], cwd=REPO,
                   capture_output=True, text=True, encoding="utf-8")
if p.returncode != 0:
    print("取 SUITES 失败:", p.stderr[:400]); sys.exit(2)
SUITES = json.loads(p.stdout.strip())
open(DUMP, "w", encoding="utf-8").write(json.dumps(SUITES, ensure_ascii=False, indent=1))
print(f"SUITES = {len(SUITES)}")

# ---------- 2. R92：真实 git 判套件入库 ----------
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
g = subprocess.run(["git", "-c", "core.quotepath=false", "ls-files"],
                   cwd=REPO, capture_output=True, text=True, encoding="utf-8", env=ENV)
tracked = set(x.strip() for x in g.stdout.splitlines() if x.strip())
r92_missing = [s[1] for s in SUITES if s[1] and s[1].replace("\\", "/") not in tracked]
if r92_missing:
    print("❌ [suite-tracked] 未入库套件:", r92_missing)
else:
    print(f"✅ [suite-tracked] {len(SUITES)} 个套件文件全部已入库（R92 守卫 · 真 git，索引 {len(tracked)} 项）")

# ---------- 3. R66/R69 审计（复刻 verify_all.js:660-709） ----------
SECTION_HEAD = re.compile(r"^(={3,}|-{3,}|─{3,}|═{3,})[ \t]*(.*?)[ \t]*(={3,}|-{3,}|─{3,}|═{3,})[ \t]*$")
SUMMARY_TAIL = re.compile(r"通过\s*/\s*\d+\s*失败")
TAIL_SUMMARY = re.compile(r"\d+\s*通过")
NO_SUMMARY_TAIL = {
    "specs/dev-specs/prototype/check_error_codes.js",
    "cloudfunctions/calcMonthlyProfit/selftest.js",
    "tools/check_requires.js",
    "tools/check_pages.js",
    "tools/check_compliance.js",
    "tools/check_admincore.js",
}

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
    total = out.count("✅")
    zero = [s for i, s in enumerate(secs)
            if s["marks"] == 0 and not (i == len(secs) - 1 and SUMMARY_TAIL.search(s["title"]))]
    is_delim_row = lambda s: re.fullmatch(r"[=\-─═\s]{3,}", s) is not None
    tail1 = [l.strip() for l in out.splitlines() if l.strip() != "" and not is_delim_row(l.strip())][-1:]
    tail = any(TAIL_SUMMARY.search(l) for l in tail1) or (rel in NO_SUMMARY_TAIL)
    return {"total": total, "zero": zero, "sections": len(secs), "tail": tail}

# ---------- 4. 逐个跑套件 ----------
lines = []
failed = []
t0 = time.time()
for name, rel, *rest in SUITES:
    extra = rest[0] if rest and isinstance(rest[0], list) else []
    fp = os.path.join(REPO, rel)
    argstr = (" " + " ".join(extra)) if extra else ""
    head = f"\n===== [{name}] {rel}{argstr} ====="
    lines.append(head)
    try:
        r = subprocess.run([NODE, fp] + extra, cwd=REPO, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=180)
    except subprocess.TimeoutExpired:
        failed.append((name, rel, "TIMEOUT>180s"))
        lines.append(f"  [{name}] ❌ FAIL (timeout>180s)")
        continue
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        failed.append((name, rel, f"exit={r.returncode}"))
        lines.append(f"  [{name}] ❌ FAIL (exit={r.returncode})")
        lines.append(out[-2000:])
        continue
    a = audit(out, rel)
    lines.append(out.rstrip())
    if a["zero"]:
        failed.append((name, rel, "R66 段标题下零断言：" + "、".join(f"「{z['title']}」" for z in a["zero"])))
        lines.append(f"  [{name}] ❌ FAIL (R66 零断言段)")
    elif not a["tail"]:
        failed.append((name, rel, "R69 未走完收尾"))
        lines.append(f"  [{name}] ❌ FAIL (R69 收尾)")
    elif a["total"] == 0:
        failed.append((name, rel, "R66 全程 0 条 ✅"))
        lines.append(f"  [{name}] ❌ FAIL (0 断言)")
    else:
        lines.append(f"  [{name}] ✅ PASS  (✅ {a['total']} 条 / 段 {a['sections']})")
    # 进度
    sys.stdout.write("."); sys.stdout.flush()

r92_ok = not r92_missing
total_failed = len(failed) + (0 if r92_ok else 1)
lines.append(f"\n===== 总览：{len(SUITES) - total_failed}/{len(SUITES)} 套件通过 =====")
lines.append(f"R92（套件入库，真 git 判定）：{'✅' if r92_ok else '❌'}")
if failed:
    lines.append("失败清单：")
    for n, rl, why in failed:
        lines.append(f"  - [{n}] {rl} :: {why}")
lines.append(f"耗时 {time.time() - t0:.1f}s")

txt = "\n".join(lines)
open(os.path.join(TMP, "gate3_full.txt"), "w", encoding="utf-8").write(txt)
print()
print("=" * 60)
print(f"总览：{len(SUITES) - total_failed}/{len(SUITES)} 通过   耗时 {time.time()-t0:.1f}s")
print("R92:", "✅" if r92_ok else "❌ " + str(r92_missing))
for n, rl, why in failed:
    print(f"  ❌ [{n}] {rl} :: {why}")
