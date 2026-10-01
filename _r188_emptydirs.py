# -*- coding: utf-8 -*-
"""R188：扫全仓空目录（排除 .git / node_modules），打印并按需删除（仅空目录，非空会报错）
用法： python _r188_emptydirs.py [--apply]
"""
import os, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
APPLY = "--apply" in sys.argv
SKIP_TOP = {".git", "node_modules"}

empties = []
for d, dirs, files in os.walk(ROOT, topdown=True):
    dirs[:] = [x for x in dirs if x not in SKIP_TOP]
    if files:
        continue
    # 仅当所有子目录也为空（即无后代）才判定为空目录 —— os.walk 自底向上更简单，这里改用二次判定
    empties.append(d)

# 自底向上：真正"无后代文件"的目录
deep = []
for d, dirs, files in os.walk(ROOT, topdown=False):
    if os.path.abspath(d) == os.path.abspath(ROOT):
        continue
    rel = os.path.relpath(d, ROOT)
    parts = rel.split(os.sep)
    if any(p in SKIP_TOP for p in parts):
        continue
    has_file = False
    for _, _, fs in os.walk(d):
        if fs:
            has_file = True
            break
    if not has_file:
        deep.append(d)

deep.sort(key=lambda d: (-d.count(os.sep), d))  # 深的先删，否则父目录因还有子目录而失败
print("=== 无后代文件的空目录（%d 个）===" % len(deep))
for d in deep:
    print("   ", os.path.relpath(d, ROOT))

if not APPLY:
    print("(dry-run；加 --apply 删除)")
    sys.exit(0)

print()
print("=== 删除 ===")
done, fail = 0, []
for d in deep:
    try:
        os.rmdir(d)
        done += 1
    except Exception as e:
        fail.append((d, repr(e)))
print("删除成功:", done, "失败:", len(fail))
for d, why in fail:
    print("   FAIL", os.path.relpath(d, ROOT), why)
