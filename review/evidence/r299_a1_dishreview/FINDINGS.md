# R299-A1-① · M3 复盘页（dishreview）页面面深挖 · 取证与结论

日期：2026-10-16 ｜ 范围：`pages/m3/dishreview/index.js`(737) + `index.wxml`(307) + `cloudfunctions/getDishReview/*`
起点 HEAD：`ae3a7ee`（工作区干净，门禁 177/177）｜ C 线冻结

> 纪律：逐条**回源码取证**（不采信审计转述）；每条结论给出可复现的文件:行号。

---

## 0 一句话

承 R298Y（card 页面面）继续扫 M3 剩余页面面，在**复盘页**抓到 **3 组真缺陷 + 1 条待登记**：
① **覆盖率「共 N 道 / 已算 M 道」两个命名空间混算**（用户可见的错数）；
② **云函数出参 `truncated` 前端零消费** ⇒ 超上限时**静默少行**（横向 4 个云函数）；
③ **「去建卡/去映射」返回后页面不刷新**（R264 设计的闭环在返回这段断了）；
④ 登记：汇总卡无标题（`reviewTotals` 自引入起从未渲染）+ 该卡是**全渠道合计**却夹在堂食榜与外卖榜之间。

---

## 1 发现路径

| 步 | 动作 | 结果 |
|---|---|---|
| 1 | 读 `pages/m3/dishreview/index.js` 全文 + `.wxml` 全文 | 定位覆盖率计算块（js:343-366）与汇总卡（wxml:109-114） |
| 2 | 追 `coverageCount/coverageMatched` 的数据来源 | 发现两边都取 `.name`，而 `.name` 语义不同（见 §2） |
| 3 | 读 `cloudfunctions/getDishReview/service.js::rankReview` | 坐实：`ranked.name = card.name \|\| dishKey`（:95）vs `unmatched.name = dishKey`（:86） |
| 4 | 读 `cloudfunctions/getDishReview/index.js` 出参 | 发现 `truncated` 出参（:151） |
| 5 | 读 `cloudfunctions/common/dataAdapter.js` | 坐实原文要求「调用方**必须**把这个事实透传到出参（可见降级），不得当作'取全了'继续算」（:49-52） |
| 6 | 全仓 grep `truncated` 的消费方 | **前端零命中** ⇒ 静默少行 |
| 7 | 追「去建卡」闭环 | README 级注释（js:727-735）设计了跳转带菜名，但返回后**不刷新**（见 §4） |
| 8 | 查 `t.reviewTotals` 是否被渲染 | 从未（引入即死键，git `-S` 全程只命中 terms 与 js 的 `t` 映射） |

---

## 2 🔴 D1 · 覆盖率「道数」用两个命名空间混算（用户可见的错数）

### 2.1 缺陷

云函数对两类行写 `name` 时**语义不同**：

| 行类型 | 出处 | `name` 实际是什么 |
|---|---|---|
| **已匹配**（ranked） | `service.js:95` `name: card.name \|\| dishKey` | **成本卡名** |
| **未匹配**（unmatched） | `service.js:86` `name: dishKey` | **销量表原始菜名** |

而前端把两者塞进**同一个 Set**（`pages/m3/dishreview/index.js:351-360`）：

```js
const dishNames = new Set();
dineIn.forEach((x) => dishNames.add(x.name));            // ← 卡名命名空间
(takeaway||[]).forEach((b) => (b.ranked||[]).forEach((x) => dishNames.add(x.name)));  // ← 卡名
unmatched.forEach((x) => dishNames.add(x.name));          // ← 菜名命名空间
const coverageCount   = dishNames.size;
const coverageMatched = dishNames.size - new Set(unmatched.map((x) => x.name)).size;
```

### 2.2 后果（两个数都会错，零报错）

- **多张卡被同一张卡匹配时「共 N 道」少算**：菜品「可乐(罐)」「可乐(瓶)」都挂到卡「可乐」
  ⇒ ranked 两行的 `name` 都是「可乐」⇒ Set 里只剩 1 个 ⇒ **「共 N 道」少 1**，且「已算 M 道」同样少 1。
- **卡名与某个未匹配菜名碰巧同名时两个数一起错**：与上例叠加（Set 只剩 1，未匹配数仍是 1）
  ⇒ 显示「共 1 道 / 已算 0 道」，而真实是「共 2 道 / 已算 1 道」。
- 危害等级：**用户可见的错数**（不是静默错账，但会直接削弱"先建哪道最划算"的判断 —— 这正是 R264 做覆盖率的目的）。

### 2.3 为什么既有守卫没抓到

`tools/check_dishreview_engine.js` 的 **12-④** 只断言：

```js
check('12-④ 道数按菜名去重…', /dishNames\.add/.test(pageSrc) && /dishNames\.size/.test(pageSrc));
```

—— 只问「用没用 Set 去重」，**不问「去重用的那个字段在两侧是不是同一个命名空间」**。
与 R298Y 的「守卫只守分支在不在，不守分支到不到」同族：**守了形状，没守语义**。

### 2.4 修法

`fmtRanked` 把 `dish_key` 带出来（服务端**已经返回**该字段，前端此前丢弃），覆盖率两侧**统一按 `dish_key` 去重**。
`unmatched` 侧本来就有 `dishKey`（js:284）。零云端改动。

> ⚠️ 保留原公式语义（`共 = 两侧并集`；`已算 = 共 − 未匹配数`），只把**命名空间**统一。
> 跨平台"同一道菜在堂食匹配、在外卖未匹配"会被记为"未算全"—— 这是改动前就有的语义，本轮不改，登记备查。

---

## 3 🔴 D2 · 出参 `truncated` 前端零消费 ⇒ 静默少行（横向）

### 3.1 缺陷

`cloudfunctions/common/dataAdapter.js:49-52` 原文（`listAll` 的契约）：

> · `truncated === false` ⇒ data 就是**全部**命中行（用"短页"判据确认已取完）；
> · `truncated === true`  ⇒ data 已达 `LIST_TOTAL_CAP` 且仍有剩余 ⇒ 调用方**必须**把这个事实
>   透传到出参（可见降级），**不得当作"取全了"继续算**。

`LIST_TOTAL_CAP = 20000`（:32）。**服务端照做了**：

| 云函数 | 出参位置 |
|---|---|
| `getDishReview` | `index.js:151` `truncated: !!(salesRes.truncated \|\| cardsRes.truncated)`（在 `ok({...})` 内） |
| `getCostCard` | `index.js:98` `truncated: !!cardsRes.truncated`（在 `ok({...})` 内；同处注释还写着「**前端可据此提示**」—— 而前端从未提示） |
| `getSalesBills` | `index.js:72` `truncated,`（**简写属性**，在 `ok({...})` 内） |
| `manageShop` | ⚠️ **不在 `ok({...})` 里**：`index.js:208` 的 `truncated:` 是 `scanMonthly()` 的**内部返回**，而 `onStats`（op=stats）**把它丢掉了** ⇒ 「将永久删除 N 个月」的确认框拿到的 `months` 可能偏小且零提示（同文件 `op=reset` 路径**用了**它 ⇒ `decideReset` fail-closed） |

**但前端零消费**：`grep -rn "truncated" pages/ utils/ miniprogram/` ⇒ **空**。

⇒ 一旦某店销量行/成本卡版本行超过 20000，复盘榜、账单列表、成本卡列表都会**静默少行**，
页面照常渲染、无任何提示 —— 正是 M3-B6「导出只取前 1000 行 ⇒ 静默少卡」的**同一个恶**，
只是从「服务端截断」换到了「客户端不消费」。

### 3.2 消费点清单（全仓）

| # | 消费点 | 取的函数 | 是否用户可见的"列表" | 处置 |
|---|---|---|---|---|
| 1 | `pages/m3/dishreview/index.js:226` | getDishReview | ✅ 毛利榜 | **本批修** |
| 2 | `pages/m3/dishreview/index.js:458` | getCostCard | ✅ 关联 picker | **本批修** |
| 3 | `pages/m3/dishreview/index.js:621` | getSalesBills | ✅ 账单列表 | **本批修** |
| 4 | `pages/takeaway/index.js:284` | getCostCard | 辅助匹配 | 登记 |
| 5 | `pages/card/index.js:129` | getCostCard | ✅ 成本卡列表 | **本批修** |
| 6 | `pages/shop/switch.js:296` | manageShop(stats) | ✅ 清点量级（删除确认用） | **本批修** |
| 7 | `pages/m3/hub.js:86/87` | getCostCard / getSalesBills | 仅计数 | 登记（why：不渲染列表，只取 length） |
| 8 | `pages/recon/index.js:92` | getCostCard | 辅助匹配 | 登记 |
| 9 | `pages/takeaway/index.js:284` | getCostCard | 辅助匹配 | 登记 |
| 10 | `pages/card/edit.js:353` | getCostCard | 模板/子卡选择 | 登记 |
| 11 | `pages/card/index.js:363` | getCostCard | 单卡版本 | 登记 |

> 登记项**必须带 why**，并由新守卫 fail-closed 守住「不消费就得登记」⇒ 不许静默增长。

### 3.3 修法

- 新增单源 `utils/dataHealth.js`：`isTruncated(res)` / `truncatedText()` / `notifyTruncated(res)`。
- 文案进 `TERMS.ui.dataTruncated`（**双副本同步**），各页映射进自己的 `t`，页内渲染一行可见降级提示。
- 零云函数改动 ⇒ 待部署面不扩大。

---

## 4 🔴 D3 · 「去建卡 / 去映射」返回后页面不刷新

### 4.1 缺陷

- `pages/m3/dishreview/index.json`：`enablePullDownRefresh: false`（**无下拉刷新**）。
- `index.js:173` `onShow() { if (this.data.locked) this.init(); }` —— **只在 locked 时重载**。

而 R264 专门设计了「去建卡」闭环（`index.js:727-735`：跳建卡页并带菜名预填），
`goMap()` / `goNewCard()` / `goNewCard` 都会 `navigateTo` 走掉。**返回时页面全然不刷新**：

- 刚建好的卡**不进**关联 picker（`cardOptions` 还是旧的）⇒ 用户以为卡没建上，可能重复建；
- 刚挂上的菜**不进**毛利榜、`unmatched` 也不减少 ⇒ 用户以为关联失败。

对照：`pages/card/index.js:122` 就是 `onShow() { this.load(); }` —— 同仓同类只读页**有**返回刷新，
说明这是遗漏，不是设计选择。

### 4.2 修法

本页是**只读页**（无任何未保存输入）⇒ 返回时重载是安全且期待的：

```js
onLoad() { this._shown = false; this.init(); },
onShow() {
  if (this.data.locked) { this.init(); return; }   // 从付费弹窗返回后重试
  if (this._shown) this.load();                    // 返回本页 ⇒ 刷新（只读页，无未保存输入）
  this._shown = true;
},
```

---

## 5 ⏸ 登记项（登记不修，待拍板）

### 5.1 汇总卡无标题 + `reviewTotals` 死键

- `index.wxml:109-114` 渲染一张 4 格卡（份数/营收/成本/毛利）**无任何标题**；
- 它的数据源 `d.totals` 是 **全渠道合计**（`service` 的 `mergeTotals(dineTotals, takeawayResult.totals)`）；
- 它被夹在「堂食榜」与「外卖榜」之间 ⇒ **极易被读成堂食小计**；
- 术语 `reviewTotals: '汇总'`（terms 双副本 :1625）**自引入（`bcd3326` 批次G）起从未被任何 wxml 渲染**（`git log -S` 全程只命中 terms 定义与页面 `t` 映射）。
⇒ 说明当初就打算给这张卡一个标题，只是**没接上**。

**未改原因**：补标题＝改版式（设计与信息层级），属产品口径；且改动落在首屏主干上。
**建议**：用**已存在的** `reviewTotals` 给该卡加 `section-title`（零新增文案），或把它下移到外卖榜之后。
⇒ **待拍板**。

### 5.2 覆盖率分子/分母的跨平台语义

同一 `dish_key` 在堂食已匹配、在外卖未匹配时，现公式记为「未算全」。**改动前即如此**，本轮只统一命名空间，不改语义。登记备查。

---

## 6 与既有判据的关系

| 既有 | 覆盖 | 本轮补什么 |
|---|---|---|
| `check_dishreview_engine.js` 12-③ | pct 用金额口径 | 不动 |
| `check_dishreview_engine.js` 12-④ | `dishNames` 用了 Set | **补：两侧去重字段必须是同一命名空间（引用的 `x.X` 在两类行上都存在且有值）** |
| `check_page_terms.js` ①②③ | 术语键存在 / `t.X` 已映射 / 术语值不当字面量 | 不动（本轮新增 1 个术语键走它的腿①） |
| — | — | **新增** `truncated` 消费面判据（fail-closed 登记表） |
| — | — | **新增** 只读页「返回刷新」判据 |
