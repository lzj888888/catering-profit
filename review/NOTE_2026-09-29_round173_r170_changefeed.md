# R173 · R170「方案1」投喂快马改动清单（2026-09-29）

> **决策**：李老师「听你的，当下先做」⇒ 选定 R170 笔记 §五 的**方案1**（最低风险、不碰任何金额口径）。
> 本文件是给 **快马 inscode** 的批次包依据；WorkBuddy 不在此改代码（代码归 inscode，纪律「先审后合」）。
> 根因与真值验证见 `review/NOTE_2026-09-28_round170-外卖利润口径真值代入订正.md`（已锁结论，不再复述）。

---

## 〇、要修的病（一句话）

快速模式（默认录入路径）要求老板填「商品总价 + 打包费 + 商家承担补贴」**三项之和这一个数**，
这个数已经**含补贴**进了收入侧，但费用侧「外卖活动补贴」**只在分项模式**自动带出
（`syncSubsidyCarry` 首行 `if (takeoutMode !== 'detail') return;`，`pages/month/input.js:978`）。
⇒ 费用侧补贴 = 0 ⇒ **利润虚高整整一个补贴额（8 月实测 2069.70）**。

分项模式是对的（真值 3779.65 命中），**只修快速模式这条默认路径**。

---

## 一、方案1 做法（已定）

快速模式每条平台行**新增一个可选填框「其中：商家承担补贴（元）」**：
- 不填 = 维持现状（兼容老用户、不强制）；
- 填了 = **带出到费用侧「外卖活动补贴」**（复用现有 `twCarryLock` 手改保护，与分项模式同一条带出链路）。
- **文案不动**：`fastHint`（terms.js:320）本来就叫填「三项之和」，新增「其中：商家承担补贴」正好自洽，不算改口径。

> 收入侧那个「一个数」继续含补贴不变（这是对的会计处理：补贴一进一出净额为零）。
> 方案1 **只补费用侧出账口**，金额口径零改动。

---

## 二、函数级改动点（inscode 照此落地）

### 2.1 数据模型：快速模式平台行加 `subsidy` 字段
- `pages/month/input.js` 快速模式 takeaway 行（来自 `incomeGroups` 中 `category==='takeaway'` 的 `g.rows`）现只有 `subItem / amountYuan / qty`。
- **新增** `subsidy`（number，可选，默认空）。

### 2.2 模式切换要搬运 `subsidy`（否则切模式丢值，R162 同族病）
- `onPickTakeoutMode` 快速→分项（约 `input.js:839-845`）：快照映射现写 `subsidy: ''` ⇒ 改为 `subsidy: r.subsidy || ''`。
- 分项→快速（约 `input.js:851-862`）：收拢成单行时，把分项 `subsidy` 收进 `g.rows[].subsidy`（与 `amountYuan = subtotalOf(goods,pack,subsidy)` 并存，二者独立）。

### 2.3 核心：放开 `syncSubsidyCarry` 对快速模式的 `return`
- `input.js:977-1000` `syncSubsidyCarry()`：
  - 删掉首行 `if (this.data.takeoutMode !== 'detail') return;`。
  - 计算 `total` 改为「两模式取数」：
    - 分项：`subsidyTotal(this.data.takeoutDetailRows)`（现状）；
    - 快速：`(g.rows||[]).reduce((s,r)=> s + (Number(r.subsidy)||0), 0)`。
  - 其余带出逻辑（找 `外卖活动补贴` 行、`twCarryLock` 守卫、幂等 `cur===target`）**原样复用**，不动。

### 2.4 配平校验 `runReconcile` 补快速模式补贴
- `input.js:941-972` `runReconcile` 现 `const subsidy = rows.reduce(...)` 只取分项 `takeoutDetailRows`（行 953）。
- 改为：若 `takeoutMode==='fast'`，`subsidy = (g.rows||[]).reduce((s,r)=> s + (Number(r.subsidy)||0), 0)`；否则取分项（现状）。

### 2.5 页面 wxml：快速模式平台行加输入框
- 快速模式 takeaway 平台行模板（对应 `takeoutMode==='fast'` 的 `incomeGroups` 渲染处）新增一行小输入框：
  - placeholder 取自 `TERMS.ledger.takeawayMode.subsidyField`（已存在 = `商家承担全部补贴（合计）`）；
  - 绑 `input` 事件 → 写 `g.rows[i].subsidy` → 调 `syncTakeoutSum()`（它内部已调 `syncSubsidyCarry`）。

### 2.6 文案（**必须同步**，R166 算法与文案同步铁律）
- `fastHint`（terms.js:320）末尾追加一句：「如知商家承担补贴金额，可填到每平台『其中：商家承担补贴』框，系统会自动计入费用，利润更准。」
- `fastPh`（terms.js:328）保持「商品总价+打包费+活动补贴（元）」不动（该框仍是含补贴的一个数）。

---

## 三、门禁（新增/复跑）

- 复用 `tools/selftest_r85.js` 现有 A8（带出实现 + `twCarryLock` 守卫）覆盖放开的 `syncSubsidyCarry`。
- **新增 A8b**：快速模式填 `subsidy` → `setData` 后断言 `外卖活动补贴.amountYuan === 该值` 且 `twCarryLock===false`。
- **新增 A8c**：快速模式 `subsidy` 留空 → 断言 `外卖活动补贴` 不被强制带出（兼容老用户）。
- **新增 A17b**：`runReconcile` 在快速模式下用 `g.rows[].subsidy` 参与差额计算（非 0）。
- 真值验收（8 月淘宝闪购）：快速模式填「一个数 = 6585.08」+ 每平台「其中补贴 = 2069.70」→
  费用侧 `外卖活动补贴` = 2069.70 自动带出 → 利润口径命中 **3779.65**（与分项模式一致）。

---

## 四、红线自检

- ✅ 未改任何金额计算公式（收入合计、配平式 `reconcile` 数学结构不变）。
- ✅ 仅「补费用侧出账口」，符合 R159/R164/R170 已锁口径。
- ✅ 复用 `twCarryLock`，不破坏 R85 手改优先逻辑。
- ✅ LLM/AI 完全不碰（与 R165-167 一致）。

---

## 五、下一步（待 inscode 出码后）

1. inscode 按本清单改 `pages/month/input.js` + `miniprogram/i18n/terms.js` + 对应 wxml + `tools/selftest_r85.js`。
2. WorkBuddy 跑门禁（114 套件 + 新增 A8b/A8c/A17b）判红。
3. 真机/真云用 8 月账单代入验收（3779.65 命中即闭环）。
4. 提交带 pathspec + 回执 + 重启键回填（纪律 §7）。
