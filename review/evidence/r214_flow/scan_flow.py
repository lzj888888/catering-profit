# -*- coding: utf-8 -*-
"""scan_flow.py —— R214 小程序「页面 → 云函数 → 集合」全链路静态通跑扫描。

不依赖任何测试框架，只做事实抽取 + 差集，输出 JSON + 人读 TXT。
判据口径：
  ① 前端调用面（pages/ + miniprogram/ 下 .call('fn')）↔ 云函数目录  → 调用了不存在的函数 / 孤儿函数
  ② 页面跳转面（url:/switchTab/navigateTo/reLaunch/redirectTo）↔ app.json pages → 死链 / tabBar 页被错跳
  ③ 孤儿页面（app.json 声明了但全仓无任何跳转指向，且不在 tabBar）
  ④ 云函数引用的集合名（db.collection('x')）全集
  ⑤ 页面 ↔ 调用 的矩阵（每页调了哪些云函数）
"""
import os, re, json, collections

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
OUT = os.path.join(REPO, "review/evidence/r214_flow")
os.makedirs(OUT, exist_ok=True)

def rd(p):
    try:
        return open(p, encoding="utf-8", errors="replace").read()
    except Exception:
        return ""

def rel(p):
    return os.path.relpath(p, REPO).replace("\\", "/")

app = json.loads(rd(os.path.join(REPO, "app.json")))
pages = app["pages"]
tabpages = [t["pagePath"] for t in app.get("tabBar", {}).get("list", [])]

cfdir = os.path.join(REPO, "cloudfunctions")
cf_all = sorted(d for d in os.listdir(cfdir) if os.path.isdir(os.path.join(cfdir, d)))
cf_fns = [d for d in cf_all if d not in ("common", "_adminCore")]

# ---------- 扫描面：pages/ + miniprogram/ 下的 js/wxml ----------
scan_files = []
for base in ("pages", "miniprogram"):
    for root, _, files in os.walk(os.path.join(REPO, base)):
        for f in files:
            if f.endswith((".js", ".wxml")):
                scan_files.append(os.path.join(root, f))
# utils/ 也算（api.js 里可能有兜底调用）
for root, _, files in os.walk(os.path.join(REPO, "utils")):
    for f in files:
        if f.endswith(".js"):
            scan_files.append(os.path.join(root, f))

CALL_RE = re.compile(r"\.call\(\s*['\"`]([A-Za-z_][A-Za-z0-9_]*)")
calls = collections.defaultdict(list)      # fn -> [file:line]
page_calls = collections.defaultdict(set)  # page -> {fn}
for p in scan_files:
    if not p.endswith(".js"):
        continue
    r = rel(p)
    for i, ln in enumerate(rd(p).splitlines(), 1):
        for m in CALL_RE.finditer(ln):
            fn = m.group(1)
            calls[fn].append("%s:%d" % (r, i))
            parts = r.split("/")
            if parts[0] == "pages":
                page_calls["/".join(parts[:3])].add(fn)

called = set(calls)
missing_fns = sorted(called - set(cf_fns))       # 调了但不存在
unused_fns = sorted(set(cf_fns) - called)        # 存在但零调用

# ---------- 跳转面 ----------
# 🔴 R214 修正：本仓跳转有两种形态 —— `url: '/pages/x'`（wx.navigateTo/switchTab/redirectTo）
#   与 `this.go('/pages/x?...')`（页面自定义包装）。首版只匹配前者 ⇒ 把 assetEdit 误判成孤儿页。
URL_RE = re.compile(r"""(?:url\s*:\s*|go\(\s*|navigateTo\(\s*|switchTab\(\s*)['"`](/pages/[A-Za-z0-9_/]+)""")
jumps = collections.defaultdict(list)  # target -> [file:line]
for p in scan_files:
    r = rel(p)
    for i, ln in enumerate(rd(p).splitlines(), 1):
        for m in URL_RE.finditer(ln):
            jumps[m.group(1).lstrip("/")].append("%s:%d" % (r, i))

jump_targets = set(jumps)
bad_targets = sorted(t for t in jump_targets if t not in pages)
# tabBar 页被非 switchTab 跳（粗判：出现 url: 且同时含 navigateTo/reLaunch/redirectTo）
tab_hit = []
for p in scan_files:
    if not p.endswith(".js"):
        continue
    r = rel(p)
    txt = rd(p)
    for i, ln in enumerate(txt.splitlines(), 1):
        m = URL_RE.search(ln)
        if m and m.group(1).lstrip("/") in tabpages:
            for api in ("navigateTo", "reLaunch", "redirectTo"):
                if api in ln:
                    tab_hit.append("%s:%d → %s (%s)" % (r, i, m.group(1), api))

orphan_pages = sorted(pg for pg in pages if pg not in jump_targets and pg not in tabpages)

# ---------- 集合引用 ----------
COLL_RE = re.compile(r"""collection\(\s*['"`]([a-z_][a-z0-9_]*)""")
colls = collections.defaultdict(set)
for d in cf_fns + ["common"]:
    base = os.path.join(cfdir, d)
    for root, _, files in os.walk(base):
        for f in files:
            if f.endswith(".js"):
                for m in COLL_RE.finditer(rd(os.path.join(root, f))):
                    colls[m.group(1)].add(d)

result = {
    "auth_guard": {
        "no_guard_at_all": [d for d in cf_fns
                            if "assertShopOwner" not in rd(os.path.join(cfdir, d, "index.js"))
                            and "resolveAuth" not in rd(os.path.join(cfdir, d, "index.js"))
                            and "adminAuth" not in rd(os.path.join(cfdir, d, "index.js"))],
        "reads_own_ctx_only": [d for d in cf_fns
                               if "resolveAuth" in rd(os.path.join(cfdir, d, "index.js"))
                               and "assertShopOwner" not in rd(os.path.join(cfdir, d, "index.js"))],
    },
    "pages_count": len(pages),
    "tabbar_pages": tabpages,
    "cloudfunctions_count": len(cf_fns),
    "call_sites_total": sum(len(v) for v in calls.values()),
    "distinct_fns_called": len(called),
    "missing_fns__called_but_not_exists": missing_fns,
    "unused_fns__exists_but_never_called": unused_fns,
    "jump_targets_total": len(jump_targets),
    "bad_jump_targets": bad_targets,
    "tabbar_page_bad_jump": tab_hit,
    "orphan_pages__no_inbound": orphan_pages,
    "collections_referenced": {k: sorted(v) for k, v in sorted(colls.items())},
    "page_calls": {k: sorted(v) for k, v in sorted(page_calls.items())},
    "calls_detail": {k: v for k, v in sorted(calls.items())},
}
json.dump(result, open(os.path.join(OUT, "scan_flow.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

L = []
L.append("=== R214 全链路静态扫描 ===")
L.append("页面数(含 tab) = %d ；tabBar = %s" % (len(pages), tabpages))
L.append("云函数数 = %d ；调用点 = %d 处 / 去重函数 %d 个" % (len(cf_fns), result["call_sites_total"], len(called)))
L.append("")
L.append("[A] 调用了但**不存在**的云函数（真断链）：%s" % (missing_fns or "无"))
L.append("[B] 存在但**零前端调用**的云函数（%d）：%s" % (len(unused_fns), unused_fns))
L.append("")
L.append("[C] 跳转目标不存在的页面（真死链）：%s" % (bad_targets or "无"))
L.append("[D] tabBar 页被 navigateTo/reLaunch/redirectTo 跳（应为 switchTab）：%s" % (tab_hit or "无"))
L.append("[E] 孤儿页面（无任何跳转指向、非 tabBar）：%s" % (orphan_pages or "无"))
L.append("")
L.append("[F] 云函数引用的集合共 %d 个" % len(colls))
L.append("")
L.append("[H] 无任何鉴权痕迹（无 assertShopOwner / resolveAuth / adminAuth）：%s" % result["auth_guard"]["no_guard_at_all"])
L.append("[I] 仅 resolveAuth（只认身份、不校验店铺归属）：%s" % result["auth_guard"]["reads_own_ctx_only"])
L.append("")
L.append("[G] 每页调用的云函数：")
for pg, fns in sorted(page_calls.items()):
    L.append("   %-22s → %s" % (pg, ", ".join(sorted(fns))))
open(os.path.join(OUT, "scan_flow.txt"), "w", encoding="utf-8").write("\n".join(L))
print("\n".join(L))
