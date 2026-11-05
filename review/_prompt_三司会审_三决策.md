> 🔴 **状态：已冻结（李老师 2026-10-31 裁定「暂时不上」）** —— **不得作为现行需求 / 排期 / 验收依据**；本文件仅作材料留档。
> 已证伪：①「M3 四象限已建」全仓零实现（规范 v1.1 D14 暂缓）②「只读跨店汇总仅需接钩子」低估并表口径 ③「三司一致」其中 DeepSeek 曾 401 缺位。
> 处置口径见 `review/NOTE_2026-10-31_三司会诊冻结处置.md`（含冲突清单与可复用资产）。

你是资深 SaaS 小程序架构与产品顾问。基于「店算」餐饮小程序（catering-profit）的真实代码现状，对以下三个决策给出**明确推荐 + 理由**，每条不超过 220 字。不要空谈，要结合我们已有的工程纪律。

## 已实地核查的真实现状
- **多店铺数据模型已存在**：`utils/shopSwitcher.js`（多店列表 + free_limit + hit_free_limit）、`getShopList` 返回 free_limit/hit_free_limit（"第 2 店起付费"钩子已在，默认 free_limit=1）、`api.js` 所有云调用自动注入 `app.globalData.shop_id`（单店隔离已成立）、`entitlement` 以 user_id 为主体跨店计费（payOrderList/payCallback 已确认）。
- **业态维度已存在**：`shop.biz_type` 是真实字段、`cloudfunctions/*/cx_indicatorRef.js` 是分业态×分城市层级参考带单源、`syncCostCard/index.js:69` 按 biz_type 取参考带下限。行业模板已是配置、统一利润底座。
- **智库共用层已半落地**：`utils/anomalyRules.js`（异常核对清单，只比本店历史中位数、不编行业基准、已接 M1 月度结果页 `subpkg/biz/month/result.js`）、`pages/m3/dishreview`（菜品成本-销量象限）、`cx_indicatorRef`（分业态参考带）。
- **真实缺口**：① 跨店聚合（`shop` 无 chain_id；`getCostCard/resolve.js:16,32,35` 已留 `opts.chainMerge` 预留注入点未接）；② 店铺级成员角色（仅后台 super/op，无店长/会计/只读）；③ M2 尚未接 indicatorRef；④ 原创/授权知识卡文案层未建。

## 我们的工程纪律（决策须遵守）
口径锁 + 单源原则；fail-closed（不确定的不出）；绝不编造行业基准/损失金额；付费墙红线（防店长共用老板微信绕过 M1 一家店真拦）；跨业态不可直接平均（必须先按业态×城市分层）。

## 三个决策
**决策一：连锁聚合层第一步做哪层？**
- A 先做「只读跨店汇总」（接 chainMerge 钩子，最小可见价值，不动成员角色）
- B 连锁总部 + 成员角色（店长/会计/只读）+ 行级鉴权 一步到位
- C 暂缓连锁

**决策二：是否让 M2（开店盈亏矩阵）接入 indicatorRef 出「店型健康度」？**（M1 有 anomaly、M3 有象限，M2 补齐即三模块诊断闭环）

**决策三：原创/授权知识卡层（整改方向文案）是否要做？**（最 optional，且必须原创/授权，绝不抓抖音/公众号洗稿）

## 输出格式
对每一决策给：最终推荐（A/B/C 或 做/不做）+ 核心理由（结合上面工程纪律）。最后用 3 句话总括优先级排序。
