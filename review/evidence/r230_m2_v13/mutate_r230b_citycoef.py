# -*- coding: utf-8 -*-
"""R230b · 城市系数双副本守卫（S-⑤/S-⑥）变异回灌 —— 证明新断言非假绿，且**红在目标断言名**上。

用法：python review/evidence/r230_m2_v13/mutate_r230b_citycoef.py
判据（技能 mutation-backfill 硬判据）：① 基线 15/0；② 每组变异 rc=1 且失败行**含目标断言名**；
③ 还原后字节一致；④ 每组变异只动一处（独立可归因）。
"""
import io, os, subprocess

REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
NODE = r"C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
BP = os.path.join(REPO, "utils", "bizPreset.js")
IND = os.path.join(REPO, "cloudfunctions", "common", "indicatorRef.js")
GUARD = "tools/check_biz_preset.js"

# (标签, 文件, 原串, 新串, 期望命中的断言名)
CASES = [
    ("M-C1 前端 tier1.rent 漂移", BP,  "tier1:  { rent: 1.20, labor: 1.15 }", "tier1:  { rent: 1.25, labor: 1.15 }", "S-⑥"),
    ("M-C2 前端 tier1.labor 漂移", BP, "tier1:  { rent: 1.20, labor: 1.15 }", "tier1:  { rent: 1.20, labor: 1.30 }", "S-⑥"),
    ("M-C3 前端 county.rent 漂移", BP, "county: { rent: 0.75, labor: 0.85 }", "county: { rent: 0.80, labor: 0.85 }", "S-⑥"),
    ("M-C4 生产源 tier1.rent 漂移", IND, "coef: { rent: 1.20, labor: 1.15 }", "coef: { rent: 1.35, labor: 1.15 }", "S-⑥"),
    ("M-C5 生产源三档改两档（解析面退化）", IND,
     "  { key: 'county', coef: { rent: 0.75, labor: 0.85 } },", "", "S-⑤"),
]


def run_guard():
    r = subprocess.run([NODE, os.path.join(REPO, GUARD)], capture_output=True, text=True,
                       cwd=REPO, encoding="utf-8", errors="replace", timeout=120)
    out = (r.stdout or "") + (r.stderr or "")
    last = [ln for ln in out.splitlines() if ln.strip()][-1] if out.strip() else "(无输出)"
    fails = [ln.strip() for ln in out.splitlines() if "❌" in ln]
    return r.returncode, last, fails


def main():
    blobs = {}
    for f in (BP, IND):
        blobs[f] = io.open(f, "rb").read()

    rc, last, fails = run_guard()
    print("=== 基线 ===\n  rc=%s | %s" % (rc, last))
    base_ok = (rc == 0 and not fails)

    all_ok = base_ok
    for label, f, old, new, want in CASES:
        s = blobs[f].decode("utf-8")
        n = s.count(old)
        if n != 1:
            print("  ⚠️ %s：锚点未唯一命中（%d 次）⇒ 跳过（先核对源码）" % (label, n))
            all_ok = False
            continue
        io.open(f, "wb").write(s.replace(old, new).encode("utf-8"))
        try:
            rc, last, fails = run_guard()
            hit = any(want in x for x in fails)
            print("  %s rc=%s %s | %s" % ("✅" if hit else "❌", rc, "命中 " + want if hit else "**未命中目标断言**",
                                          (fails[0][:96] if fails else last[:96])))
            if not hit:
                all_ok = False
        finally:
            io.open(f, "wb").write(blobs[f])

    same = (io.open(BP, "rb").read() == blobs[BP]) and (io.open(IND, "rb").read() == blobs[IND])
    print("\n还原字节一致 = %s" % same)
    print("---- 结论：%s ----" % ("变异回灌 %d/%d 全部红在目标断言 + 基线绿 + 还原一致" % (len(CASES), len(CASES))
                                  if (all_ok and same) else "**存在未达标项，逐条见上**"))
    return 0 if (all_ok and same) else 1


if __name__ == "__main__":
    raise SystemExit(main())
