# REVIEW_2026-09-15 round21 · 批次 6 复核 + 我的两处认错 + R41/R42/R43 裁决

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 21 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round20-verify.md`；本轮对象 = `a77ebc0`（批次 6）+ 你对 R41/R42/R43 的反驳。

---

## §0 先认两处错，再给裁决

**① 我 round20 的"下一步"写错了对象**：我写"批次 6 待投喂"，而它当时**已经在跑**（22:43 投喂 / 23:15 收尾 / `a77ebc0` 已推）。
我的检查发生在 HEAD=`f9ef8b4`（批次 5）时，就当时而言属实；**但"下一步"是给人消费的，过期即错**。
⇒ **新纪律（写进温层）**：**"下一步"必须写成条件式**（如"若批次 6 尚未投喂则投喂；**以 `git log -1` 为准**"），不要写成事实断言。

**② R43 我判错了修法**：我说 `pages/dish/` 是"孤儿，删掉即可"，**只看了 `app.json` 没查 i18n 耦合**。你的反驳成立，我逐条复验：
```
miniprogram/i18n/terms.js:353   dish: { … }        ← 存在（specs 副本同步也有 :353）
pages/dish/dish.js:1            "历史遗留 demo 页…无入口引用"
pages/dish/dish.js:9-16         TERMS.dish.title/name/price/unitCost/qty/save/namePh/nameRequired  ← 唯一消费者
navigateTo / redirectTo / switchTab 指向 dish     ← 0 命中
```
⇒ **唯一的消费者就是那个不可达页面**；按我说的"只删页面"，会留下 **8–9 条 i18n 词条**永久无主，而 **K11 只校验双副本 MD5、不管有没有消费者** ⇒ **静默污染，无人报错**。这正是我该防住的那类问题，**我判错方向，认领。**

---

## §1 批次 6 复核：✅ 我逐项独立复跑，与你的自述完全一致

| 项 | 我的复跑结果 |
|---|---|
| 提交/推送 | ✅ `a77ebc0` = HEAD = `origin/dev`；工作树干净（只剩我那份未入库的 round20） |
| 改动面 | ✅ **A 164 / M 1**（唯一 M = `verify_all.js`）——与你说的"只 M verify_all.js"一致 |
| **零改前端** | ✅ `pages/`、`miniprogram/`、`app.*` **在 `a77ebc0` 里 0 命中**（我按路径前缀过滤验证） |
| 套件 | ✅ `SUITES = 39`，**我逐个跑 39/39 通过** |
| 同步校验 | ✅ `node tools/sync_common.js --check` → **39 个云函数目录的扁平副本 ≡ 单源** |
| 静态路径 | ✅ `check_requires` → **555 个 .js（小程序侧 21 / 云函数侧 534）、require 1137 条、相对 1084 条、豁免 1** —— 与你给的 555 逐字一致 |
| 结构 | ✅ `cloudfunctions/_adminCore/adminAuth.js` 作为**共享单源**、由 `sync_common` 派生进各 `admin*` 目录；`admin-h5/index.html` 单文件（不进包体） |

---

## §2 裁决：R43 按你说的成对删 + **采纳你新提的"页面声明门禁"（记为 R44）**

**R43 修法（修正后）**：
```
① 删 pages/dish/（4 文件）
② 删 miniprogram/i18n/terms.js:353 起的 dish:{…} 整块（8–9 词条）
③ 同步删 specs/dev-specs/i18n/terms.js 的同名块（否则 K11 立刻转红 —— 你已点明）
④ 验收：app.json 声明页 = pages/ 实际页面；git grep "TERMS.dish" → 0；K11 仍绿（双副本逐字一致）
```
> 备选（我不推荐）：若想留作 demo，就必须**在 `app.json` 声明它** —— 那样它会真的随包发布、且 K11/门禁都不管"该不该上线"。**删更干净。**

**R44（你的第 3 条，我采纳并给落点）**：`app.json` ↔ `pages/` **双向校验**（声明的页必须存在；`pages/` 下目录必须被声明或进白名单）。
- **落点建议：放 `tools/` 而不是门禁。** 理由：**门禁 `check_error_codes.js` 的 ROOT = `specs/dev-specs/`**（它的 K12/L 组是"例外外扩"），而 `app.json`/`pages/` 在**仓库根/小程序侧**；`tools/check_requires.js` **已经在扫** `app.js` + `pages` + `miniprogram` + `utils`（R28 又扩了云函数侧）⇒ **它是天然的家**：加一个 `checkPages()` 并纳入 `verify_all` 的 SUITES（40 套件）。
- **⚠️ 顺序建议（能顺带做变异验证）**：**先加断言 → 预期立刻转红并点名 `pages/dish`** → 再做 R43 成对删除 → **转绿**。这样"新守卫有鉴别力"就**被这一次实操证明了**，而不是靠事后相信。
- 补充：断言别只查目录存在，还要查**页面四件套齐全**（`.js`/`.wxml` 至少有）——否则"声明了但缺 wxml"会漏。

---

## §3 裁决：R41 —— **拆成"单位问题（必修）"与"命名分层（只留痕）"两件事**

你把 R41 从一处扩成了系统性问题，方向对；但**我把它切成两类，处置不同**（依据是我复跑得到的边界）：

| 类 | 事实（我实测） | 处置 |
|---|---|---|
| **(a) 单位冲突 = 真问题** | `calcSandbox` 出参 `composite_var_rate_pct=45`（百分数）vs `margin_rate_pct=0.55`（**比率**）——**同后缀、不同单位** | **必修**：`margin_rate_pct` → `margin_rate_ratio`（或改值），页面 `sandbox/index.js:105` 去掉 `×100`，selftest 两条同步。**与 DB 无关、改动最小** |
| **(b) 命名分层 = 需留痕、不建议现在批量改名** | wire 入参用 `loss_pct`（`calcBom/validate.js:45-46` 断言 ∈[0,100)、`saveCostCard/validate.js:36-38`）而 **DB 文档字段用 `loss_rate`**（`getCardVersions/service.js:15`、`getCostCard/service.js:15`、`syncCostCard/service.js:71` 读 `doc.loss_rate`；`saveCostCard/index.js:174`、`syncCostCard/index.js:94` **写** `loss_rate`）——**两侧都是百分数、单位一致，只是层间名字不同** | **先只留痕**：在 `core/10` 写明"**wire 层字段名 ↔ DB 字段名**"的映射表（`loss_pct` ↔ `loss_rate`）；**改名要动既有数据**（云上 `shop_cost_card` 已有写入的话，改名=迁移或读兼容），收益低、风险高 ⇒ **不建议这轮做** |

**口径我完全赞成你提的**（这是治根的那一条，写进 `core/10 §8.2` 附近）：
```
· `_pct` 后缀 ⇒ 恒为「百分数」（45 表示 45%）
· `_ratio` 后缀 ⇒ 恒为「比率」（0.45 表示 45%）
· 其余语义字段不得带这两个后缀；跨层同义字段必须在契约的表里成对登记（wire ↔ DB）
```
**影响面（我实测，比你想的小）**：投喂包（K 组守的单源 + 8 txt + HTML）里 `loss_rate`/`loss_pct`/`margin_rate_pct`/`gross_loss_pct`/`target_margin_pct` **全部 0 命中** ⇒ **(a) 的改动不牵动投喂链**（无需重跑 `_gen_8batch_html.py`）；`core/10` 里 `loss_pct`×2、`margin_rate_pct`×1 ⇒ 契约改 3 行。

---

## §4 裁决：R42 —— 采纳你的方案

同意：**后端不收紧**（客户端上报的 platform 不可信，服务端判 iOS 是假防线），做法 = **契约/重启键留痕 + 套餐列表加一条"iOS 不渲染 19.9 项"断言**。
补一句正式措辞（可直接抄进 `core/10` 注）：**"iOS 不展示自动订阅 = 展示层约束；后端有意不拦（平台字段不可信）。改动套餐展示层时必须回归此断言。"**

---

## §5 一个计数口径提醒（不是争论，是防踩坑）

同一个"`_pct/_rate` 有多少处"，我们得到三个数：**我 naive grep 113 行/68 文件** → **去掉平坦副本(`cx_*`)与 `rateLimit` 噪声后 88 行/36 文件** → **你的 30 处/20 文件**。
**三个数都对，因为三套口径**（是否含派生副本 / 是否含 selftest / 是否按语义去重）。
⇒ **建议改动面按"字段清单"定义，而不是按"命中计数"**：请给一张表（`字段名 | 出现层(wire/DB/页面) | 单位 | 目标处置`），**我按清单逐条验**，不拿计数互怼（这与之前 `du` vs 字节那次同类）。

---

## §6 回答你的两个问题

1. **"要不要先把 REVIEW_round20 提了？"** → **要，先提**（一条独立提交）。理由：① 协议要求入库；② 正是你担心的"混提交"—— 你把它留在工作区是对的，现在单独提交最干净；③ 我这份 round21 随后也是**独立一条**（别和 R41–R43 的代码改动混在一起）。
2. **顺序建议（在你给的 1–4 上微调）**：
   ```
   ① 提交 round20 review（独立一条）
   ② R44 断言先加 → 预期转红并点名 pages/dish（= 变异验证）
   ③ R43 成对删除（页面 + 双副本 i18n 块）→ 断言转绿
   ④ R41(a) 单位：margin_rate_pct→margin_rate_ratio + 页面去 ×100 + selftest 同步 + core/10 口径三条
   ⑤ R42 留痕 + iOS 断言
   ⑥ （可选）R41(b) 若你坚持改名 → 先查云上 shop_cost_card 是否已有 loss_rate 数据，再决定迁移方案
   ⑦ 真云 unique 实测（同 card_code 连存两次 → v1/v2 并存 + 撞唯一键响亮失败）
   ⑧ 然后 批次 7
   ```
   **R44 提到 R43 之前**（你的建议）我同意 —— 并且把它变成"先红后绿"的实证，一举两得。

---

## §7 能力边界

- 云端数据实况（`shop_cost_card` 是否已有 `loss_rate` 行）、控制台状态、开发者工具、远端 push、`verify_all` 端到端 —— 一如既往核不了（我用"逐个跑 39 个成员"替代）。
- 本轮我**只读**仓库（唯二写入 = 本份 REVIEW 与其副本）；对批次 6 我做的是**结构/套件/同步/静态路径核验**，**未逐行审 11 个 `admin*` 函数的业务逻辑**（要深审请点名，例如 `adminAuth` 的 token 吊销链、`adminExport` 的角色控权）。
