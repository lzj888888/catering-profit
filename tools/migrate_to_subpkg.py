# -*- coding: utf-8 -*-
"""tools/migrate_to_subpkg.py —— 把 pages/<module> 迁移成 <root>/<module> 分包

用法：
    python tools/migrate_to_subpkg.py metrics subpkg/tools --dry    # 只看会改什么
    python tools/migrate_to_subpkg.py metrics subpkg/tools          # 真跑

为什么用脚本而不是手改（PLAN_2026-10-21_分包方案.md §3）：
  改动面 = 守卫 450 处 + 页面跳转 105 处 = **555 处**，且移动后**相对 require 深度会变**
  （`pages/month/x.js` 的 `../../utils` → `subpkg/biz/month/x.js` 的 `../../../utils`）。
  人手必漏；脚本是"同一条规则应用全局"，漏了就是规则错，门禁容易抓。

安全闸（任一不满足即退出，不写半截）：
  · module 目录必须存在，且目标目录不存在（防覆盖）
  · module 不得是 tabBar 页所在目录（index / m3 / mine）—— 微信要求 tabBar 页在主包
  · app.json 里必须能找到该 module 的全部页面
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAB_FORBIDDEN = {"index", "m3", "mine"}          # tabBar 页所在目录，禁止迁移
SELF = os.path.relpath(os.path.abspath(__file__), ROOT).replace("\\", "/")


def read(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)


def git(*args):
    r = subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print("[git 失败] %s\n  %s\n  %s" % (" ".join(args), (r.stdout or "").strip(), (r.stderr or "").strip()))
        sys.exit(3)
    return r.stdout


def depth_to_root(rel_path):
    """rel_path 是文件相对仓库根的路径；返回它到根的上级数（`a/b/c.js` → 2）。"""
    d = os.path.dirname(rel_path.replace("\\", "/"))
    return 0 if d in ("", ".") else len(d.split("/"))


def bump_requires(src, levels):
    """把 require('...') 里以 ../ 开头的路径，多上 levels 级。"""
    if levels <= 0:
        return src

    def rep(m):
        q1, p, q2 = m.group(1), m.group(2), m.group(3)
        if p.startswith("../"):
            return "require(%s%s%s%s)" % (q1, "../" * levels, p, q2)
        return m.group(0)

    return re.sub(r"require\((['\"])([^'\"]+)(['\"])\)", rep, src)


def main():
    if len(sys.argv) < 3:
        print("用法: python tools/migrate_to_subpkg.py <module> <root> [--dry]")
        sys.exit(2)
    mod = sys.argv[1].strip("/")
    root = sys.argv[2].strip("/")
    dry = "--dry" in sys.argv

    old_dir = "pages/%s" % mod
    new_dir = "%s/%s" % (root, mod)

    # ---- 安全闸 ----
    if mod in TAB_FORBIDDEN:
        print("[拒绝] %s 含 tabBar 页，微信要求 tabBar 页在主包" % mod)
        sys.exit(2)
    if not os.path.isdir(os.path.join(ROOT, old_dir)):
        print("[拒绝] %s 不存在" % old_dir)
        sys.exit(2)
    if os.path.exists(os.path.join(ROOT, new_dir)):
        print("[拒绝] 目标 %s 已存在（防覆盖）" % new_dir)
        sys.exit(2)

    app = json.loads(read(os.path.join(ROOT, "app.json")))
    pages = list(app.get("pages") or [])
    moved = [p for p in pages if p == old_dir or p.startswith(old_dir + "/")]
    if not moved:
        print("[拒绝] app.json 里找不到 %s 下的页面" % old_dir)
        sys.exit(2)

    # ---- 相对 require 需要多加几级（按真实深度差算，不靠猜）----
    sample_old = moved[0] + ".js"
    sample_new = new_dir + sample_old[len(old_dir):]
    levels = depth_to_root(sample_new) - depth_to_root(sample_old)

    print("模块      : %s" % mod)
    print("移动      : %s/  ->  %s/" % (old_dir, new_dir))
    print("页面数    : %d" % len(moved))
    print("require 需多加 %d 级（%s: %d → %s: %d）" % (
        levels, old_dir, depth_to_root(old_dir + "/x.js"), new_dir, depth_to_root(new_dir + "/x.js")))

    # ---- 先统计全仓引用面（dry 也要能看到）----
    # 🔴 只改**代码**，绝不改历史：`review/**`（各轮 NOTE / evidence 快照）与 `specs/**`（当时的设计）
    #   里出现的 `pages/xxx` 是**历史记录**，改了就是篡改事实（R411 试跑时发现 259 处里绝大多数是
    #   `review/evidence/*/gitcache_*.json`）。若某个守卫因为读了 specs 而红，再针对那一处单独处理。
    def collect_targets():
        # 🔴 必须含 `subpkg`：已经迁移过的模块里的**跳转路径**也要跟着改
        #   （S1 实测：移过去的 amortize.js 还写着 `/pages/month/assetEdit`，
        #    因为旧范围不含 subpkg ⇒ 出口指向未注册页面，真机点了没反应）。
        CODE_DIRS = ("tools", "pages", "utils", "miniprogram", "subpkg")
        out = []
        for d in CODE_DIRS:
            base_dir = os.path.join(ROOT, d)
            if not os.path.isdir(base_dir):
                continue
            for base, _dirs, files in os.walk(base_dir):
                for fn in files:
                    if not fn.endswith((".js", ".wxml", ".json")):
                        continue
                    rel = os.path.relpath(os.path.join(base, fn), ROOT).replace("\\", "/")
                    if rel == SELF:
                        continue
                    out.append(rel)
        for extra in ("verify_all.js", "app.js"):
            if os.path.exists(os.path.join(ROOT, extra)):
                out.append(extra)
        return out

    targets = collect_targets()
    hits = []
    for rel in targets:
        s = read(os.path.join(ROOT, rel))
        if old_dir in s:
            hits.append((rel, s.count(old_dir)))
    total_hits = sum(n for _, n in hits)
    print("引用面    : %d 个文件 / %d 处" % (len(hits), total_hits))
    top = sorted(hits, key=lambda x: -x[1])[:6]
    for rel, n in top:
        print("            %-46s %d 处" % (rel, n))

    if dry:
        print("\n[DRY] 未改动任何文件。去掉 --dry 才会真跑。")
        return

    # ---- 1. git mv ----
    os.makedirs(os.path.join(ROOT, root), exist_ok=True)
    git("mv", old_dir, new_dir)
    print("[1/4] git mv 完成")

    # ---- 2. 重算被移动文件里的相对 require ----
    fixed = 0
    for fn in os.listdir(os.path.join(ROOT, new_dir)):
        if not fn.endswith(".js"):
            continue
        p = os.path.join(ROOT, new_dir, fn)
        s = read(p)
        s2 = bump_requires(s, levels)
        if s2 != s:
            write(p, s2)
            fixed += 1
    print("[2/4] 相对 require 修正：%d 个文件" % fixed)

    # ---- 3. 全仓替换引用（两阶段：先全算好，再统一落盘）----
    # 🔴 必须重新收集：`git mv` 之后旧目录已不存在，沿用 mv 前的列表会读到失联路径
    #   （第一次试跑就崩在这里 ⇒ 半截状态：文件已移走、引用没改、app.json 还指旧路径）。
    plan = {}
    for rel in collect_targets():
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        s = read(p)
        if old_dir in s:
            plan[rel] = s.replace(old_dir, new_dir)
    for rel, s in plan.items():
        write(os.path.join(ROOT, rel), s)
    print("[3/4] 全仓引用替换：%d 个文件" % len(plan))

    # ---- 3.5 terms 双副本同步 ----
    # 🔴 `miniprogram/i18n/terms.js` 与 `specs/dev-specs/i18n/terms.js` 必须 md5 一致
    #   （守 check_hint_fold D1 / channel_over100 ④-3）。terms 注释里也写着页面路径，
    #   迁移会改到它 ⇒ 不同步就立刻漂移。S3 实测踩到，故写进脚本。
    _t1 = os.path.join(ROOT, "miniprogram", "i18n", "terms.js")
    _t2 = os.path.join(ROOT, "specs", "dev-specs", "i18n", "terms.js")
    if os.path.exists(_t1) and os.path.exists(_t2):
        _s1 = read(_t1)
        if _s1 != read(_t2):
            write(_t2, _s1)
            print("[3.5] terms 双副本已同步（写入 specs 副本）")

    # ---- 4. app.json：pages 移除 + subpackages 追加 ----
    try:
        app2 = json.loads(read(os.path.join(ROOT, "app.json")))
        app2["pages"] = [p for p in app2["pages"] if p not in moved]
        sub = app2.get("subpackages") or app2.get("subPackages") or []
        entry = None
        for sp in sub:
            if sp.get("root") == root:
                entry = sp
                break
        if entry is None:
            entry = {"root": root, "pages": []}
            sub.append(entry)
        for p in moved:
            # 🔴 分包 pages 是**相对 root** 的路径，必须保留模块子目录：
            #   `pages/metrics/impact` + root `subpkg/tools` ⇒ `metrics/impact`（不是 `impact`）。
            #   第一次写成 p[len(old_dir)+1:] 会丢掉 `metrics/`，导致 app.json 指向不存在的页。
            rel_inside = p[len("pages/"):] if p.startswith("pages/") else p
            if rel_inside not in entry["pages"]:
                entry["pages"].append(rel_inside)
        app2["subpackages"] = sub
        app2.pop("subPackages", None)
        write(os.path.join(ROOT, "app.json"), json.dumps(app2, ensure_ascii=False, indent=2) + "\n")
        print("[4/4] app.json 已更新（主包 pages %d 个，分包 %s 含 %d 页）"
              % (len(app2["pages"]), root, len(entry["pages"])))
    except Exception as e:
        print("[失败] app.json 更新失败：%s" % e)
        print("⚠️ 文件已移动、引用已替换，但 app.json 未更新 ⇒ 小程序会崩。"
              "请执行 `git reset --hard HEAD` 后重来。")
        sys.exit(4)

    print("\n[完成] 请跑门禁：node verify_all.js（或 Python 驱动）")


main()
