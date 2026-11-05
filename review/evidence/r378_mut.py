# -*- coding: utf-8 -*-
"""R378 变异：证明"冻结首列"与"横滑提示"两条判据都抓得住。"""
import io, os, shutil, subprocess

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
WXSS = os.path.join(ROOT, "pages/sandbox/matrix.wxss")
WXML = os.path.join(ROOT, "pages/sandbox/matrix.wxml")


def run():
    p = subprocess.run(["node", "tools/check_m2_matrix.js"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "")


def main():
    b1, b2 = WXSS + ".bak378", WXML + ".bak378"
    shutil.copy2(WXSS, b1)
    shutil.copy2(WXML, b2)
    try:
        s = io.open(WXSS, encoding="utf-8", newline="").read()
        assert "position: sticky" in s
        io.open(WXSS, "w", encoding="utf-8", newline="").write(
            s.replace("position: sticky", "position: relative", 1))
        rc, out = run()
        hit = [l.strip() for l in out.splitlines() if "R378" in l]
        print("[%s] M1 sticky → relative : %s" % ("抓到了" if rc and hit else "漏过", hit[:1]))
        shutil.copy2(b1, WXSS)

        w = io.open(WXML, encoding="utf-8", newline="").read()
        assert "{{t.matrixSwipeHint}}" in w
        io.open(WXML, "w", encoding="utf-8", newline="").write(
            w.replace("{{t.matrixSwipeHint}}", "{{t.colRent}}", 1))
        rc, out = run()
        hit = [l.strip() for l in out.splitlines() if "R378" in l]
        print("[%s] M2 提示不渲染（换成 colRent）: %s" % ("抓到了" if rc and hit else "漏过", hit[:1]))
        shutil.copy2(b2, WXML)

        rc, out = run()
        print("[%s] M3 还原后复跑 : %s" % ("通过" if rc == 0 else "仍红", out.splitlines()[-1][:44]))
    finally:
        for src, dst in ((b1, WXSS), (b2, WXML)):
            if os.path.exists(src):
                shutil.copy2(src, dst)
                os.remove(src)


main()
