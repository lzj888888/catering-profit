# -*- coding: utf-8 -*-
"""R381 变异：把两处 validate 的上界从 >=100 放宽成 >100，F-①/② 必须各自点名。"""
import io, os, shutil, subprocess

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
CB = os.path.join(ROOT, "cloudfunctions/calcBom/validate.js")
SC = os.path.join(ROOT, "cloudfunctions/saveCostCard/validate.js")


def run():
    p = subprocess.run(["node", "tools/check_m3_engine_parity.js"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "")


def mutate(path, old, new, tag):
    bak = path + ".bak381"
    shutil.copy2(path, bak)
    try:
        s = io.open(path, encoding="utf-8", newline="").read()
        assert old in s, tag + " 锚点未命中"
        io.open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
        rc, out = run()
        hit = [l.strip() for l in out.splitlines() if tag in l and "❌" in l]
        print("[%s] %s" % ("抓到了" if rc and hit else "漏过", hit[:1] or "（无点名）"))
    finally:
        shutil.copy2(bak, path)
        os.remove(bak)


def main():
    mutate(CB, "lossPct >= 100", "lossPct > 100", "F-①")
    mutate(SC, "lossPct >= 100", "lossPct > 100", "F-②")
    rc, out = run()
    print("[%s] 还原后复跑 : %s" % ("通过" if rc == 0 else "仍红", out.splitlines()[-1][:40]))


main()
