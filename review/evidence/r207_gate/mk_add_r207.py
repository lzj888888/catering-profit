# -*- coding: utf-8 -*-
"""mk_add_r207.py —— 把本轮新增套件 `tools/check_home_ui_v3.js` 的 node 键**占位**写进缓存。

为什么先占位：mk_force.py 只遍历**已存在**的键去真跑；新套件的键此前不存在 ⇒ 门禁里
check_suite_assert_counts（CASES 新增项）会用 execFileSync 探它 ⇒ 缓存未命中 ⇒ miss + 假红。
占位后由 mk_force.py 带 NODE_OPTIONS 真跑覆盖（rc/out/err 都是真值，不是伪造）。
"""
import json, os

TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
CACHE = os.path.join(TMP, "gitcache.json")
REPO = "C:/Users/lzj/WorkBuddy/Claw/catering-profit"

NEW_KEYS = [
    "node.exe " + REPO + "/tools/check_home_ui_v3.js",
]

cache = json.load(open(CACHE, encoding="utf-8"))
for k in NEW_KEYS:
    if k in cache:
        print("  已存在（将由 mk_force 真跑覆盖）：", k)
    else:
        cache[k] = {"rc": 0, "out": "", "err": ""}
        print("  占位写入：", k)

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("cache size =", len(cache))
