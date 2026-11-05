# -*- coding: utf-8 -*-
"""R386 变异：断掉任一分支的版本出参，判据必须点名。"""
import io, os, shutil, subprocess

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
F = os.path.join(ROOT, "cloudfunctions/calcSandbox/index.js")


def run():
    p = subprocess.run(["node", "tools/check_m2_matrix.js"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "")


def mutate(old, new, tag):
    bak = F + ".bak386"
    shutil.copy2(F, bak)
    try:
        s = io.open(F, encoding="utf-8", newline="").read()
        assert old in s, "锚点未命中: " + tag
        io.open(F, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
        rc, out = run()
        # ⚠️ 报错行**不带** ❌（❌ 在标题行）⇒ 只按 R386 匹配，且要求 rc≠0
        hit = [l.strip() for l in out.splitlines() if "R386" in l]
        print("[%s] %s → %s" % ("抓到了" if rc and hit else "漏过", tag, hit[:1] or "（无点名）"))
    finally:
        shutil.copy2(bak, F)
        os.remove(bak)


def main():
    mutate("bands_version: BANDS_VERSION,", "bands_version: '',", "M1 矩阵分支去掉 bands_version")
    mutate("out.engine_version = ENGINE_VERSION;", "out.engine_version = '';", "M2 单点分支去掉 engine_version")
    rc, out = run()
    print("[%s] 还原后复跑 : %s" % ("通过" if rc == 0 else "仍红", out.splitlines()[-1][:44]))


main()
