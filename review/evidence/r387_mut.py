# -*- coding: utf-8 -*-
"""R387 变异：三处（两处出参 + 一处禁用主键）都必须能被点名。"""
import io, os, shutil, subprocess

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
SAVE = os.path.join(ROOT, "cloudfunctions/saveCostCard/index.js")
GET = os.path.join(ROOT, "cloudfunctions/getCostCard/service.js")


def run():
    p = subprocess.run(["node", "tools/check_m3_card_roundtrip.js"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "")


def mutate(path, old, new, tag, expect):
    bak = path + ".bak387"
    shutil.copy2(path, bak)
    try:
        s = io.open(path, encoding="utf-8", newline="").read()
        assert old in s, "锚点未命中: " + tag
        io.open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
        rc, out = run()
        hit = [l.strip() for l in out.splitlines() if expect in l]
        print("[%s] %s → %s" % ("抓到了" if rc and hit else "漏过", tag, hit[:1] or "（无点名）"))
    finally:
        shutil.copy2(bak, path)
        os.remove(bak)


def main():
    mutate(SAVE, "inputs_ref: { kind: 'cost_card', card_code: cardCode, version: nextVersion },",
           "", "M1 保存出参去掉 inputs_ref", "⑤-1")
    mutate(GET, "inputs_ref: { kind: 'cost_card', card_code: doc.card_code || '', version: doc.version || 1 },",
           "", "M2 列表映射去掉 inputs_ref", "⑤-2")
    mutate(SAVE, "version: nextVersion,\n    // 🔴 R387",
           "version: nextVersion, _id: 'x',\n    // 🔴 R387", "M3 塞入库内主键 _id", "⑤-3")
    rc, out = run()
    print("[%s] 还原后复跑 : %s" % ("通过" if rc == 0 else "仍红", out.splitlines()[-1][:46]))


main()
