# R254 · 真云只读探针 + 修复「主结论卡 totals 只算堂食」

> 一句话：**R252/R253 都已真云生效；但顺着把数据读出来一看，主结论卡在有外卖、没堂食时恒显示 0。
> 本轮定位、修复、落守卫、上云，并用同一条探针在真云前后各取一次数自证。**

- 日期：2026-10-09（接 R253b 部署之后）
- 通道：**模拟器 + 逻辑层 `mp.evaluate`**（`cli` 无 `invoke` 子命令，命令行拿不到云函数运行结果）
- 证据：`probe_cloud_r254.js` · `probe_before_fix.json` · `probe_after_fix.json` ·
  `deploy_getDishReview_r254.log` · `gate_158_r254.txt` · `mut_r254.py` / `mut_r254b.py`

---

## 一、为什么要走这条路

上一轮（R253b）把 `getDishReview` / `importSalesBill` 部署上云后，`review/evidence/r253_gate/deploy/README.md`
§五留下三条「待真机复验」。但：

- **A1 映射生效** 需要 `shop_dish_mapping` 里有记录 —— 写库只能走控制台或新云函数，命令行没有写入通道；
- **A3 / R249 复验** 需要 `wx.chooseMessageFile` 从**微信聊天会话**里挑 `.xlsx`，模拟器里做不到。

而**只读**那半边（`getSalesBills` / `getDishReview`）**可以自己闭环**：
在真实小程序上下文里 `wx.cloud.callFunction`，拿真云返回。本轮就走这条。

---

## 二、通道配方（本机可复用，省一轮摸索）

| 步 | 判据 / 命令 | 本轮实测 |
|---|---|---|
| ① 判 IDE 在不在 | **枚举窗口，不是 `tasklist`**；`237×39` = 最小化，**先 focus 再下结论** | `win_gui.py list` → `Chrome_WidgetWin_1 237x39` → `focus --title "WeChat Web Devtools"` → 变 `1878x1035` ⇒ **GUI 一直在** |
| ② 起自动化 | `cli.bat auto --project <仓根> --auto-port 9420 --trust-project`（🔴 **`--trust-project` 不能省**） | rc=0 |
| ③ 探端口 | `new WebSocket('ws://127.0.0.1:9420')` 只有自动化服务会 OPEN | **9420 OPEN** |
| ④ 预热 | `cli auto` 后 **60–90s** 再 connect | 首跑 `timeout waiting for automator response`；**sleep 60s 后重跑即通** |
| ⑤ 导航 | **逻辑层 `wx.reLaunch`**（`mp.reLaunch` / `page.*` 因 pageMeta 恒 null 全死）✅；一条连接内跑完 | 进 `/pages/m3/dishreview` |
| ⑥ 形态判据 | `BIZ` = 结果含 `"code":`；`SHELL` = 含 `tcbContext`（空壳） | 三个函数均 **BIZ** |

### 🔴 我第一版探针自己踩的坑（R242e 第四次）

```js
await call('getDishReview', {})        // ❌ 返回 INVALID_PARAM
```

`utils/api.js::call` 会**自动注入** `shop_id`（`Object.assign({ shop_id: globalData.shop_id }, payload)`），
而裸调 `wx.cloud.callFunction` **不会注入** ⇒ `assertShopOwner(db, undefined, …)` 拒参。

⇒ 差一点把「探针入参写错」报成「复盘功能坏了」。
**判据：看到 `INVALID_PARAM` 先核探针有没有带 `shop_id`，再怀疑后端。**

---

## 三、真云事实（修复前）

`getSalesBills`（R252）— **BIZ / SUCCESS**：

```
active_bills 49 · active_rows 396 · active_qty 291 · active_amount_fen 615869（¥6158.69）
platforms ['jd_order','taobao'] · cleared_bills 0 · unknown_rows 0 · truncated false
```
⇒ **R249「导入了却读不出来」已闭环**：taobao 的 51 道菜真读得出来（此前是「落库 354 行却全程空态」）。

`getDishReview`（R249/R253）— **BIZ / SUCCESS，但**：

```
dine_in []                      ← 没导入堂食数据
takeaway.by_platform.taobao     ← ranked 0 / unmatched 51
takeaway.by_platform.jd_order   ← ranked 0 / unmatched 0
totals  {"qty":0,"amountFen":0,"costFen":0,"grossFen":0,"dishCount":0,"unmatchedCount":0}
```

**矛盾点**：平台块里明明白白有 51 道菜、¥1823.08，而 `totals` 全 0。

---

## 四、缺陷定位（源码坐实）

`cloudfunctions/getDishReview/index.js`（修复前）：

```js
const { dine_in: ranked, unmatched, totals } = buildDishReview(dineIn, cards, deps);   // ← 只堂食
const takeawayResult = buildTakeawayReview(takeawaySales, cards, deps);                 // ← totals 被丢弃
return ok({ …, totals, … });
```

而前端主结论卡渲染的正是这个顶层 `totals`：

- `pages/m3/dishreview/index.js:177` → `const totals = this.fmtTotals(d.totals);`
- `pages/m3/dishreview/index.wxml:48-52` → `{{totals.qty}}` / `{{totals.revenueText}}` / `{{totals.costText}}` / `{{totals.grossText}}`

⇒ **纯外卖店铺（本仓真云现状）主结论卡恒显示「份数 0 / 营收 ¥0.00 / 成本 ¥0.00 / 毛利 ¥0.00」**，
而同一屏下面列着 51 道菜。**这比空态更误导** —— 空态至少不会让人以为自己导错了。

（`buildTakeawayReview` 内部那份 totals 本来算得对，只是没被顶层用上。）

---

## 五、修法

1. `service.js` 新增纯函数 **`mergeTotals(a, b)`**（六字段逐项相加；缺省入参按 0，不抛不 NaN）
2. `index.js` 顶层 `totals = mergeTotals(dineTotals /*堂食*/, takeawayResult.totals /*外卖*/)`

口径与 `rankReview` 同源不变：`qty / amountFen` **含未匹配**（卖了就算营收），
`costFen / grossFen` **只算已匹配**（未匹配无成本可算）。

---

## 六、守卫（段 ⑧ 加进既有 `tools/check_dishreview_engine.js`，60 → **68** 断言）

判据仍走「真调生产纯函数 + 源码面反恒真」，不靠字面扫描：

| # | 判据 |
|---|---|
| 8-① | `mergeTotals` 已导出且六字段逐项相加（真调） |
| 8-② | 缺省入参按 0（不抛、不产出 NaN） |
| 8-③ | **纯外卖店铺**：堂食 totals 全 0，合并后 `qty` 必须 = 外卖 qty = 6（绝不为 0） |
| 8-④ | 合并后 `amountFen` = 2720，`unmatchedCount` = 2 |
| 8-⑤ | `index.js` 顶层 totals 走 `mergeTotals`（剥注释后查调用点） |
| 8-⑥ | 旧写法「只从 `buildDishReview` 取 totals」已绝迹（反恒真） |
| 8-⑦ | `mergeTotals` 从 service 单源取，`index.js` 不得内联第二份 |
| 8-⑧ | 自失效护栏（扫描面非退化 + 关键锚点在场） |

### 🔴 变异回灌里抓到守卫自己的 bug（先证伪自己的又一次）

8-⑥ 首版正则写成 `/\{\s*[^}]*\btotals\s*[,}][^}]*\}\s*=\s*buildDishReview\s*\(/`：
`[,}]` **把闭括号吃掉了**，旧形态 `unmatched, totals }` 反而匹配不上 ⇒ **假绿**（M1b 实证）。
改为 `\s*,?\s*\}`（逗号可选、闭括号单独匹配）后：

| 样本 | 结果 |
|---|---|
| 旧形态 `{ …, unmatched, totals } = buildDishReview(` | `true` ✅ 抓得到 |
| 新形态 `{ …, unmatched, totals: dineTotals } = buildDishReview(` | `false` ✅ 不误伤 |
| 新形态 + 尾项 | `false` ✅ |

### 变异回灌结论

| 变异 | 转红断言 |
|---|---|
| M1 `index.js` 退回只取堂食 | **8-⑤** |
| M1b 旧解构形态（`totals: dineTotals` → `totals`） | **8-⑥**（修正后）· 8-⑤（连带，语法上两者互斥，无法只红其一） |
| M2 `mergeTotals` 只返回堂食那份 | **8-① / 8-③ / 8-④** |

还原后 md5 全等（`index.js e3e61259…` / `service.js 2e76e2b3…`），基线 **68 通过 / 0 失败**。

---

## 七、部署判据（不看 rc）

```
$ python review/evidence/_deploy_fns.py getDishReview
ENV = cloud1-d4gphpoxy337f2a25   待部署 1 个: getDishReview
[getDishReview] try1 rc=0 用时=21.4s HIT
   │ getDishReview │ true │ 19 │ '50.7 KB' │
   完成行 `deploy cloudfunctions` : ✅ 有       ALL_ROWS_HIT = true | DONE = true
---- 1/1 OK ----
```

- 部署面 **1 个**（本轮未动 `cloudfunctions/common/`，`git diff --cached --name-only | grep -c common/` = **0**）
- filesCount 19 ≡ 本地目录文件数 19 ✅

---

## 八、真云复验（部署后同一条探针再跑一次）

| `getDishReview` | 修复前 | 修复后 |
|---|---|---|
| `totals.qty` | 0 | **118** |
| `totals.amountFen` | 0 | **182308**（¥1823.08）|
| `totals.unmatchedCount` | 0 | **51** |
| `totals.costFen / grossFen / dishCount` | 0 | 0（**正确**：51 道菜全未匹配，无成本可算，红线 17 不静默归零）|

🔴 **锚点互证**：`qty 118` / `¥1823.08` 与 R232 真样例的**独立复算值**（Σ销量 118 / Σ销售额 1823.08）
**逐位吻合** ⇒ 不是「看起来有数了」，是数对了。

---

## 九、仍然存在的缺口（真云坐实，不是推断）

1. **51 道菜全部 `unmatched`，`ranked` 一条都没有** ⇒ 单品毛利**算不出来**（cost/gross 恒 0）。
   菜名形如「★发鱿鱼」「【超豪华】耙牛肉六荤六素单人套餐(含米饭)」，与成本卡名「耙牛肉」字面不等。
   ⇒ **这正是 R253 接线的 `shop_dish_mapping` 要解决的**；映射表目前空 ⇒ 用户价值仍为 0。
   ⇒ **M4（映射表 UI + `saveDishMapping` 云函数）的必要性已被真云坐实。**
   🔴 客户端直读 `shop_dish_mapping` / `external_sales_daily` 均返回
   `DATABASE_PERMISSION_DENIED` ⇒ **造映射记录只能走新云函数，不能靠前端直写**。
2. **京东 `jd_order`：有 49 条账单，复盘里 0 条** —— 订单级行没有 `dish_key`，
   `rankReview` 按设计跳过 ⇒ 前端显示「该平台只有账单级数据」（`reviewPlatformBillOnly`）。
   不是 bug，但**京东导入了却只能看账单、做不了单品毛利**，是既有旧账。

---

## 十、门禁

- 改了 `tools/**` 套件 ⇒ **刷 gitcache 是门禁前置**（不刷会假红，本轮实证：
  首跑 157/158 红在 `suite-assert-counts`，把该键刷新为 75/0 后 **158/158**）。
- 最终 **158/158 套件通过** · RC=0（`gate_158_r254.txt`）
- 重启键断言数声明行 `check_dishreview_engine` 60 → **68**（套件数不变 158：改既有守卫不算新增套件）
