# R688 取证：注销后数据实际无法清除的三条路径

> 起因：李老师要求就 #149/#150 与 DeepSeek、豆包商议口径。商议前先自己核实事实，
> 不拿未验证的猜测去问别人（问了也只会得到基于错误前提的答案）。

## 一、已确认为真的问题

### 1.1 🔴 第二个用户注销必然失败（代码 bug，非口径问题）

| 项 | 事实 | 取证 |
|---|---|---|
| 匿名值 | `ANON_OPENID = 'anonymous_' + '0'.repeat(12)` = **全局固定常量** | `cloudfunctions/deleteAccount/index.js:19` |
| 索引 | `idx_openid` **unique: true** | `cloudfunctions/initDb/collections.js` |
| 后果 | 用户 A 注销占用该值 → 用户 B 注销 update 撞唯一键 → **抛错，注销失败** | 脚本 `probe_anon_openid.js` 全部 PASS |

**为什么一直没被发现**：第 1 个注销的永远成功，第 2 个才炸。开发期通常只有 1 个测试账号。

**附带发现**：`getShopContext/cx_auth.js:81` 的 `user_id = genId('u_')` 是**随机生成**，不是 openid。
⇒ 主库匿名化后，`shop.user_id → user.user_id → user 文档（openid 已匿名）`，关联链**确实断了**。
⇒ DeepSeek 担心的「审计日志残留 openid」**不成立**，`operator_id` 存的是内部 `user_id`，不是 openid。
（此条我原先也怀疑过，核实后自行撤回。）

### 1.2 🔴 备份里的明文永久留存（删除被击穿 · 路径一）

- `dbBackup` 写云存储 `backup/<YYYY-MM>/<集合名>.json`，清单**包含 `user` 表**（`dbBackup/index.js:44-60`）
- 全仓**没有任何备份清理/轮转逻辑**（grep `keep/retain/清理/删除` 在 dbBackup 内零命中）
- ⇒ 主库把 `user.openid` 匿名了，但 `backup/2026-11/user.json` 里**原始 openid 明文永久留着**
- ⇒ 同理 `shop_monthly_income.json` / `shop_cost_card.json` 等经营数据也永久留副本

**这条比软删严重**：软删至少还在同一个库、能改；备份在对象存储里，没人会想起来去删。

### 1.3 🔴 审计日志里存着利润快照明文（删除被击穿 · 路径二）

- `saveLedger/index.js:227-243` 构造 `out`，`:255` 写成 `after_data: out`
- `out` 实际字段：`profit_ref`、`profit_true`、`amortize_fen`、`lump_sum_fen`、`real_consume_fen`、`member_sales_fen`、`traffic_count`
- ⇒ **月度利润、摊销、真实消耗、会员销售额、客流人次**，全部以明文快照形式落进 `audit_log`
- `syncCostCard` / `saveMaterial` / `importSalesBill` 同样模式（`after_data: out`）

**含义**：即使把 `shop_monthly_*` 全删干净，`audit_log` 里仍有每个月的利润数字。
「删除」在数据层面是假的 —— 不是因为我没写删除，而是因为**同一份数据在 3 个地方各有一份**。

### 1.4 软删之后没有恢复入口（用户端纯损失）

- grep `恢复 / restore / 已删除` 在 `pages/`、`subpkg/` 只命中「恢复菜品成本卡历史版本」，**与店铺无关**
- `manageShop` 只写 `is_deleted=true`，无任何 reverse 操作
- ⇒ 用户点删除后：**列表里看不到（以为删了）、数据还在（实际没删）、且恢复不了（软删的唯一好处也没给到他）**
- 这是三种状态里最差的一种

## 二、核实后**不成立**的说法（防我或外部 AI 说错）

| 说法 | 出处 | 核实结果 |
|---|---|---|
| 「你现在只能看不能导，缺查阅复制权」 | DeepSeek #7 | ❌ **不准确**。已有 4 处导出：月报（4 张表）、菜品成本卡 `m3_cards`、沙盘对比 `m2_compare`、矩阵 `m2_matrix`。缺的是**库存明细、员工工资、店铺档案**，属"导出不全"而非"不能导" |
| 「审计日志可能残留店名/员工姓名」 | DeepSeek #9 | ⚠️ **方向对、对象错**。实际残留的是**利润/摊销/客流金额**（见 1.3），不是姓名。姓名工资在 `shop_staff_*`，`writeAudit` 未涉及 |
| 「`loss_rate` 是死字段」（历史记录） | 我方旧记录 | ❌ 已于 R683 独立重算推翻（`calcBom/service.js:121` 有除法），队列 #146 登记"禁止再修" |

## 三、由上述事实推出的结论

**「注销后数据能不能真删掉」不取决于保留期定几天，而取决于有没有人真去删这三处副本。**
所以：先建清理任务（含备份轮转 + audit_log 脱敏），再谈保留期数字。顺序反了就是空谈。

保留期数字见 `R688_敲定方案.md`（待三方意见汇总后定稿）。
