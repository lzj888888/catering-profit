# R251 · 「单品毛利复盘」为什么看不到京东 —— 真云实测诊断 + 修复

> 报障（李老师 2026-10-09 15:35，真机截图）：「单品毛利复盘」页同时出现「外卖·淘宝闪购」
> 「外卖·京东（订单）」两个标题、**下面都没有内容**；堂食合计全 0；未匹配菜品一长串；
> 页面只有一个「去映射」按钮。
> 问：① 又有京东又有淘宝正常吗 / 是不是混乱了 ② 我导了京东，为什么没看到 JD 字样
> ③ 这几个平台你自己跑一下看复盘的变化 ④ 没有清除键正常吗

**结论一句话**：**没有串账、也不混乱**（数据按平台分开存、各归各块）；真问题是三个 ——
**京东那批是「账单级」数据，在「菜品」复盘里注定一个字都不显示（却留一个光标题）**、
**淘宝 118 份因为没建成本卡而全进了未匹配**、**全站没有「清除/查看已导入」入口**。
前两条已在本轮修掉（见 §四），第三条列为下一批。

---

## 一、真云实测（**零写入** · 只调只读函数）

通道：微信开发者工具 automator WS（`ws://127.0.0.1:9420`）+ 页面上下文 `wx.cloud.callFunction`。
脚本：`_r251_probe.js`（页面数据真相）· `_r251_cards.js`（成本卡名单）。
回包：`payload_r251.json`（**已脱敏**）· `cards_r251.json`（**已脱敏**）· 人读档 `probe_r251*.txt`。

### 1.1 `getDishReview` 真实回包（**= 页面看到的一切**）

```
shop_id = shop_mu6j87v1itrs
code    = SUCCESS
dine_in（堂食排行）行数 = 0
unmatched（顶层 = 堂食未匹配）行数 = 0
totals = { qty:0, amountFen:0, costFen:0, grossFen:0, dishCount:0, unmatchedCount:0 }
takeaway = taobao, jd_order
  [taobao]   ranked=0  unmatched=51  totals={ qty:118, amountFen:182308, costFen:0, grossFen:0, unmatchedCount:51 }
  [jd_order] ranked=0  unmatched=0   totals={ qty:0,   amountFen:0,      costFen:0, grossFen:0, unmatchedCount:0 }
```

逐条对上截图：
- 「堂食·单品毛利排行榜 → 总份数 0 / 总营收 ¥0.00 / 总物料成本 0 / 总毛利 0」
  = `dine_in` 空 + `d.totals` 全 0（该店**从没导过堂食销量**）。
- 「外卖·淘宝闪购」+「外卖·京东（订单）」两行标题
  = `by_platform` 里确有这两个平台**的行**，但两边 `ranked` 都是 0 ⇒
  前端 `wx:if="{{item.ranked.length}}"` 不成立 ⇒ **只画标题、不画表**（「光标题」）。
- 「未匹配菜品」那一长串 = `taobao.unmatched` 的 51 条（前端把堂食 + 各平台未匹配**合并**后展示）。
  截图里的 `2 份 / ¥15.20`、`12 份 / ¥432.00`、`6 份 / ¥216.00`、`24 份 / ¥912.00`、`0 份 / ¥0.00`
  与真云回包**逐条一致**（1520 / 43200 / 21600 / 91200 / 0 分）。

### 1.2 成本卡名单（该店只有 3 张）

`成本卡1`（v5 · 1 行）· `成本卡2`（v9 · 1 行）· `成本卡3`（v10 · 2 行）
（真名已在脱敏中替换；原文见 `_probe_tmp/r251_raw/cards_r251.json`，**不入库**）

### 1.3 淘宝 51 个未匹配菜品

qty 合计 **118**、金额合计 **182308 分 = ¥1823.08**。其中含一条 `43 份 / ¥0.00`
—— 正是 v1.7 C-5 说的**口味询问类 SKU**。

**与 3 张成本卡名能撞上的：无。** ⇒ 不是匹配规则的问题，是**这批菜压根没有卡**
（真名见 `_probe_tmp/r251_raw/payload_r251.json`，**不入库**）。

---

## 二、三个问题的定性

### Q1 又有京东又有淘宝，正常吗？—— **正常，不是串账**

- 页面的设计就是**按平台分块**（红线 18「两个来源分开呈现，不默认 0」）；
- 库里确实只有这两个平台的外卖数据，`platform` 字段各归各的，**没有互相污染**；
- 账单级 `_id = BILL_<shop>_<platform>_<bizDate>`、商品销量级是另一套 `_id` ⇒ **不互相覆盖**。
- ⚠️ 但**呈现有缺陷**：平台块在 `ranked` 为空时**只渲染标题**，看上去就像混进了两条脏数据。

### Q2 京东也导入了，为什么没有 JD 字样？—— **看得见，但注定是空的**

- 「外卖 · 京东（订单）」那一行**就是**京东（平台名走中文单源 `TERMS.card.reviewPlatformNames`，
  不用 JD 缩写）。
- **但下面永远不会有内容**，因为京东那批是**账单级**数据：

  `cloudfunctions/importSalesBill/index.js` 账单分支：
  ```js
  const _id = 'BILL_' + shopId + '_' + platform + '_' + r.bizDate;
  await db.collection('external_sales_daily').doc(_id).set({ data: {
    shop_id, biz_date, external_ref_id: 'BILL:'+platform+':'+bizDate,
    dish_key: '',            // ← 🔴 没有菜名
    qty: r.qty, amount: r.amountFen, platform, ...
  }});
  ```

  而排名逻辑（`getDishReview/service.js::rankReview`）：
  ```js
  const k = (s.dish_key == null ? '' : String(s.dish_key)).trim();
  if (!k) continue;          // ← 🔴 空 dish_key 直接跳过（不计入、不报错）
  ```

  ⇒ 账单级行**既不上榜、也不进未匹配、连合计都不算** ⇒ 真云实测 `jd_order` 三项全 0。
  **这是"死输入"：写了、读不出、还留一个光标题**（比"填了算错"更坏）。
- 对照：淘宝之所以有 51 个菜，是因为导了**《淘宝闪购·商品销量》**（形态 C，带菜名）。
  京东要出菜，必须导**京东《商品销量》（SKU 级）** —— 而李老师手上那份 `sku对账单下载`
  是**只有表头的空模板**（3830 B / 1 行 × 27 列，原始 XML `dimension ref="A1:AA1"`），
  门禁拦下是**对的**（R250 已坐实）。

### Q3 没有清除键，只有一个「去映射」，正常吗？—— **半正常：页面只读是设计，但"清除/查看已导入"是全站缺口**

- **只读是设计**：本页是排名页，`dishreview/index.js` 文件头明写「🔴 只读：本页只调 getDishReview，
  **绝不**写成本卡 / M1 / 销量」⇒ 没有"保存/提交"是正常的。
- **「去映射」名不副实**：`goMap()` 跳的是 `/pages/card/index`（**成本卡列表**）＝ 去**建**卡，
  不是"把这道菜映射到某张卡"。（真映射表 `shop_dish_mapping` 在 `initDb` 里建了索引，
  但**全仓无人读写**。）
- **真缺口**：`external_sales_daily` 这张表——
  - 写入：只有 `importSalesBill`（3 处 `.set()`）
  - 读取：只有 `getDishReview`（1 处 `listAll`）
  - **删除：0 处**

  ⇒ **导错了无法挽回**，只能靠"同一天 + 同一平台重导覆盖"。且**没有任何界面**能让人看到
  「我已经导过哪些账单」。→ 列为下一批（需要新增云函数能力，见 §五）。

---

## 三、附带发现

1. **外卖各平台的合计没人显示**：`takeaway.by_platform[p].totals` 在后端算好了
   （taobao = 118 份 / ¥1823.08），但页面 `index.wxml` 的 takeaway 块**只渲染 `ranked`**，
   `item.totals` **一次都没用到** ⇒ 用户看不到"我到底导进来多少"，只能从「未匹配菜品」里一条条数。
   → **本轮已修**。
2. **口味询问类 SKU 落在未匹配里会丢标记**：`zeroAmount` 只在 `ranked` 分支里打
   （`buildTakeawayReview`），一旦这行没卡、掉进 `unmatched`，标记就丢了
   ⇒ 43 份 0 元混在未匹配里，把读者对「份数」的观感推高。→ **本轮已修**。

---

## 四、本轮修复（呈现层 · 零口径改动 · **零云函数改动**）

| # | 缺陷 | 修法 | 落点 |
|---|---|---|---|
| ① | 平台块榜为空时**只留光标题** | 按**后端已算好的** `totals.unmatchedCount` 分两种成因给说明：`>0` ⇒「全未匹配」；`=0` ⇒「只导入了账单合计、无菜品明细」 | `pages/m3/dishreview/index.js` + `index.wxml` + 文案 `terms.card.reviewPlatformBillOnly / reviewPlatformAllUnmatched` |
| ② | 平台合计**算好了不渲染** | 平台块补「份数 / 营收 / 未匹配 N 项」小结 | 同上 |
| ③ | 未匹配菜品**看不出平台** | 合并时带上来源平台名（复用单源 `reviewPlatformNames`，**零新增文案**） | 同上 |
| ④ | 掉进未匹配后**丢「口味询问类」标记** | 前端按同口径（`amountFen===0 && qty>0`）补回，复用既有 `reviewZeroAmount` | 同上 |

🔴 **为什么成因判据必须用后端字段、不许前端猜**：若前端用 `totals.qty > 0` 判，会把
「有菜品行但销量全 0」的平台误判成"账单级" ⇒ 给出**错误解释**。用 `unmatchedCount` 则准确
（有菜名就会进 `unmatched`）。

文案同步面：`miniprogram/i18n/terms.js` → `cp` 到 `specs/dev-specs/i18n/terms.js`
（md5 `4ae97da99703b0ff2d3d1161f304dfcc` 两侧全等）。

---

## 五、验证（都可机器复核）

| 项 | 结果 |
|---|---|
| 页面行为（真调 `load()`，真云回包喂入） | `_r251_verify.js` **17 通过 / 0 失败** → `verify_r251_behaviour.txt` |
| 新增守卫 ⑥ 组 | `tools/check_dishreview_engine.js` 36 → **47 断言**（真调页面 + wxml 渲染双面） |
| 变异回灌 | **5/5 全部有效红**（红在目标断言名 · 还原 md5 全等 · 复绿）→ `mutation_r251.txt` |
| 全量门禁 | 见 `review/evidence/r251_gate/gate_155_r251.txt`（缓存刷新见同目录脚本） |

### 变异清单（5 条）

| 变异 | 期望红的断言 |
|---|---|
| M1 页面不再给「空榜成因」 | 6-② |
| M2 页面丢掉 `unmatchedCount`（回退成前端猜） | 6-⑤ |
| M3 wxml 删掉「成因说明」渲染行（回到光标题） | 6-⑨ |
| M4 未匹配行不再标来源平台 | 6-⑥ |
| M5 未匹配行丢失「口味询问类」标记 | 6-⑦ |

### 未做（列为下一批）

- **「查看 + 清除已导入数据」**：需新增云函数能力（列出/软删 `external_sales_daily`），
  会牵动「新增云函数四处同步面」（A15 白名单 / `core/10` 全集＋契约行 / 隐私收集项 / 幂等契约），
  属独立批次，需先定方案。
- **京东订单级账单数据的落点**：它现在**完全没有任何界面消费**（每天订单数 + 金额）。
  要么在导入侧立「已导入账单」列表，要么明确它只作对账用、不进复盘。

---

## 六、文件清单

| 文件 | 作用 |
|---|---|
| `_r251_probe.js` | 真云只读探针：`getDishReview` 回包（页面数据真相） |
| `_r251_cards.js` | 真云只读探针：成本卡名单 |
| `payload_r251.json` / `cards_r251.json` | **已脱敏**的纯 JSON 回包（下游直接读，不解析带表头的 txt） |
| `probe_r251.txt` / `probe_r251_cards.txt` | 人读档（**已脱敏**） |
| `_r251_sanitize.py` | 脱敏脚本（真名 → 占位名；原文另存 `_probe_tmp/r251_raw/`，**不入库**） |
| `_r251_verify.js` | 真调页面 `load()` 的行为验证（require hook 换桩 + 注入 setData） |
| `verify_r251_behaviour.txt` | 上述验证的原始输出（17/0） |
| `_r251_mutation.py` / `mutation_r251.txt` | 变异回灌（5/5 有效红） |

> 两个探针**零写入**：只调 `getDishReview` / `getCostCard`（纯读函数），不调任何写函数。
> ⚠️ client 侧直读 `external_sales_daily` 被 `DATABASE_PERMISSION_DENIED` 挡回 —— 这是**预期**
> （该集合权限为仅服务端），不是缺陷；真云判据一律以**云函数回包**为准。
