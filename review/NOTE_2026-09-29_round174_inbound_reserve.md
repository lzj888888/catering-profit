# R174 · 入站数据接入缝 预埋批次包（2026-09-29）

> **决策**：R174 战略纠偏后，唯一值得现在做的 AI 预埋 = **inbound 入站数据接入缝**（非出站对外档案）。
> 本文件是给 **快马 inscode** 的批次包依据；WorkBuddy 不在此改代码（代码归 inscode，纪律「先审后合」）。
> 定位依据见 `review/PLAN_ai_agent_b2b_diagnosis.md` §4.3。

---

## 〇、目的（一句话）

为**将来链接收银端（美团收银等 OAuth 授权）拿单品销量**预留最小入站数据骨架，**引擎计算逻辑零改动、零业务逻辑**，现在只建空表 + 定义 schema + 加一个关联字段。将来 OAuth 落地，只做「对方 payload → 此 schema」的映射。

---

## 一、改动点（inscode 照此落地）

### 1.1 `shop_dish_mapping` 模型新增字段 `external_ref_id`
- 类型：`string`，可选，默认空。
- 含义：平台菜品 ID（如美团收银菜品 ID），用于关联「收银平台菜品 ↔ 本系统成本卡（dish_key）」。
- 注意：**动机是"关联收银销量"，不是"对外曝光档案"**（旧 outbound 方案已作废）。
- 不动该集合任何现有字段与读写逻辑。

### 1.2 新增集合 `external_sales_daily`（空种子，仅 schema）
在 `initDb/collections.js`（或项目集合定义处）新增此集合，**只建空表 + 定义字段，现在不写任何写入/读取逻辑**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `shop_id` | string | 门店 ID |
| `biz_date` | string | 营业日期 `YYYY-MM-DD` |
| `external_ref_id` | string | 平台菜品 ID（关联 `shop_dish_mapping.external_ref_id`） |
| `dish_key` | string | 关联本系统成本卡行 ID（cost_card_row_id） |
| `qty` | number | 当日销量 |
| `amount` | number | 当日销售额（元） |
| `platform` | string | 来源平台枚举：`meituan_pos` / `other` |
| `source` | string | 数据来源：`oauth` / `manual` |
| `created_at` | date | 写入时间 |

- **唯一键**：`(shop_id, biz_date, external_ref_id)`。
- **现在不接任何平台、不写映射函数、不新增 OAuth 流程、不新增对外接口。**

### 1.3 不改动项（红线）
- ❌ 不改动任何引擎计算逻辑（成本/毛利/盈亏公式）。
- ❌ 不新增 OAuth / 授权流程代码。
- ❌ 不新增任何出站对外接口（`shop_public_profile` 等出站集合**不建**，旧 outbound 方案已作废）。
- ❌ 不新增 LLM / AI 调用。

---

## 二、门禁（新增/复跑）

- 复跑现有集合定义自检（确认 `external_sales_daily` 已注册、唯一键正确）。
- 新增断言：`shop_dish_mapping` 文档可写入 `external_ref_id` 字段（可选、默认值空）。
- 真值验收：向 `external_sales_daily` 插入一条 `(shop_id, biz_date, external_ref_id)` 记录，按唯一键二次插入应被拒（幂等/唯一约束生效）。

---

## 三、红线自检

- ✅ 纯 schema 预埋，零金额计算、零业务逻辑。
- ✅ 与 R170 批次（input.js 补贴出账口）完全独立、无冲突。
- ✅ 符合 R174 B2B 重定位（只做 inbound，不做 outbound）。
- ✅ LLM/AI 完全不碰（与 R165-167 一致）。

---

## 四、下一步（待 inscode 出码后）

1. inscode 按本清单改 `initDb/collections.js`（或对应集合定义处）+ `shop_dish_mapping` 模型。
2. WorkBuddy 跑门禁判红（集合注册 + 唯一键 + 字段可写）。
3. 提交带 pathspec + 回执 + 重启键回填（纪律 §7）。
4. OAuth 链路（美团收银）待 #1 主体资质拍板后再做——本批次**不含** OAuth 实现。
