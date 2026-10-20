# AUTO_QUEUE · 自驱任务队列（机器读）

> 用途：让「自驱接续」自动化**不需要人说话**就能知道下一步做什么。
> 规则：**按表从上到下取第一条 `status: todo` 且 `blocked: no`**，做完一条就停（一次只做一条）。
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
| 10 | M2/M3 结果出参补「解释锚点」：`engine_version` / `bands_version` / `inputs_ref`（account_id 或 card_code+version），让未来 AI 解读能回溯到输入；不接模型 | done | no | R386：M2 两处出参已带 engine/bands 版本（bands 用内容哈希）；M3 inputs_ref 拆到 #14；commit 待回执 |
| 14 | M3 `inputs_ref` 契约：`saveCostCard`/`getCostCard` 出参带 `card_code+version`（先定契约再改，别拍脑袋） | todo | no | PLAN_AI §6 第 2 条；R386 只做了 M2 |
| 11 | 分享卡片结构化：`onShareAppMessage` 标题带可读结论句（如「本月保本 9160，月赚 8400」），不是只带小程序名 | todo | no | PLAN_AI §2；为"可被读懂"打底，不承诺被推荐 |
| 12 | `shop_ai_consent` 授权模型设计（scope/有效期/撤回标记 + 撤回清缓存链路） | blocked | yes | why: 需李老师在控制台建集合与索引；可先出设计稿 |
| 13 | 异常核对清单·规则层（本店历史阈值，不调模型） | todo | no | PLAN_AI §3/§8；纯规则，先出"偏离方向+幅度"，禁止"行业对标/挽损金额" |
| 5 | 风格 A/B/C 铺开（先 3 页样板） | blocked | yes | why: 李老师未选型；选定后按「3 页样板→确认→全量」 |
| 6 | M3 三页视觉统一（物料/枢纽/成本卡） | blocked | yes | why: 依赖 #5 选定风格，否则返工 |
| 7 | 真机走查（矩阵横滑/吸底条/空态/清空月/下拉刷新） | blocked | yes | why: 只能李老师扫码 |
| 8 | `clearMonth` 超时 3s → 20s | blocked | yes | why: CLI 无改配置能力、无 tcb 登录态 ⇒ 需控制台或腾讯云密钥 |
| 9 | 外卖销量表接入 | blocked | yes | why: 缺美团/京东样例（表名+列名+口径），不猜列 |

## 回执格式（每次执行后追加到 `review/AUTO_LOG.md`）

```
- [YYYY-MM-DD HH:MM] R<n> <一句话> · 门禁 <N/N> RC=<0/1> · commit <sha> · 队列 #<k> → done
```
