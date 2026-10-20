# AUTO_QUEUE · 自驱任务队列（机器读）

> 用途：让「自驱接续」自动化**不需要人说话**就能知道下一步做什么。
> 规则：**按表从上到下取第一条 `status: todo` 且 `blocked: no`**，做完一条就停（一次只做一条）。
> 🔴 **认领制（2026-10-20 撞车后加）**：动手前先把该行改成 `in_progress` 再干活；
>   `in_progress` 的行**一律跳过**（别人正在做）。做完改 `done`，放弃则改回 `todo`。
>   为什么：16:29 那次自动化与人工同时做 #14，产出了两份 NOTE（代码没坏，但记录重复）。
> 维护：做完把状态改 `done` 并填 `commit:`；需要人决策的改 `blocked: yes` 并写 `why:`。
> ⚠️ 本文件是**队列**，不是报告。一行一条，超过 5 行的说明请放到对应 NOTE 里。

## 优先级规则（每次执行前先读这段）

1. **先价值后打磨**：会让老板"算错/看不懂"的 > 体验一致性 > 代码整洁。
2. **不碰禁区**：`calcCostCard` / `netUnitCostWan` / `lineNetCostYuan` / `wouldCreateCycle` 禁改源码。
3. **不猜外部数据**：没有样例就不设计列映射。
4. **不等人**：任何需要拍板的立刻标 `blocked: yes` + `why`，跳到下一条，**不要问用户**。
5. **一次一条**：做完 → 门禁 → 出码（改过 wxml/wxss 才要）→ 提交推送 → 回执 → 停。

## 队列

| # | 任务 | status | blocked | 依据 / 备注 |
|---|---|---|---|---|
| 1 | 补「损耗 100%」防御纵深守卫：喂 `calcBom/validate` 与 `saveCostCard/validate` 的 `loss_pct=100` 必须都拒；再加前提证明（绕过 validate 直喂引擎会得到非有限值），防判据恒真 | done | no | R381 已落（F-①/②/③，22→25 条，变异 2/2）；commit 9e87483 |
| 2 | 空明细预览：确认编辑页在"一行都没填"时会不会试算并显示「成本 ¥0.00 · 毛利率 100%」；若会，页面侧加"无有效行不试算" | done | no | R383 已落：实测空数组确实得 100%，已在 reverseCalc 前置拦截；commit e7c7187 |
| 3 | 成本卡编辑页：保存失败时的错误提示统一走"人话"（`api.js:47` 会把 fail 的 msg 覆盖成通用文案） | done | no | R384：`toastError` 超 14 字改 showModal（toast 会截断），ARCHIVED_LOCKED 文案补动作；commit e5b062a |
| 4 | 全站"空态"巡检：列表空 / 搜索无结果 / 未建档月 / 无成本卡 四类，逐页看有没有"白屏无解释" | done | no | R385：扫 23 页；真缺口=搜索无结果与空库同句（物料/菜品两页），已分开；commit c646938 |
| 10 | M2/M3 结果出参补「解释锚点」：`engine_version` / `bands_version` / `inputs_ref`（account_id 或 card_code+version），让未来 AI 解读能回溯到输入；不接模型 | done | no | R386：M2 两处出参已带 engine/bands 版本（bands 用内容哈希）；M3 inputs_ref 拆到 #14；commit e183dae |
| 14 | M3 `inputs_ref` 契约：`saveCostCard`/`getCostCard` 出参带 `card_code+version`（先定契约再改，别拍脑袋） | done | no | R387 已落：三处出参（saveCostCard / getCostCard / getCardVersions）同形状 `{kind,card_code,version}`，契约写进 core/10；守卫 34→37，变异 3/3；commit 34e1f76 |
| 15 | 补契约「fail-soft/覆盖度/截断」类出参（7 组）：getDishReview(truncated/coverageA/coverageC/unmatched)、getSalesBills(truncated/summary)、getShopContext(no_shop)、manageShop(replayed)、importSalesBill(platform_missing/dup)、exportData(format/encoding/content)、saveCostCard+saveMaterial(deleted)。逐条带「漏掉的后果」改，改一条验一条 | done | no | R391 已落：8 组里 2 组（getDishReview/getSalesBills）R301 已声明、复核不重复；实改 6 组；exportData 原 `task_id/file_url` 是未上线设计稿，整行纠正为同步直出。双面判据 16/16 + 变异 3/3；正文在 ec25a5e（被并发提交携带），证据 commit 19e4067 |
| 11 | 分享卡片结构化：`onShareAppMessage` 标题带可读结论句（如「本月保本 9160，月赚 8400」），不是只带小程序名 | done | no | R395 已落：三页（M1 结果 / M2 测算 / M3 菜品）接线，文案单源 terms.js + 装配单源 utils/shareCard.js，守卫 42 断言；门禁 190/190；commit bb5cbff |
| 12 | `shop_ai_consent` 授权模型设计（scope/有效期/撤回标记 + 撤回清缓存链路） | blocked | yes | why: **控制台侧已推进**——2 集合已建、4 索引建成 3 条（`NOTE_2026-10-21_控制台建集合与索引.md` §二）；仍卡两处：① 第 4 条三字段索引（对话框只容两行，需 AppSecret 走 `tools/apply_indexes.js`，或改窗口高度）② 落码前置=`shop_ai_*` **未登记进 `initDb/collections.js` 单源**（可自主补，但需先补单源再落码）。设计稿 `review/PLAN_2026-10-20_AI授权模型设计.md` 已就绪 |
| 13 | 异常核对清单·规则层（本店历史阈值，不调模型） | done | no | R396 已落：`utils/anomalyRules.js::buildChecklist`（5 规则 / 中位数基线 / 只出方向+幅度 / 历史<2 月不出项），自测 47 条；**前置缺口是误记** —— `getMonthList` 早已存在（`listMonths` 是名字猜错）⇒ 免改云函数免部署；页面接线留给 P1 话术层；commit 179b5b3 |
| 5 | 风格 A/B/C 铺开（先 3 页样板） | blocked | yes | why: 李老师未选型；选定后按「3 页样板→确认→全量」 |
| 6 | M3 三页视觉统一（物料/枢纽/成本卡） | blocked | yes | why: 依赖 #5 选定风格，否则返工 |
| 7 | 真机走查（矩阵横滑/吸底条/空态/清空月/下拉刷新） | blocked | yes | why: 只能李老师扫码 |
| 8 | `clearMonth` 超时 3s → 20s | done | no | R398 记账：控制台已改并**机器回读**（`cli cloud functions info` → `timeout=20`、`status=Active`）；证据 `review/NOTE_2026-10-21_控制台建集合与索引.md` §一A |
| 9 | 外卖销量表接入 | blocked | yes | why: 缺美团/京东样例（表名+列名+口径），不猜列 |
| 16 | 异常核对清单**页面接线**（#13 规则层的下游）：取数编排 `getMonthList` + 逐月 `getLedger`（≤lookbackMonths 次）→ `buildChecklist` → 月度结果页一张卡；历史 <2 月不出卡不给空壳 | done | no | 现状：`utils/anomalyRules.js` 已存在但**零生产调用**（全仓仅 selftest 引用）；判据=守卫须守「真 require + 真调用 + 入参字段与 `toSnapshot` 契约一致」，改 wxml ⇒ 需出码 | R399 已落：`loadChecklist`（≤6 次 getLedger，目标月复用出参）+ 结果页卡片 + 新守卫 24 断言；门禁 192/192；commit f09e4bd

## 回执格式（每次执行后追加到 `review/AUTO_LOG.md`）

```
- [YYYY-MM-DD HH:MM] R<n> <一句话> · 门禁 <N/N> RC=<0/1> · commit <sha> · 队列 #<k> → done
```
