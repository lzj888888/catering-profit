# -*- coding: utf-8 -*-
"""mutate_r232.py —— R232 变异回灌：证明 `tools/check_grade_gate_dual.js` 的判据有真分辨力。
逐条独立：备份 → 改源码 → 跑守卫 → 记录 → 还原 → 校验 md5 逐字节一致。
判据：必须红在**目标断言名**上（只红 RC / 崩溃红不算有效红）。"""
import hashlib, io, os, re, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
GUARD = os.path.join(REPO, "tools", "check_grade_gate_dual.js")
FRONT = os.path.join(REPO, "utils", "gradeGate.js")
CLOUD = os.path.join(REPO, "cloudfunctions", "importSalesBill", "service.js")

MUTS = [
    dict(id="M1", why="只改一侧：云端 schema 的 platform.enum 删 'other'（真实漂移形态）",
         file=CLOUD,
         old="enum: ['taobao', 'meituan', 'eleme', 'other']",
         new="enum: ['taobao', 'meituan', 'eleme']",
         expect=["A-②"]),
    dict(id="M2", why="只改行为不改结构：云端 checkGradeA 去掉 REQUIRED_SHOP_ID 分支",
         file=CLOUD,
         old="""  if (input.shopId === undefined || input.shopId === null || input.shopId === '') {
    failures.push({ code: 'REQUIRED_SHOP_ID', field: 'shop_id', msg: '门店 ID 为空' });
  }""",
         new="""  if (false) {
    failures.push({ code: 'REQUIRED_SHOP_ID', field: 'shop_id', msg: '门店 ID 为空' });
  }""",
         expect=["B-①"]),
    dict(id="M3", why="两侧同时删 'other' ⇒ 结构仍等价，但关键锚点丢失（证明 A-③ 不是恒绿）",
         file=FRONT,
         old="enum: ['taobao', 'meituan', 'eleme', 'other']",
         new="enum: ['taobao', 'meituan', 'eleme']",
         expect=["A-③"],
         also=CLOUD),
    dict(id="M4", why="只改结构不改行为：云端 source.enum 删 'manual'（checkGradeA 不读 source ⇒ 行为面测不出）",
         file=CLOUD,
         old="source: { type: 'string', required: true, enum: ['oauth', 'excel', 'manual'] }",
         new="source: { type: 'string', required: true, enum: ['oauth', 'excel'] }",
         expect=["A-②"],
         expectGreen=["B-①"]),
    dict(id="M5", why="只改结构但**行为可测**：云端 qty.min 0→1（电池含 qty=0 边界样本 ⇒ 行为面也必须抓到）",
         file=CLOUD,
         old="qty: { type: 'number', required: true, integer: true, min: 0 }",
         new="qty: { type: 'number', required: true, integer: true, min: 1 }",
         expect=["A-②", "B-①"]),
]

def md5(p):
    with open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=180)
    return r.returncode, (r.stdout or "") + (r.stderr or "")

lines = []
ok_all = True
for m in MUTS:
    targets = [m["file"]] + ([m["also"]] if m.get("also") else [])
    baks = {p: md5(p) for p in targets}
    raw = {p: io.open(p, encoding="utf-8", newline="").read() for p in targets}
    applied = True
    for p in targets:
        t = raw[p]
        cnt = t.count(m["old"])
        if cnt < 1:
            lines.append("## %s ❌ 锚点未命中（%d 次）—— 变异未生效，本条无效" % (m["id"], cnt))
            ok_all = False
            applied = False
            break
        io.open(p, "w", encoding="utf-8", newline="").write(t.replace(m["old"], m["new"]))

    rc, out = run_guard() if applied else (-1, "")
    # 还原
    for p in targets:
        io.open(p, "w", encoding="utf-8", newline="").write(raw[p])
    restored = all(md5(p) == baks[p] for p in targets)

    reds = sorted(set(re.findall(r"❌ (S-①|S-②|S-③|A-①|A-②|A-③|B-①|B-②|C-①|C-②|C-③|C-④)", out)))
    hit = [e for e in m["expect"] if e in reds]
    greens = [g for g in m.get("expectGreen", []) if g in reds]
    good = bool(hit) and not greens and rc != 0 and restored
    ok_all = ok_all and good
    lines.append("## %s %s" % (m["id"], "✅ 有效红" if good else "❌ 无效"))
    lines.append("   为什么变异：" + m["why"])
    lines.append("   期望红在：" + " / ".join(m["expect"]) + ("；期望仍绿：" + " / ".join(m.get("expectGreen", [])) if m.get("expectGreen") else ""))
    lines.append("   实得 rc=%s  红断言=%s  命中=%s%s  md5 还原=%s"
                 % (rc, ",".join(reds) or "(无)", ",".join(hit) or "(无)",
                    "  违反期望绿=" + ",".join(greens) if greens else "", restored))
    tail = [l for l in out.strip().splitlines() if "结果：" in l]
    if tail:
        lines.append("   守卫末行：" + tail[-1].strip())
    lines.append("")

body = "\n".join(lines)
io.open(os.path.join(os.path.dirname(GUARD), "..", "review", "evidence", "r232_gate", "mut_r232.out.txt"),
        "w", encoding="utf-8", newline="").write(body + "\n")
print(body)
print("ALL_EFFECTIVE_RED =", ok_all)
sys.exit(0 if ok_all else 1)
