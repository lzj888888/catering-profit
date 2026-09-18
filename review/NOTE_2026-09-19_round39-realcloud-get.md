# NOTE 2026-09-19 · round39 · 真云验证抓到 3 个上线级缺陷（其中 2 个是本轮新发现）

> **归属（R96）**：本件是**执行方（WorkBuddy）的分析件**，前缀 `NOTE_`（`REVIEW_*` 归复审方）。
> **时点**：本件 = 2026-09-19 00:40–01:10 的实测结果；三个缺陷**均已修 + 均已真云复验**（或待复验，见下表）。

## 0. 一句话结论

**42 个云函数全部部署到 dev 之后，真云第一次跑通完整业务链路，一天内暴露 3 个上线级缺陷**——
它们的共同点：**本地自测 100% 绿、真云 100% 坏**，且**没有一个现有守卫能发现**（三层守卫全绿的同一份代码，真云必崩）。

| # | 缺陷 | 真云症状 | 为什么本地测不出 | 状态 |
|---|---|---|---|---|
| 1 | `common/index.js` 漏导 `genId` | 全新用户首进必崩（`TypeError: genId is not a function`） | 门禁 L 只守"副本≡单源"——副本忠实，把漏导**复制了 42 份** | ✅ 已修 + 真云复验（`39e3e8a`） |
| 2 | 资产原值**字段名分裂**：写端 `value_fen` vs 读端 `total_value` | `calcAmortize` 全程 `-504002 functions execute fail`，**摊销功能不可用** | 自测直接构造 `total_value` 喂 `docToAsset`，**从未走「saveAsset 写入 → DB → 读出」真链路** | ✅ 已修 + 真云复验（本件） |
| 3 | 🔴 **`da.get(coll, 业务主键)` 按 `_id` 查，而 `_id` ≠ 业务主键** | 6 处调用点在真云一律返回 null ⇒ 5 个业务功能不可用 | mock adapter 的 get 直接按业务 id 命中，**从未模拟「_id ≠ 业务主键」这一真云事实** | ✅ 已修，部署中，待复验 |

## 1. 缺陷 3（本轮最大）：`da.get` 的 `_id` vs 业务主键

### 根因
- `common/dataAdapter.js::insert()` 走 `db.collection(coll).add({ data })` ⇒ **`_id` 由云端自动生成**，
  与文档里的 `asset_id` / `material_id` / `shop_id` / `id` 等**业务主键不是同一个值**。
- 而 `get(coll, id)` 是 `db.collection(coll).doc(id).get()` ⇒ **按 `_id` 查**。
- ⇒ 真云上凡用 `da.get(coll, 业务主键)` 的地方**一律返回 null**。

### 受害面（6 处调用点 → 5 个业务功能真云不可用）
| 调用点 | 功能 | 真云后果 |
|---|---|---|
| `saveCostCard/index.js:103` | 成本卡引用原料 | 一律 `RESOURCE_NOT_FOUND` ⇒ **成本卡存不下** |
| `syncCostCard/index.js:66` | 同上 | 同上 |
| `saveAsset/index.js:44` | 编辑 / 报废资产 | 一律「资产不存在或已软删」⇒ **只能新增、不能改** |
| `saveMaterial/index.js:57` | 编辑物料 | 同上 ⇒ **只能新增、不能改** |
| `saveShopSetting/index.js:39` | 店铺设置 | 读不到店铺 ⇒ **保存店铺设置不可用** |
| `exportData/index.js:62` | 导出 | 读不到店铺 ⇒ **导出不可用** |

**反证（很重要）**：`smokeTest/index.js:114/116` 用的是 `da.get(PROBE, res._id)` —— 传的是**真 `_id`**
⇒ 它一直正常。**这条反证把根因钉死了**（不是"云环境有问题"，是"传的键不对"）。

### 实测证据链（三步，缺一不可）
```
① saveMaterial  → SUCCESS，返回 id = mat_mu7606ti1psx        （文档确实建出来了）
② getMaterial   → SUCCESS，list 里能看到 id = mat_mu7606ti1psx（文档确实存在）
③ saveCostCard  → RESOURCE_NOT_FOUND「引用的原料 mat_mu7606ti1psx 不存在或已软删」
```
⇒ 只有「`_id` ≠ `mat_mu7606ti1psx`」能同时解释①②③。证据原文：
`review/evidence/realcloud_20260919/card_versions.json`。

### 修法
`get()` 在按 `_id` 查不到时，**按业务主键字段兜底查**（`id` → `material_id` → `asset_id` → `shop_id` → `account_id`）。
- 兜底覆盖**存量数据**（dev 库里已插入的文档 `_id` 都是自动生成的，改 `insert` 救不了它们）。
- ⚠️ 兜底字段**只列唯一性字段**：`card_code` **不列** —— 多版本模型下同 `card_code` 有多条，会取错版本。
- 字段不存在时 `where` 返回空、不报错 ⇒ 逐个试是安全的。

## 2. 缺陷 2：资产原值字段名分裂（写端 `value_fen` / 读端 `total_value`）

- 写端：`saveAsset/index.js:48/60` 落库字段名 = **`value_fen`**
- 读端：`calcAmortize/validate.js::docToAsset` 只读 **`total_value`**，且是 `throw`（响亮失败）
- ⇒ 真云上 `calcAmortize` 一读到 `saveAsset` 建的资产就 throw ⇒ 全程 `-504002`
- **契约文档本身就是分裂的**：`core/10:45`（saveAsset 接口）写 `value_fen`；
  `core/14:68` 与 `ModuleM1:84`（表结构）写 `total_value`。
- **既有先例**：`getAmortSchedule/index.js:32` 早已做了兼容读（`a.value_fen != null ? a.value_fen : a.total_value`）
  ⇒ 唯独 `calcAmortize` 没跟上。**修法与先例保持一致**（两字段名都接受），严格判型不变（R35/R36 未被削弱）。

### 真云复验（修复前后对比，决定性）
```
修复前：calcAmortize 2026-08 / 2026-09 →  both "-504002 functions execute fail"
修复后：calcAmortize 2026-08 → SUCCESS  total_amount_fen = 833333
        calcAmortize 2026-09 → SUCCESS  total_amount_fen = 833333
        details[0] = { asset_id: amort_mu6lessqaa4y, name: 装修, amount_fen: 833333,
                       start_month: 2026-01, total_months: 36, in_period: true, residual_loss: 0 }
```
金额自洽：30,000,000 分 ÷ 36 月 = 833,333.33 ⇒ **833,333**（尾差倒挤末月）✅
证据：`review/evidence/realcloud_20260919/amort_after_fix.json`（修复后）、
`verify23.json`（修复前，含 `-504002` 原文）。

## 3. 为什么三层守卫全没抓到（这才是要改的地方）

| 守卫 | 为什么没抓到 |
|---|---|
| 门禁 L（common 扁平副本 ≡ 单源） | **副本忠实 = 把缺陷复制 42 份**。派生件忠实会**放大**缺陷，不会暴露它 |
| `check_requires §2`（导出完整性） | 只守「从 common 解构的符号存在」，**不守符号内部的行为**（`get` 存在 ≠ `get` 能查到） |
| 各函数 selftest（本地 mock） | mock 的 DB **没有真云的 `_id` 语义**；且自测喂的是构造好的字段，不走真链路 |
| 行为探针（16 函数 BIZ） | 只调**读类**接口，且**没触发**需要 `da.get` 的分支 |

⇒ **共性：全部在验「代码长什么样」，没有一个在验「真云跑得通不通」**。
⇒ 本轮之后的动作：① 真云链路验证要**常态化**（不是一次性）；② 加**跨函数字段契约**守卫（另见）。

## 4. 顺带确认真云的两条正确行为（正面证据，不是缺陷）
- `saveMaterial` 落库后 `unit_cost_fen = 975`（鸡腿肉 9750 分 ÷ 换算系数 10 ÷ 出成率 100%）
  ⇒ **与记忆中「宫保 975」的锚点一致** ✅（BOM 精度口径在真云成立）
- `saveCostCard` 会**校验原料真实存在**（`RESOURCE_NOT_FOUND`）⇒ 严格，不是宽松放行 ✅

## 5. 待办（本件未闭合）
- 缺陷 3 的**真云复验**：42 函数重部署完成后，重跑 `saveCostCard` 多版本写入（验二）。
- **§3 判据**（`idx_card_code_version` 是否真生效）仍需**控制台 GUI 手工插入重复三元组**
  —— 云函数入参不接受 `version`，只能用控制台加记录；属人工面。
- 超时值（R86/R93）仍需控制台手点 + `info` 回读。
- `R81`（`saveCostCard` 的 `mode` 白名单）仍挂。
