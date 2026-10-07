# -*- coding: utf-8 -*-
"""R232e · 刷新路线单（只动三类：标题/当前基线 · 现状快照 · 追记段追加）
纪律：历史交付条目里的门禁数一律不动（那是交付当时的实测值）。
两阶段：先全部断言锚点唯一命中，全过才统一落盘。
"""
import io, sys

P = "review/ROADMAP_2026-09-30_下一步总览.md"
raw = io.open(P, encoding="utf-8", newline="").read()

PATCHES = []

# ---- ① 文首标题 + 基线行 ----
PATCHES.append((
    "# ROADMAP · 下一步总览（2026-09-30 建立；2026-10-01 R181p 更新）",
    "# ROADMAP · 下一步总览（2026-09-30 建立；2026-10-07 R232e 更新）",
))

# ---- ② 基线行（第 5 行）----
old_base = ("> **基线（R181p 刷新，2026-10-01 10:42）**：`dev@7171002`，工作区干净，门禁 **123/123 · RC=0 · 真 FAIL=0**。")
new_base = ("> **基线（R232e 刷新，2026-10-07 08:5x）**：`dev@bedbeac`，工作区干净，门禁 **148/148 · RC=0 · 真 FAIL=0**。")
PATCHES.append((old_base, new_base))

# ---- ③ 「套件数会漂」行 ----
old_drift = ("> 🔴 **套件数会漂**：R185 起已 **125**（`verify_all.js` 头注「串联：125 个套件」，R59 自校验保证 ≡ `SUITES.length`）。\n"
             "> ⇒ 下文出现「123/123」处 = **R181p 时点的历史值**（不改，免造假）；**判当下是否合格一律以 125/125 为准**。")
new_drift = ("> 🔴 **套件数会漂**：R232d 起已 **148**（`verify_all.js` 头注「串联：148 个套件」，R59 自校验保证 ≡ `SUITES.length`）。\n"
             "> ⇒ 下文出现「123/123」「125/125」「145/145」处 = **各自时点的历史值**（不改，免造假）；**判当下是否合格一律以 148/148 为准**。")
PATCHES.append((old_drift, new_drift))

# ---- ④ 现状快照标题 + HEAD 行 + 门禁行 ----
PATCHES.append((
    "## 一 现状快照（2026-10-01 R181p 复核，非推断）",
    "## 一 现状快照（2026-10-07 R232e 复核，非推断）",
))
PATCHES.append((
    "| 分支 / HEAD | `dev` @ `7171002` | `git rev-parse HEAD` |",
    "| 分支 / HEAD | `dev` @ `bedbeac`（已推送 ≡ 远端） | `git rev-parse HEAD` / `git ls-remote origin refs/heads/dev` |",
))
PATCHES.append((
    "| 门禁 | **123/123 · RC=0 · 真 FAIL=0**（🔴 R181p 时点值；**当下基线 125/125**，见文首「套件数会漂」） | `review/evidence/r181p_pack_guard/gate_181p_1.txt`（最终树复跑 `_2.txt`） |",
    "| 门禁 | **148/148 · RC=0 · 真 FAIL=0**（🔴 R181p 时点值为 123/123；**当下基线 148/148**，见文首「套件数会漂」） | `review/evidence/r232_formc_sample/gate_formc148.txt` |",
))

# ---- ⑤ 云函数上云行 ----
PATCHES.append((
    "| 云函数上云 | 🟢 **本地 43 ≡ 云端 43**（`diff` 零差异）；`importSalesBill` 已上云（`filesCount=18` ≡ 磁盘） | `review/evidence/r181l_stage1_import_feed/deploy/local_vs_cloud.txt` |",
    "| 云函数上云 | 🟢 **R232e：`getDishReview` 首次上云（17 ≡ 17）· `importSalesBill` 重部署（19 ≡ 19）**；⚠️ `getDishReview` 云端 `timeout=3` 待抬到 20 | `review/evidence/r232e_deploy/` |",
))

# ---- ⑥ 追加 R230~R232e 追记段（在 R229 段末尾之后 = 文件末尾追加）----
APPEND = io.open("_roadmap_r232e_append.md", encoding="utf-8").read()

# ================= 两阶段 =================
fails = []
for i, (old, new) in enumerate(PATCHES):
    c = raw.count(old)
    if c != 1:
        fails.append("补丁#%d 锚点命中 %d 次（须恰好 1）: %s" % (i, c, old[:60]))

if fails:
    print("❌ 锚点校验未过，整体不写：")
    for f in fails:
        print("   ", f)
    sys.exit(1)

print("✅ 全部 %d 个补丁锚点各命中 1 次，开始落盘" % len(PATCHES))
for old, new in PATCHES:
    raw = raw.replace(old, new, 1)
raw = raw.rstrip("\n") + "\n" + APPEND

io.open(P, "w", encoding="utf-8", newline="").write(raw)
print("✅ 已写入 %s" % P)
