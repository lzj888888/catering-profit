# -*- coding: utf-8 -*-
"""S2 守卫适配批：把「页面全集 = app.json.pages」改成「主包 + 分包展开」；
扫描面 pages/ 补 subpkg/。只改这几处，不动判据语义（下界不变）。"""
import io

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/"

EXPAND = ("[].concat(Array.isArray(app.pages) ? app.pages : [], "
          "((app.subpackages || app.subPackages || []) || []).reduce(function (acc, sp) { "
          "var r = String(sp.root || '').replace(/\\/+$/, ''); "
          "return acc.concat((sp.pages || []).map(function (p) { return r ? r + '/' + p : p; })); }, []))")

EDITS = [
    # (文件, 原文, 新文, 说明)
    ("tools/check_tabbar.js",
     "const pages = Array.isArray(app.pages) ? app.pages : [];",
     "// R423 分包化：页面全集 = 主包 + 分包展开（旧写法只取主包 ⇒ 12 页 < 下界 20，判\"扫描面退化\"）\nconst pages = " + EXPAND + ";",
     "tabbar 页面全集"),

    ("tools/check_build_default_years.js",
     "const SCAN_DIRS = ['pages'];",
     "// R423 分包化：页面代码不再全在 pages/ 下\nconst SCAN_DIRS = ['pages', 'subpkg'];",
     "build_default_years 扫描面"),
]


def main():
    for path, old, new, why in EDITS:
        p = ROOT + path
        s = io.open(p, encoding="utf-8", newline="").read()
        if new.split("\n")[-1] in s:
            print("[跳过] %s 已改（%s）" % (path, why))
            continue
        if old not in s:
            print("[未命中] %s（%s）" % (path, why))
            continue
        io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
        print("[OK] %s（%s）" % (path, why))


main()
