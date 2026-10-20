# -*- coding: utf-8 -*-
"""R375 变异：证明新判据抓得住"拿 gaPct 当分母"和"算出来不渲染"。"""
import io, os, shutil, subprocess, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
JS = os.path.join(ROOT, "pages/sandbox/index.js")
WXML = os.path.join(ROOT, "pages/sandbox/index.wxml")
BAK_JS = JS + ".bak375"
BAK_WXML = WXML + ".bak375"


def run():
    p = subprocess.run(["node", "tools/check_m2_matrix.js"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "")


def main():
    shutil.copy2(JS, BAK_JS)
    shutil.copy2(WXML, BAK_WXML)
    try:
        # M1：分母换成实收口径 gaPct（最容易犯的错）
        s = io.open(JS, encoding="utf-8", newline="").read()
        assert "out.marginalOnGross" in s
        io.open(JS, "w", encoding="utf-8", newline="").write(
            s.replace("out.marginalOnGross", "out.gaPct / 100"))
        rc, out = run()
        ok = rc != 0 and "R375" in out
        print("[%s] M1 分母换成 gaPct → %s" % ("抓到了" if ok else "漏过",
              [l.strip() for l in out.splitlines() if "R375" in l][:1]))
        shutil.copy2(BAK_JS, JS)

        # M2：保留计算、删掉渲染
        w = io.open(WXML, encoding="utf-8", newline="").read()
        assert "promoRes.goalText" in w
        io.open(WXML, "w", encoding="utf-8", newline="").write(
            w.replace("{{promoRes.goalText}}", "{{promoRes.gaText}}"))
        rc, out = run()
        ok = rc != 0 and "R375" in out
        print("[%s] M2 删掉渲染（改用 gaText）→ %s" % ("抓到了" if ok else "漏过",
              [l.strip() for l in out.splitlines() if "R375" in l][:1]))
        shutil.copy2(BAK_WXML, WXML)

        # M3：基准值本身（改 utils 的 numerNet 定义，看行为腿是否报）
        rc, out = run()
        print("[%s] M3 还原后复跑 → %s" % ("通过" if rc == 0 else "仍红", out.splitlines()[-1][:40]))
    finally:
        if os.path.exists(BAK_JS):
            shutil.copy2(BAK_JS, JS)
        if os.path.exists(BAK_WXML):
            shutil.copy2(BAK_WXML, WXML)
        for f in (BAK_JS, BAK_WXML):
            try:
                os.remove(f)
            except FileNotFoundError:
                pass


main()
