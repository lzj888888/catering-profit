# R173 · 数据可信底座预埋规格（#5，2026-09-29）

> **定位**：R172（R6–R8 与豆包）结论里**唯一"现在不做、将来必返工"的 AI 预埋**。
> 豆包 R8 把「门店可信数字档案对外只读接口（P1）」列为最高优先级，但**没设计"数据如何变可信"**——
> 没有防篡改背书，「对外档案」就是空话，食客 Agent 不会采信（见 R172 我方盲区 #5）。
> 本规格纯架构、零业务逻辑、**不碰任何金额计算**（与 R165-167 红线一致）。给 inscode 的 v1.0 预埋批次包依据。

---

## 一、为什么现在就要埋（不做会怎样）

- 阶段 3（食客 Agent 自主订餐，≈2032）的**前置条件**不是"功能"，而是"食客 AI 能信任你的数据"。
- 信任 = **可核验、不可事后篡改、可溯源**。若 v1.0 的成本卡/经营数据没有版本快照与哈希链，
  阶段 3 要对外暴露时，只能**回过头重算历史数据 + 补签名**，返工成本极高（且历史已不可重来）。
- 现在预埋**几乎零成本**：成本卡本就是**版本模型（只 INSERT、不 UPDATE）**，审计链 `operation_confirm_log` 已存在，
  只需加**哈希字段 + 一条签到集合**，不引入任何新业务计算。

---

## 二、架构（三层，纯只读背书）

```
┌─ 成本卡版本快照（已有：shop_cost_card 版本模型，仅 INSERT）
│     └─ 每版本多一个 dataHash（该版本全部字段的稳定哈希）
├─ 审计链（已有：operation_confirm_log）
│     └─ 加 request_source 字段（R8 已点名，标记"谁发起的这次确认"）
└─ 可信签到（新增可选集合 trust_attestation）
      └─ 门店 / 月份 / 数据 hash / 签到时间 / 签到方（老板本人·设备指纹·可选第三方）
```

**信任判据（给未来食客 Agent 用的只读 API）**：
`可信 = 存在 dataHash 且 operation_confirm_log 有对应确认且（可选）trust_attestation 已签到`。
任一缺失 ⇒ 对外接口返回 `trust_level: unverified`，前端标注"数据未经核验"，**绝不伪造信任**。

---

## 三、预埋清单（字段级，inscode 照此建）

### 3.1 已有集合加字段（不新建表）
| 集合 | 加字段 | 类型 | 说明 |
|---|---|---|---|
| `shop_cost_card`（版本模型） | `dataHash` | string | 该版本快照全部业务字段的稳定哈希（SHA-256）；INSERT 时算，之后不可变 |
| `operation_confirm_log` | `request_source` | string | 标记确认发起方：`boss_manual` / `auto_sync` / `external_api` / `agent_session`（R8 已点名） |
| `shop_dish_mapping` | `external_ref_id` | string | 外部系统（炒菜机/智能秤/外卖平台）引用键，R8 已点名 |

### 3.2 新增可选集合（v1.0 先建空表，阶段 3 才填）
| 集合 | 字段 | 说明 |
|---|---|---|
| `trust_attestation` | `_id, shop_id, month, dataHash, signedAt, signerType, signerId, sig` | 数据可信签到；v1.0 仅老板本人可签，第三方/外部 Agent 待阶段 3 开放 |

### 3.3 哈希计算约定（防歧义）
- 哈希输入 = **业务字段 JSON（key 按字典序）+ 版本号**，排除 `_id / _openid / createTime / dataHash` 等元数据。
- 统一在 `common/` 落一个 `hashSnapshot(obj)` 工具（单源），前端 INSERT 与云函数共用，避免两端算法不一致。
- ⚠️ **哈希只作背书，绝不作为任何计算输入**（红线：核心金额只能引擎算）。

---

## 四、与已锁红线的一致性

- ✅ 纯架构、零金额计算 ⇒ 不触碰 R159 付费墙 / R165-167 引擎红线。
- ✅ `dataHash` 不参与利润/成本计算，只用于对外信任判据。
- ✅ 不预埋 LLM 调用（R166：阶段 3 才上 LLM，且 AI 不碰金额）。
- ✅ 与 R8「AI 预留清单」完全对齐（shop_public_profile 等对外接口未来消费这里的 trust_level）。

---

## 五、时机与边界

- **现在做**：3.1 三字段 + 3.2 空集合 + 3.3 哈希工具（一次性，几乎零风险）。
- **阶段 3 才做**：trust_attestation 实际写入、对外只读接口（shop_public_profile）的 trust_level 返回、外部 Agent 读取鉴权。
- **不做**：任何把"可信度"反算进经营指标的逻辑（那是伪需求，且违反红线）。

---

## 六、门禁（建议新增）

- `tools/selftest_*.js` 增一条：INSERT 成本卡版本后断言 `dataHash` 非空且等于 `hashSnapshot(该版本业务字段)`。
- 增一条：`operation_confirm_log` 写入断言 `request_source` 必填且 ∈ 枚举。
- 增一条：`hashSnapshot` 对"同业务字段不同元数据"产出**相同** hash（幂等性）。

---

## 七、下一步

1. inscode 把本规格并入下一批次（建议与 R170 改动同批，都是小改、互不冲突）。
2. WorkBuddy 跑门禁判红。
3. 真云用探针验证 `dataHash` 写入 + 幂等（云函数 INSERT 实测，非本地模拟）。
