# R719 · M3 深度审计（第二轮）：本地存储隔离横向全量排查

> 2026-11-12 · 李老师：「再跑一轮审计」
> R719 提交时状态：**审计 + 取证，未改任何产品代码**（数字口径一律不碰）
> 守卫：`tools/check_m3_storage_isolation.js` ｜ 证据：`review/evidence/r719_storage/`
>
> ## 🔴 R720 状态更新（2026-11-12，李老师「继续」）：本报告 §6 的 P0 已**已修复**并落地
>
> - `utils/shopSwitcher.js` 新增单源 `shopKey(base)`：按 `currentShopId()` 拼后缀；
>   拿不到店铺时 fail-closed 到 `__NO_SHOP__` 独立格，与任何真实店都不互串。
> - 7 类 key 的 **18 个读写点**全部改走 `ss.shopKey(...)`，分布在
>   `card/edit.js`、`card/import.js`、`card/index.js`、`month/input.js`、`month/inventory.js`。
> - `m3_dish_cats` 两页统一「读旧 + 合并去重 + 追加」写入语义，修掉 §4 的跨页互踩。
> - **不做旧缓存迁移**：旧裸 key 里的数据可能是别店的，宁可丢也不串（与 `currentShopId` 同口径）。
> - 两个守卫（本轮 + R718）的断言已从「缺陷预期存在」反转为「修复后必须不串」，
>   并新增 A-⑧（产品源码 `shopKey` 只传 1 参）/ A-⑨（无残留裸 key）/ C-⑨（无店态独立格）。
> - 下文 §1–§5 保留 R719 审计当时的**原始取证**（缺陷存在时的读数），作为修复前基线，不改写。

---

## 0. 这轮和上轮的关系（先把增量说清楚，避免像是重复劳动）

R718 答的是「两套账**云端**会不会重叠」，顺带抽查了 4 个本地缓存 key，实锤两条红。
但 R718 报告 §4 里 `DISH_IMPORT_DRAFT_ONE`、`m3_dish_cats`、`m3_materials_cache_v1` **只出现在「修复建议」表格里，没有一行取证**，也没列为缺陷；§5 只写了「切店会预渲染旧店数据」一句结论。

按李老师定的红线（**不采信任何自述，含我方上轮**），这轮做两件事：

1. **独立重算**：脱离 R718 报告，用页面桩重新真跑上轮两条红，看还成不成立；
2. **横向全量**：把全仓 `getStorageSync / setStorageSync / removeStorageSync / clearStorageSync` 一次扫净（41 个调用），逐个判定维度，而不是抽查。

**结论先行**：上轮两条红**独立复核成立**；另把上轮「建议但无证据」的 3 条升级为实锤；并发现 1 条 R718 完全没提到的结构问题（两页共用同一个 key 字符串、且写入语义互斥）。

---

## 1. 全量清单：41 个 storage 调用，5 类（守卫自扫，不是抄清单）

守卫 `check_m3_storage_isolation.js` 的 A 段自己遍历 `pages/ / subpkg/ / utils/ / miniprogram/ / cloudfunctions/`（排除 `node_modules`），逐个提取 `xxxStorageSync(` 的**第一实参**，归一化后对照归类表。**任何不在表里的新 key 会被 A-⑤ 直接判红** —— 这是「横向排查」能长期生效的关键：以后谁新增一个不带 shop 的全局 key，不用等人记得登记。

| 类别 | 参数形态 | 常量值 / 拼法 | 维度 | 判定 |
|---|---|---|---|---|
| 用户级（2 个调用） | `user_avatar` / `user_nickname` | 字面量 | 全局 | 🟢 跟着微信号走，本就该全局；`clearStorageSync()` 在退出登录时一次清空 |
| 店铺状态（3） | `PERSIST_KEY` | `shop_switcher_shop_id` | 全局 | 🟢 语义就是「上次选的店」，全局是对的 |
| 已按 shop（3） | `lastPlatformKey()` / `this.inputModeKey()` ×2 处 | `last_import_platform_` / `card_input_mode_` / `input_mode_` + shopId | shop | 🟢 正确 |
| 已按 shop+月（5） | `dineModeKey()` / `takeoutModeKey()` / `takeoutTrackKey()` / `takeoutFoldKey()` / `missingWarnKey()` | `*_` + shopId + `_` + month | shop+month | 🟢 正确（本轮 S6 对照组实跑验证） |
| **全局缺陷（7）** | `DI.BATCH_CACHE_KEY` | `DISH_IMPORT_BATCH` | 无 | 🔴 见 S1 |
| | `DI.DRAFT_PREFILL_KEY` / `DRAFT_PREFILL_KEY` | `DISH_IMPORT_DRAFT_ONE` | 无 | 🔴 见 S3（R718 只在建议里提） |
| | `MAT_CACHE` | `m3_materials_cache_v1` | 无 | 🟡 见 S5（R718 只有一句结论） |
| | `EDIT_CATS_KEY` / `LIST_CATS_KEY` | **`m3_dish_cats`（同一个字符串）** | 无 | 🔴 见 S4 + §4 |
| | `DRAFT_KEY + this.data.month` ×2 页 | `draft_month_input_` / `draft_month_inv_` | 仅 month | 🔴 见 S2 |

按目录分布：`pages` 5（全是用户级 + 退出清空）、`subpkg` 34、`utils` 2。`cloudfunctions/` 产品源码里 0 个 storage 调用。

**云函数面独立复核**：`importSalesBill/index.js` 的 `external_sales_daily` 查询带 `where({ shop_id, platform, biz_date, is_deleted:false })`；`saveLedger/index.js` 的 `shop_monthly_account` 带 `where({ shop_id, month })`。与 R718 的云端结论一致，未发现漏 `shop_id` 的 M3 链路查询。
> 诚实边界：这些 `index.js` 含 `wx-server-sdk`，纯 node 加载不了，本轮是**源码形状复核**，不是真连云数据库；R718 的内存库也不是真云数据库。

---

## 2. 独立复核 R718 两条红（脱离上轮报告重跑）

同一个 `Map` 当本地 storage，A 店 = `shop_guanyinqiao`、B 店 = `shop_jiefangbei`，**真 require 页面源码**，调生产 handler（不是复制一份逻辑出来测）。

| # | 上轮结论 | 本轮独立做法 | 机器读数 | 判定 |
|---|---|---|---|---|
| S1 | `DISH_IMPORT_BATCH` 全局 ⇒ B 店读到 A 店批次 | A 店 `persistBatch()` 真写盘 → 切 B 店 `restoreBatch()` 真读盘 + 真 `decorate` | B 店 `rows = ["A店秘制小面","A店红烧牛肉面"]`，`parsed=true`，`resumeTip="这是上次那批：还有 2 道没补完"`，`isBatchFresh=true` | 🔴 **成立** |
| S2 | `draft_month_input_` 只带 month ⇒ B 店覆盖 A 店草稿 | A 店 `onHide()` 写 → B 店同月 `onHide()` 写 → 切回 A 店 `applyDraftFromStorage()` | A 草稿 `{shop_id:A, "A店堂食"}` → 被覆写成 `{shop_id:B, "B店堂食"}`；切回 A 店**不恢复**（`draft.shop_id` 校验挡住了串读，挡不住覆盖） | 🔴 **成立**，且是**数据丢失**不是串读 |

> 反恒真：坏缓存（行缺 `draft` 骨架）⇒ `isBatchFresh=false`，B 店不会误恢复。这一条专防上轮踩过的「假绿」。

---

## 3. 本轮新增取证：把上轮「建议」升级为实锤

| # | 场景 | 真跑结果 | 老板会看到什么 | 上轮状态 |
|---|---|---|---|---|
| **S3** | A 店导入页 `onGoFill()` 写 `DISH_IMPORT_DRAFT_ONE` → 切 B 店新建成本卡 `loadDraftPrefill()` | B 店拿到 `name="A店秘制小面"`、`priceYuan="12"`（A 店菜名 **+ 售价一起**）；第二次读不到（该键读完即删） | 站在 B 店，新建卡里凭空出现 A 店的菜和 12 元售价 | R718 只在 P0 建议里写「改成按 shop 拼 key」，**无任何取证、未列为缺陷** |
| **S4** | A 店列表页 `load()` 真写入 `m3_dish_cats` → 切 B 店编辑页 `buildCatChips('')` | A 写入 `["A店专属锅底","凉菜"]`；B 候选第一项就是 `A店专属锅底` | B 店选分类时，候选里混着别店的分类 | R718 只在 P1 建议里写「按 shop 隔离」，**无取证** |
| **S5** | A 店编辑页 `load()` 写 `m3_materials_cache_v1` → 切 B 店新建卡 `load()`，捕获每一次 `setData` | B 店 `setData({materials})` **第一下**就是 `["A店专用花椒","A店菜籽油"]`（含进价），第二下才换成 `["B店专用豆瓣"]` | 秒开那一瞬，原料下拉里是别店原料和进价 | R718 §5 只有一句「切店预渲染旧店数据」，**无证据、无定级** |

**S5 诚实定级**：这是「首屏短暂串店」，后台云返回会覆盖纠正，不是永久错数 ⇒ 记 🟡 不记 🔴。但它带的是**进价**，属于成本数据，比分类候选敏感。

**S3 诚实定级**：`removeStorageSync` 的一次性语义**不能防跨店** —— 只要 A 店点了「去补价」却没真正跳进编辑页（返回、切店、杀进程），B 店下一次新建卡就会吃到这份草稿。触发路径真实存在，记 🔴。

---

## 4. R718 完全没提到的结构问题：跨页同 key + 写入语义互斥

```
card/index.js:36   const LIST_CATS_KEY = 'm3_dish_cats';   // 列表页：Array.from(catSeen) 全量覆盖写
card/edit.js:32    const EDIT_CATS_KEY = 'm3_dish_cats';   // 编辑页：arr.slice(-40) 追加累积写
```

两个页面**共用一个字符串**，但写入语义相反：

- 列表页每次 `load()` 把「本店卡片里出现过的分类」**整体覆写**；
- 编辑页每次保存把老板手填的分类**追加**进历史。

⇒ 即使不切店，老板在编辑页辛苦累积的分类历史，只要回一次列表页就会被**整批抹掉**；叠加跨店，就是「B 店列表页把 A 店分类写进去，B 店编辑页再读到」。这是 R718 只说「按 shop 隔离」时没看见的一层：**光加 shop 维度能修跨店，修不了跨页互踩**。

**共同根因**：`utils/shopSwitcher.js::switchShop()` 只做两件事 —— 写 `globalData.shop_id`、置 `shopLoaded=false`（R470 防止旧店上下文），**不清理任何本地 storage，也不给 key 加维度**。所有跨店缺陷同源。
而同一仓库里**已经有现成正确范式**：S6 对照组 6 个按 `shopId(+month)` 拼的 key，桩内实跑 B 店一个都读不到、切回 A 店 6 个值原样读回。所以修复不是新设计，是把现成写法推广到 7 个全局 key。

---

## 5. 诚实评分（证据对比表）

| 面 | 评分 | 依据 |
|---|---|---|
| 云端两套账隔离 | 🟢 | R718 14 行 `_id` 全唯一 + 本轮复核 `where(shop_id)` 在场 |
| 已带 shop/shop+month 的 6 个 key | 🟢 | S6 桩内实跑：B 店全空、A 店原样读回（**不误伤**） |
| 用户级 / 当前店铺态 3 个 key | 🟢 | 语义本来就该全局，不误改 |
| 全局缺陷 7 个 key | 🔴 | S1/S2/S3/S4 四条实锤，含**别店菜名+售价**、**草稿覆盖丢失** |
| 原料缓存首屏 | 🟡 | S5 真跑到两次 `setData`，后台会纠正，但带进价 |
| 跨页同 key 写入互斥 | 🔴 | §4 源码 + 桩真跑双证据 |
| 守卫自身可信度 | 🟢 | 32 断言 / 反恒真 6 条 / 真变异回灌见 §7 |
| 渲染层「老板眼睛看见几秒」 | ⚪ 未验 | 桩只证 `setData` 被调用，画面层属 L3 模拟器/真机，不在射程 |

---

## 6. 修复顺序（**R720 已落地**；下表保留 R719 当时的评估）

| 优先级 | 动作 | 改动面 | 风险 |
|---|---|---|---|
| P0 | 7 个全局 key 统一按 `shopId` 拼（照 `lastPlatformKey()` / `dineModeKey()` 现成写法），旧缓存读不到即当没有（fail-closed） | `utils/dishImport.js` + `card/import.js` + `card/edit.js` + `card/index.js` + `month/input.js` + `month/inventory.js` | 低；不动算钱口径 |
| P0 | `m3_dish_cats` 除了加 shop，**还要统一写入语义**（别一处全量覆盖、一处追加），否则跨页互踩仍在 | `card/index.js` + `card/edit.js` | 低 |
| P1 | `switchShop()` 切店时按前缀清理旧店的本地草稿/缓存，或至少让全局 key 全部走 P0 的 shop 拼法 | `utils/shopSwitcher.js` | 中；要确认不误清用户级 key |
| P1 | `MAT_CACHE` 秒开前先比对缓存归属店，不同店就不预渲染（宁可慢 1 秒，不显示别店进价） | `card/edit.js::load()` | 低 |
| P2 | 云端 `getDishReview` 缺区间时 fail-closed（R718 P1 遗留，会动 R301 兼容语义，需先定产品口径） | 云函数 | 中 |

> 🔴 **R720 已按上表 P0 全部落地**：单源 `shopKey` + 18 个读写点 + 分类字典统一语义。
> 守卫 B 组已反转为「修复后必须不串」（B-①/④/⑤/⑥/⑦/⑫/⑭），
> 两个守卫在干净全量里全绿即证明修复生效；`check_two_books_isolation.js` 的 C-②/C-⑤ 同步反转。
> 上表 P1/P2（云端缺区间 fail-closed、重导覆盖提示）**仍未动**，等李老师拍板。

---

## 7. 变异回灌（R719 审计期基线，守卫自身可信度）

脚本 `_r719_mut.py`（跑完即删，不进仓库）：临时改坏**产品源码/报告**，逐条跑守卫，要求 `exit!=0` 且输出里出现 `❌ <目标断言>`，然后恢复文件。

| 变异 | 改坏了什么 | 期望点名 | 结果 |
|---|---|---|---|
| M1 | `pages/mine/index.js` 偷偷加一个 `setStorageSync('r719_new_global_key')` | `A-⑤` | ✅ 判红并点名（**横向防漏真的会抓新 key**） |
| M2 | `EDIT_CATS_KEY` 改名，打破跨页同 key | `C-①` | ✅ |
| M3 | `LIST_CATS_KEY` 改名 | `C-①` | ✅ |
| M4 | `buildCatChips` 不再读历史字典 | `B-⑫` | ✅ |
| M5 | 报告删掉 `DISH_IMPORT_BATCH` 登记 | `C-⑥` | ✅ |
| M6 | 关掉新建态缓存预渲染（`if (isNewSingle)` → `if (false)`） | `B-⑭` | ✅ |
| M7 | `switchShop()` 开始清理本地缓存（把共同根因修掉） | `C-④` | ✅ |

**7/7 全部 `exit=1` 且点名目标断言**，恢复后仓库无残留 `.r719bak`、守卫回到 32/32 全绿。

> 说明：M4/M6/M7 本质是「把缺陷修好」的变异。守卫把缺陷判为「预期存在」，所以修好反而转红是对的 —— 这正是设计意图：**修复落地时必须同步改守卫断言**，否则会假装缺陷还在。R718 的 C 段也是同一约定。

---

### §7b R720 修复期的变异回灌（11 条，全部点名）

脚本 `_r720_mut.py`（跑完即删，不进仓库）：把刚落地的隔离修复**改回去**，逐条跑两个守卫，
要求 `exit!=0` 且输出里出现 `❌ <目标断言>`，然后恢复文件。

| 变异 | 改坏了什么 | 守卫 | 期望点名 | 结果 |
|---|---|---|---|---|
| M1 | `shopKey` 退化成 `return base`（去掉店铺维度） | R719 | `B-①` | ✅ |
| M2 | 整批缓存读改回裸 `DI.BATCH_CACHE_KEY` | R719 | `A-⑨` | ✅ |
| M3 | 月草稿写改回裸 `DRAFT_KEY + month` | R718 | `C-⑥` | ✅ |
| M4 | 分类字典改回 `Array.from(catSeen)` 全量覆盖 | R719 | `C-③` | ✅ |
| M5 | 单菜预填**读**单侧改回裸 key | R719 | `A-⑨` | ✅ |
| M6 | 去掉无店态 `__NO_SHOP__` fail-closed | R719 | `D-④` | ✅ |
| M7 | R719 报告删掉 R720 修复状态 | R719 | `C-⑥` | ✅ |
| M8 | R718 报告删掉 R720 修复状态 | R718 | `C-⑦` | ✅ |
| M9 | 预填**写读两侧同时**退回裸 key | R719 | `B-⑥` | ✅ |
| M10 | 预填读改回裸 key（验老桩仍有分辨力） | `card-patch-mode` | `A-⑥` | ✅ |
| M11 | 整批写改回裸 key（验老桩仍有分辨力） | `import-batch-cache` | `A-③` | ✅ |

**11/11 全部 `exit=1` 且点名目标断言**，恢复后无残留备份、两个守卫回到 35/35 与 43/43 全绿。

> **三个老守卫的同步（如实登记，不是把红改绿了事）**：全量首跑 **289/292**，
> `write-reentry` / `card-patch-mode` / `import-batch-cache` 三个老守卫**写死了裸 key** 而失配 ——
> `check_write_reentry_guard` 找 `setStorageSync(DRAFT_` 找不到；
> `check_card_patch_mode` 的桩往裸键喂草稿，页面读 scoped 键 ⇒ 4 条假红；
> `check_import_batch_cache` 直接 `store[DI.BATCH_CACHE_KEY].rows` 抛 `TypeError` 崩掉整个套件。
>
> 处置：`write_reentry` 的 findIndex 改成**两种写法都认**（裸 `DRAFT_` 与 `ss.shopKey(DRAFT_`）——
> R443 教训：只认一种写法会立刻误红，且 M2 测算草稿本来就是裸 key，不能误伤；
> 另两个守卫的桩改用**真实 `SS.shopKey(base, 'shop_test')`** 拼钥匙。
> **不削弱原有判据、不改断言数**；「key 必须按店隔离」由本守卫 A-⑨ 统一守。
> 同步后单跑三个全绿；M10/M11 把产品代码改回裸 key，两个桩型老守卫仍如期转红并点名
> `A-⑥` / `A-③` ⇒ 证明不是被改成恒绿。

> **M5 踩点（如实登记）**：首版我预期命中 `B-⑥`（B 店读到 A 店菜名），实际红的是
> `A-⑤ / A-⑨ / B-⑧`。查明原因：**只有一侧**退化时写读不匹配 —— A 店写的是 scoped key、
> B 店读的是裸 key，B 店仍读不到 A 店数据，所以 `B-⑥` 保持绿是**正确**的；
> 守卫抓住的是「未登记参数形态 / 残留裸 key / A 店自己也读不到」。
> 是我预期写错，不是守卫漏判。为把「真跨店串」也验到，另加 **M9**（写读两侧同时退化），
> `B-⑥` 如期转红。这条与 R717/R718 多次踩到的同型教训一致：**先判明是预期错还是漏判，不许糊过去**。

---

## 8. 如实登记的其它发现 / 未解决

- **R714 三件待拍板仍未动**：菜单毛利按售价加权 vs 真实毛利按销量加权（偏差恒正）、同名成本卡销量归谁取决于 DB 返回顺序、`reconcile` 遇 `NaN` 不拦。
- **R718 遗留**：月份隔离靠前端自觉（不传 `biz_date_from/to` 时 `filterByRange` 不过滤）、小账单 <20 行跨平台重复导入不拦、同店同日重导幂等覆盖静默丢前一套。
- **技术债**：`.hint-fold` 第五份复制；外卖计算页 4 个橙色说明块。
- **本轮边界**：全部在 node 桩 / 纯函数 / 源码形状层完成，**未上真机**；预览码需李老师手机扫。云函数 `index.js` 含 `wx-server-sdk` 不能纯 node 加载，只做形状复核。
- **守卫的射程边界**：证明了 `setData({materials: 旧店原料})` 真被调用，但「首屏那一下是否肉眼可见、持续多久」需要 L3 截图取证，本轮未做。

---

## 9. 复现命令

```bash
# 单跑本轮守卫（32 断言）
node tools/check_m3_storage_isolation.js

# 全量门禁
node verify_all.js
```
