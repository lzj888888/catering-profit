# -*- coding: utf-8 -*-
"""S2 守卫适配第二批：提审材料路径 + 页面全集 + 扫描面"""
import io, glob, re

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/"

# 1) 提审材料：三个模块的路径
p = ROOT + "specs/dev-specs/上线材料_提审材料包_v1.md"
s = io.open(p, encoding="utf-8", newline="").read()
cnt = 0
for m in ("card", "material", "takeaway"):
    old = "pages/%s/" % m
    cnt += s.count(old)
    s = s.replace(old, "subpkg/biz/%s/" % m)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("[1] 提审材料替换 %d 处" % cnt)

# 2) check_material_batch：页面全集 = 主包 + 分包
p = ROOT + "tools/check_material_batch.js"
s = io.open(p, encoding="utf-8", newline="").read()
old = "try { appPages = JSON.parse(read('app.json')).pages || []; } catch (e) { appPages = []; }"
new = ("try {\n"
       "  // R423 分包化：页面全集 = 主包 + 分包展开（旧写法只取 pages ⇒ 分包页被判未注册）\n"
       "  const _a = JSON.parse(read('app.json'));\n"
       "  const _sub = [].concat.apply([], ((_a.subpackages || _a.subPackages) || []).map(function (sp) {\n"
       "    var r = String(sp.root || '').replace(/\\/+$/, '');\n"
       "    return (sp.pages || []).map(function (x) { return r ? r + '/' + x : x; });\n"
       "  }));\n"
       "  appPages = (Array.isArray(_a.pages) ? _a.pages : []).concat(_sub);\n"
       "} catch (e) { appPages = []; }")
if new in s:
    print("[2] 跳过（已改）")
elif old in s:
    io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
    print("[2] check_material_batch 页面全集已改")
else:
    print("[2] 未命中！")

# 3) check_input_keyboard：扫描面
p = ROOT + "tools/check_input_keyboard.js"
s = io.open(p, encoding="utf-8", newline="").read()
found = False
for pat, rep in [
    ("const SCAN_DIRS = ['pages'];", "const SCAN_DIRS = ['pages', 'subpkg'];"),
    ("path.join(ROOT, 'pages')", "path.join(ROOT, 'pages')"),
]:
    if pat in s and "R423" not in s:
        s = s.replace(pat, rep, 1)
        found = True
if found:
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print("[3] check_input_keyboard 扫描面已改")
else:
    print("[3] 需手工看（未命中常见模式）")
