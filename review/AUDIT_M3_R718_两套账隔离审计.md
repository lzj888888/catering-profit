# AUDIT · M3 两套餐饮账单隔离深度审计（R718）

- 日期：2026-11-12
- 触发：李老师「深度审计 M3 模块，提前准备餐饮账单去跑通，同时数据要输入 2 套不同的账，看看会不会数据有重叠在一起的情况以及其他情况。」
- 方法：**不用推断，用生产源码真跑**。准备两套真能导入的餐饮账单 → 用 `importSalesBill` / `getDishReview` / `getSalesBills` / `reconDerive` 的生产纯函数真解析、真生成 `_id`、真落内存库、真按店/月读取 → 逐位比对。
- 复现：`node tools/check_two_books_isolation.js`（R718 当时 42 断言 + 变异回灌）；账单实物与 fixture 在 `review/evidence/r718_two_books/`。
- 🔴 **R720 状态更新（2026-11-12，李老师「继续」）：本报告 §4 的两条 P0 已修复**。
  单源 `utils/shopSwitcher.js::shopKey(base)` 给本地 key 加店铺维度，
  `DISH_IMPORT_BATCH` / `DISH_IMPORT_DRAFT_ONE` / `draft_month_input_` / `draft_month_inv_`
  等 7 类 key 的 18 个读写点全部改走它；旧裸 key 不迁移（宁丢不串）。
  本守卫 C-②/C-⑤ 已反转为「修复后必须不串」，并新增 C-⑨ 验 `shopKey` 单源与无店态独立格。
  下文 §2/§3 保留 R718 当时的**缺陷取证**作为修复前基线，不改写。

---

## 0. 本次准备的两套账（都是系统真能导入的实物，不是编的假表）

| | 账 A | 账 B |
|---|---|---|
| 门店 | 老巷小面·观音桥店 `shop_guanyinqiao` | 老巷小面·解放碑店 `shop_jiefangbei` |
| 月份 | 2026-09 | 2026-10 |
| 外卖平台 | 美团 `meituan` | 饿了么 `eleme` |
| 外卖商品销量 CSV | 4 行 / 90 份 / 150000 分 | 4 行 / 36 份 / 43200 分 |
| 堂食《菜品销售统计》xlsx | 3 行 / 260 份 / 408000 分（区间末日 09-13） | 3 行 / 120 份 / 204000 分（区间末日 10-11） |
| M1 月度账本 | 菜品口径收入 558000 分 / 食材 250000 分 | 菜品口径收入 247200 分 / 食材 120000 分 |
| 成本卡 | 3 张（小面/牛肉面/抄手），菜单毛利率 62.50% | 4 张（小面/抄手/米线/肥肠面），61.45% |

**三个维度都不同**（店 / 月 / 平台），这是压隔离最狠的组合。三个来源都过了生产解析器：外卖 CSV → 形态 C + 甲级门禁 A 级；堂食 xlsx → `openpyxl` 真读回后喂 `parseDishSales` → 形态 A；M1 账本 → `reconDerive`。

实物清单（`review/evidence/r718_two_books/`）：
- `账A_外卖商品销量_202609_meituan.csv` / `账B_外卖商品销量_202610_eleme.csv`（UTF-8 BOM，Excel 双击不乱码）
- `账A_堂食菜品销售统计_20260913.xlsx` / `账B_堂食菜品销售统计_20261011.xlsx`（二级表头真结构）
- `fixture.json`（原始行 + 独立复算期望）、`bills_matrix.json`（openpyxl 真读回 cells）、`make_bills.py`（生成脚本）

---

## 1. 结论先行：诚实的绿 / 黄 / 红

| # | 结论 | 评级 |
|---|---|---|
| 1 | **云端落库数据：两套账不重叠。** `_id` 含店/平台/日期，14 行全唯一，B 没覆盖 A 一行；`where(shop_id)` 后两账份数/金额完全分开；榜单、账单列表、对账、菜单毛利率各算各的 | 🟢 绿 |
| 2 | **月份隔离靠「前端必须传区间」，不是云端强制。** 不传 `biz_date_from/to` 时 `filterByRange` 明确「不过滤」（R301 兼容旧客户端），两套账会累加成 **506 份 / 805200 分**。当前 3 个生产调用点都传了，所以现在是安全的，但这是一条**靠调用方自觉**的契约 | 🟡 黄（契约缺口） |
| 3 | **`DISH_IMPORT_BATCH` 跨店串数据**：整批导入进度缓存 key 是全局常量，不带 shop。B 店真读到了 A 店「还有 2 道没补完」的批次，并会把 A 店菜名带到 B 店建卡 | 🔴 红（真缺陷） |
| 4 | **`draft_month_input_` 草稿跨店覆盖丢失**：key 只带 month 不带 shop。B 店同月存草稿会覆盖 A 店草稿，切回 A 店草稿已空。串读被 `draft.shop_id` 校验挡住了（这条防线有效），但挡不住覆盖 | 🔴 红（真缺陷） |
| 5 | `m3_dish_cats` / `m3_materials_cache_v1` 也是全局 key：切店后分类历史、原料缓存会先在 B 店预渲染 A 店数据（后台刷新后才覆盖） | 🟡 黄 |
| 6 | 小账单（<20 行）跨平台重复导入不会被拦：`detectDupImport` 阈值 20 行/10 命中/80%，设计上「宁可漏判不可误杀」。本轮两套账都是 4 行，即使逐行全等也返回 `dup:false` | 🟡 黄（设计取舍，非 bug） |
| 7 | 同店同平台**同一天**导入两套不同账 ⇒ `_id` 相同 ⇒ 幂等覆盖，前一套静默消失（`pruneStaleGroup` 还会软删本次没写的旧行） | 🟡 黄（幂等设计的副作用） |

**一句话回答「会不会重叠」：云端两份账本身不串（🟢）；但本地缓存/草稿层有三处会串或会丢（🔴🔴🟡），且月份隔离依赖前端传参（🟡）。**

---

## 2. 证据：两套账逐位复算（`node tools/check_two_books_isolation.js`）

### B 段 · 云端真灌库（先灌 A，再灌 B，顺序关键）

| 判据 | 实测 | 结论 |
|---|---|---|
| B-① `_id` 唯一 | A=7 行 + B=7 行 = 库内 14 行 | B 没覆盖 A |
| B-② `_id` 形态 | `SALE_shop_guanyinqiao_meituan_2026-09-05_0` | 含店/平台/日期 |
| B-③ `where(shop_id)` | A=7 行/350 份；B=7 行/156 份 | 互不混入 |
| B-④ 传 9 月区间 | 9 月 7 行、10 月 7 行，无交叉 | 两月不混 |
| B-⑤ 各月金额 | 9 月 558000 分、10 月 247200 分 | 与 fixture 逐位一致 |
| B-⑥ **不传区间** | 506 份 / 805200 分 | 🔴 会累加（把风险暴露出来） |
| B-⑦ 账单列表 | 6 条，按平台/日期分开 | 没并成一份 |
| B-⑧ 复盘榜 | A 外卖 90 份、B 外卖 36 份 | 各算各 |
| B-⑨ M1 对账 | A 55.20%、B 51.46% | 收入/成本/率都不重叠 |
| B-⑩ 菜单毛利率 | A 62.50%、B 61.45% | 成本卡按店隔离 |

### C 段 · 本地缓存页面桩真跑「切店」

**C-1 整批导入进度（🔴 实锤）**：造一份结构合规、新鲜（`isBatchFresh=true`）的 A 店批次缓存，切到 B 店执行 `restoreBatch()`：

```
B 店 rows      = ["A店麻婆豆腐", "A店回锅肉"]
B 店 resumeTip = 「这是上次那批：还有 2 道没补完」
```

反过来：B 店存了自己的批次后，切回 A 店读到的是 `["B店宫保鸡丁"]`——A 店原批次被覆盖。
原因：`utils/dishImport.js` 的 `BATCH_CACHE_KEY = 'DISH_IMPORT_BATCH'`、`DRAFT_PREFILL_KEY = 'DISH_IMPORT_DRAFT_ONE'` 都是**全局常量**，不带 shop。R711 加「整批续做」时只考虑了页面销毁重建，没考虑切店。

**C-2 月输入草稿（🔴 实锤）**：

```
A 店 onHide  → key=draft_month_input_2026-09, shop_id=shop_a
B 店 onHide  → 同 key 被覆盖, shop_id=shop_b
切回 A 店    → incomeGroups = []   （A 店填的 8888 元没了）
```

`applyDraftFromStorage()` 里 `draft.shop_id !== sid` 的校验**确实挡住了串读**（C-④ 绿，这条防线有效），但 `onHide` 写盘用的是同一个 key，挡不住覆盖。同样拼法的还有 `subpkg/biz/month/inventory.js` 的 `draft_month_inv_`（盘点金额，串店即污染账本）。

**已做隔离的（🟢，别误伤）**：`dineModeKey` / `takeoutModeKey` / `takeoutFoldKey` / `missingWarnKey` / `inputModeKey` / `takeaway` 的 `lastPlatformKey()` 都拼了 `shopId + '_' + month`；M1 月账本 `shop_monthly_account` 唯一索引是 `(shop_id, month)`；成本卡 `getCostCard` 按 `shop_id` 过滤。

---

## 3. 变异回灌（守卫自身可信度）

### 3.1 真变异回灌（临时改坏**产品源码 / 账单 / 报告**，跑完恢复）

7 条，全部 `exit!=0` 且被**点名**的断言抓住（不是「反正会红」）：

| # | 变异 | 点名断言 |
|---|---|---|
| M1 | `saleDocId` 去掉 `shopId` | `B-②` |
| M2 | `filterByRange` 恒放行（区间失效） | `B-④` |
| M3 | 报告删掉 `DISH_IMPORT_BATCH` 登记 | `C-⑦` |
| M4 | 外卖 CSV 换成认不出的表 | `A-④` |
| M5 | `fixture.json` 份数 90→91 | `A-⑤` |
| M6 | 堂食读回 cells 的「菜品收入」列改错 | `A-⑦` |
| M7 | `BATCH_CACHE_KEY` 偷偷改名 | `C-③` |

**两条踩点教训（如实登记，是我写错、不是守卫漏判）：**

- **M6 首版改的是「销售额」列，守卫没红。** 形态 A 一行里 `1440` 出现两次——`colSales`（销售额，第 4 列）与 `colIncome`（菜品收入，第 6 列），而 `amountFen` **只取 `colIncome`**（R232 实际收入口径）。改不参与计算的列，金额本就不该变 ⇒ 守卫不红是**正确**的。改用 JSON 结构化精确改 `cells[4][5]` 后才转红。**顺带复证了「销售额≠收入」这条口径没被写反。**
- **M7 我预期点名 `C-②`，实际是 `C-③`。** 守卫里 A 店批次的 store key 也跟着 `DI.BATCH_CACHE_KEY` 走，改名后 B 店照样读到 A 店批次（`C-②` 仍绿），真正转红的是常量形状断言 `C-③`。守卫确实抓住了 key 改名，只是命中点不同。

### 3.2 守卫内变异 + 反恒真

守卫 D 段另含 6 条内建变异（`_id` 去 shop 撞车、漏传区间、漏 where、坏表、报告删登记、坏缓存），E 段 4 条反恒真（空账单 0 条 / 不存在的店 0 行 / `from>to` 空集 / 坏缓存 false）。

**另一处假绿**：第一次探针里 C-1 曾返回「隔离 OK」，核实后发现是 `isBatchFresh=false` 的**过期兜底**——缓存结构缺 `draft` 骨架。用生产 `buildDraftCard` 造合规缓存后重跑才拿到真红，已固化为 `C-①` 前提断言。

---

## 4. 修复顺序（**R720 已落地**；下表保留 R718 当时的评估）

本轮是审计 + 跑通 + 取证，**没有修改任何产品代码**（数字口径一律不碰，遵守此前约定）。

| 优先级 | 动作 | 改动面 | 风险 |
|---|---|---|---|
| P0 | `DISH_IMPORT_BATCH` / `DISH_IMPORT_DRAFT_ONE` 改成按 shop 拼 key（与 `lastPlatformKey()` 同款）| `utils/dishImport.js` + `subpkg/biz/card/import.js` + `edit.js` | 低；旧缓存读不到即当没有，符合 fail-closed |
| P0 | `draft_month_input_` / `draft_month_inv_` 拼上 shop | `subpkg/biz/month/input.js` + `inventory.js` | 低；保留 `draft.shop_id` 校验做双保险 |
| P1 | `m3_dish_cats` / `m3_materials_cache_v1` 按 shop 隔离 | `card/edit.js` + `card/index.js` | 低 |
| P1 | 云端 `getDishReview` 对**缺区间**的调用做 fail-closed 或至少出参显式标 `range_all=true` | 云函数 | 中；会动 R301 的兼容语义，需先定产品口径 |
| P2 | 同店同日重导覆盖前给一句「这会覆盖已导入的同日数据」 | 导入页预览 | 低 |

🔴 R720：守卫 `check_two_books_isolation.js` 的 C-②/C-⑤ **已改成「修复后必须不串」**，
并新增 C-③/C-⑥ 验调用点确实走 `ss.shopKey`、C-⑨ 验单源与 fail-closed。
两条 P0 已修；P1/P2（本地其它全局 key、云端缺区间、重导覆盖提示）见
`review/AUDIT_M3_R719_本地存储横向审计.md` §6，其中 `m3_dish_cats` / `m3_materials_cache_v1`
也已由 R720 一并修复。

---

## 5. 如实登记的其它发现

- **R714 三件待拍板仍未动**：对账菜单毛利按售价加权 vs 真实毛利按销量加权（偏差恒正）、同名成本卡销量归谁取决于 DB 返回顺序、`reconcile` 遇 `NaN` 不拦。本轮不涉及，保持原状。
- **技术债**：`.hint-fold` 第五份复制；外卖计算页 4 个橙色说明块。
- **真机未验**：本轮全部在 node 桩与纯函数层完成，未上真机；预览码需李老师手机扫。
- **诚实边界**：云函数 `index.js` 含 `wx-server-sdk`，纯 node 加载不了 ⇒ `where(shop_id)` / `_id` 构造以源码形状断言 + 既有套件（R57 范式）保证；`service.js` 纯函数层是真跑。内存库是**模拟** `doc(_id).set()`，不是真云数据库。

---

## 6. 复现命令

```bash
# 重新生成两套账单实物 + fixture
python review/evidence/r718_two_books/make_bills.py

# 跑隔离守卫（42 断言 + 变异回灌）
node tools/check_two_books_isolation.js

# 全量门禁
node verify_all.js
```
