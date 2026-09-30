# -*- coding: utf-8 -*-
"""R181j 路线单刷新补丁（两阶段：先全部断言命中==1，再统一落盘）。"""
import io, sys, hashlib

P = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/ROADMAP_2026-09-30_下一步总览.md"

with io.open(P, "r", encoding="utf-8", newline="") as f:
    raw = f.read()

before_md5 = hashlib.md5(raw.encode("utf-8")).hexdigest()
crlf = raw.count("\r\n")
lf = raw.count("\n") - crlf
print("BEFORE md5=%s  chars=%d  crlf=%d  lf=%d" % (before_md5, len(raw), crlf, lf))

EDITS = [
    # ── 头部基线 ──
    ("> **基线（R181i 刷新，2026-09-30 20:5x）**：`dev@7a1830c`，工作区干净，门禁 **118/118 · RC=0 · 真 FAIL=0**。",
     "> **基线（R181j 刷新，2026-09-30 23:5x）**：`dev@7de3d7e`，工作区干净，门禁 **120/120 · RC=0 · 真 FAIL=0**。"),

    # ── 〇 一句话结论 ──
    ("## 〇 一句话结论（R181i 更正）",
     "## 〇 一句话结论（R181j 更正）"),
    ("- 门禁 **118/118 · 真 FAIL=0**、工作区干净 ⇒ **主干无债**。",
     "- 门禁 **120/120 · 真 FAIL=0**、工作区干净 ⇒ **主干无债**。"),
    ("- 🔵 **下一个可投喂批次 = M3.19（原料变动与影响面）/ M3.21（率对率对账）**（v1.2 §9；M3.17 已消化）。",
     "- 🟢 **M3.19 原料变动影响面 + M3.21 M1↔M3 率对率对账已交付并验收**（2026-09-30 23:4x，InsCode 批次 E + 我方 `7de3d7e`）：\n"
     "  单源 `utils/reconDerive.js`（纯计算、不落库、不进云函数）+ 新页 `pages/recon/index`（M1↔M3 率对率）\n"
     "  + 新页 `pages/metrics/impact`（复用 `syncCostCard` 新增**只读 dry-run 分支**，扫全店卡按最新价复算并标「跌破参考带下限」）。\n"
     "  红线三条全过、门禁 **120/120 · 真 FAIL=0**、锚点**独立复算 31/0**、**变异回灌 8/8 有效红**；\n"
     "  验收同时抓到并修掉 **3 个真缺陷**（无牌价卡被误标跌破 / recon 孤岛页无入口 / 金额框与按钮同层破 A1）——见 `review/evidence/r181j_m319_m321_feed/README.md` §八。\n"
     "- 🔵 **下一批投喂候选**（需李老师点头，一个批次 ≈ 20 元）：M3.33 复盘落库（**先裁决落库方案**）／数据可信度**甲级门禁**／二期规则模块（菜单评分等）。"),

    # ── 一 现状快照 ──
    ("## 一 现状快照（2026-09-30 R181i 实测，非推断）",
     "## 一 现状快照（2026-09-30 R181j 实测，非推断）"),
    ("| 分支 / HEAD | `dev` @ `7a1830c` | `git rev-parse HEAD` |",
     "| 分支 / HEAD | `dev` @ `7de3d7e` | `git rev-parse HEAD` |"),
    ("| 门禁 | **118/118 · RC=0 · 真 FAIL=0** | `review/evidence/r181i_m317_accept/gate_native_4_postcommit.txt` |",
     "| 门禁 | **120/120 · RC=0 · 真 FAIL=0** | `review/evidence/r181j_m319_m321_feed/gate_181j_3_precommit.txt` |"),
    ("| 页面 | `card` / `index` / `material` / `mine` / `month` / `pay` / `sandbox` / `shop` / **`takeaway`** | `ls pages/` |",
     "| 页面 | `card` / `index` / `material` / **`metrics`** / `mine` / `month` / `pay` / **`recon`** / `sandbox` / `shop` / `takeaway`（共 **21 页**） | `ls pages/`；提审材料 §4 |"),
    ("| **M3.19 / M3.21** | 🔴 **未做**（下一批候选） | R181i grep |",
     "| **M3.19 / M3.21** | 🟢 **已交付已验收**（`7de3d7e`；单源 `utils/reconDerive.js` + `pages/recon/*` + `pages/metrics/impact`；`selftest_m3_impact` 17/0 · `selftest_m3_recon` 16/0；锚点独立复算 **31/0**、变异 **8/8**；修 3 个真缺陷） | R181j 实测 |"),

    # ── 三 B 线 ──
    ("| **6** | **M3.19 原料变动与影响面 / M3.21 率对率对账** | 见 v1.2 §9；规范口径已定 | 🔵 **下一个可投喂** |",
     "| ~~**6**~~ | ~~**M3.19 原料变动与影响面 / M3.21 率对率对账**（v1.2 批次 E）~~ | 单源 `utils/reconDerive.js` + `pages/recon/*` + `pages/metrics/impact`（`syncCostCard` 只读 dry-run）；不落库 | ✅ **已完成**（InsCode 批次 E + 我方 `7de3d7e`；门禁 **120/120 · 真 FAIL=0**、锚点独立复算 **31/0**、变异 **8/8**；修 3 个真缺陷；验收见 `review/evidence/r181j_m319_m321_feed/`） |"),
    ("| 6 | 数据可信度**甲级门禁** | 通道连通 + Schema 校验 + 关键指标非空，不过直接阻断 | R168 §16 已定甲级先做、零 AI 依赖 |",
     "| **7** | 数据可信度**甲级门禁** | 通道连通 + Schema 校验 + 关键指标非空，不过直接阻断 | 🔵 **下一批候选**（R168 §16 已定甲级先做、零 AI 依赖） |"),
    ("| 6 | 二期规则模块（菜单评分 / 活动沙盘 / 套餐定价反推） | 8/9 项是规则引擎，**不是 LLM** | 视商业化节奏 |",
     "| **8** | 二期规则模块（菜单评分 / 活动沙盘 / 套餐定价反推） | 8/9 项是规则引擎，**不是 LLM** | 视商业化节奏 |"),

    # ── 四 执行顺序 ──
    ("1. **✅ 刚完成（我）**：**M3.17 + M3.32 验收闭环** —— 门禁 **118/118 · 真 FAIL=0**、锚点独立复算 **31/0**、变异 **7/7 有效红**；补三处同步面 + 修真缺陷（新页 AD 门禁）",
     "1. **✅ 刚完成（我）**：**M3.19 + M3.21（批次 E）验收闭环** —— 门禁 **120/120 · 真 FAIL=0**、锚点独立复算 **31/0**、变异 **8/8 有效红**；补三处同步面（套件数 118→120 六处级联）+ 修 **3 个真缺陷**"),
    ("2. **✅ 已完成（我）**：**C3 / C4 已由我键鼠代办**（42/42 timeout 回读 + 线上索引 45/45），李老师无需再动手",
     "2. **✅ 已完成**：**M3.17/M3.32（`7a1830c`）· C3/C4（键鼠代办 42/42 + 索引 45/45）**，李老师无需再动手"),
    ("3. **现在（我）**：准备并**投喂下一批**（M3.19 / M3.21；规范 v1.2 §9）—— 需李老师点头（一个批次 ≈ **20 元**）",
     "3. **现在（我）**：**准备下一批投喂包**（候选：M3.33 复盘落库需先裁决方案 / 甲级门禁 / 二期规则模块）—— 需李老师点头（一个批次 ≈ **20 元**）"),
    ("6. **闭环纪律**：B 线每一批回来都必须「门禁 **118/118** + **真值复算（独立 require 生产引擎）** + 双向变异回灌」，不合格不提交",
     "6. **闭环纪律**：B 线每一批回来都必须「门禁 **120/120** + **真值复算（独立 require 生产引擎）** + 双向变异回灌」，不合格不提交"),
    ("> **纪律**：B 线每一批回来都必须「门禁 118/118 + 真值复算 + 双向变异回灌」，不合格不提交。",
     "> **纪律**：B 线每一批回来都必须「门禁 120/120 + 真值复算 + 双向变异回灌」，不合格不提交。"),

    # ── 六 环境事实标题补 R181j 复核 ──
    ("## 六 环境事实（R181i 新增 · 影响每轮跑门禁的方式）",
     "## 六 环境事实（R181i 新增 / R181j 复核 · 影响每轮跑门禁的方式）"),
    ("⇒ 本轮门禁**原生直接跑** `node verify_all.js`（rc=0 / 118 套件 118 通过），",
     "⇒ 本轮门禁**原生直接跑** `node verify_all.js`（rc=0；R181i 为 118 套件 / R181j 为 **120 套件 120 通过**），"),
]

# 全文件主导行尾（用于新文本的换行符保持一致）
EOL = "\r\n" if crlf > lf else "\n"
print("主导行尾 =", repr(EOL))

# ── 阶段一：全部断言命中 == 1，命中数不对就整体不落盘 ──
# 注意：所有 old 锚点均为「单行」，故不受行尾影响；只校验命中唯一性。
fails = []
for old, new in EDITS:
    n = raw.count(old)
    if n != 1:
        fails.append("命中 %d 次：%s" % (n, old[:70]))
    if new.count("\n"):
        pass  # 多行新文本，落盘时统一换行符
if fails:
    print("!! 阶段一失败，未落盘（零损失）：")
    for x in fails:
        print("   -", x)
    sys.exit(2)
print("阶段一 OK：%d 处锚点全部命中唯一" % len(EDITS))

# ── 阶段二：统一落盘 ──
out = raw
for i, (old, new) in enumerate(EDITS, 1):
    n = out.count(old)
    assert n == 1, "锚点 %d 阶段二命中 %d 次（不应发生）" % (i, n)
    out = out.replace(old, new.replace("\n", EOL), 1)

with io.open(P, "w", encoding="utf-8", newline="") as f:
    f.write(out)

after_md5 = hashlib.md5(out.encode("utf-8")).hexdigest()
print("AFTER  md5=%s  chars=%d (+%d)" % (after_md5, len(out), len(out) - len(raw)))
