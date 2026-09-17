# REVIEW_2026-09-15 round34 · 真云三验执行单（可直接交给李老师或授权自动化）+ R81

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 34 轮**。**新开文件**（协议 §2）。
> 本份**不是**评审，是**执行单**：三验的逐步操作 + 入参 JSON + 期望输出 + 失败判读 + 留证要求。所有入参与期望值**从实现里逐字提取**（纪律 21），出处标注在每一处。
> 背景：**40/40 索引已建成**（`review/evidence/index_buildout_20260917/`）⇒ **验二的前置已满足**，真云三验是**最后一个未完成的技术验证**。

---

## §0 一句话 + 三个前置

| 前置 | 状态 |
|---|---|
| 云环境 dev = `cloud1-d4gphpoxy337f2a25`、25 集合 | ✅ 已建 |
| 索引 40/40（含 `idx_card_code_version` 复合唯一） | ✅ **已建**（2026-09-17） |
| 能触发业务函数（真实 OPENID） | ⚠️ **见 §1 —— 这是最容易白跑的一环** |

**三验 = ① `smokeTest` 探针 ② 真云多版本写入 ③ 真云两月 `calcAmortize`。**

---

## §1 ⚠️ 先说一个会让人白跑的机制事实：控制台「测试」**调不动业务函数**

- 出处：`cloudfunctions/common/auth.js:27-28` —— `const OPENID = ctx && ctx.OPENID; if (!OPENID) return { error: ERROR_CODES.UNAUTHORIZED };`
- 控制台「云函数 → 测试」触发的调用**没有真实 OPENID**（OPENID 只在**小程序端调用**时由微信注入）⇒ `calcAmortize` / `saveCostCard` / `saveAsset` 等**带 `resolveAuth` 的函数在控制台一律返回 `{"error":"UNAUTHORIZED"}`**。
- ⇒ **看到 `UNAUTHORIZED` 是预期的，不是缺陷**；也**不要**为了跑测试去注释掉鉴权（那会绕过点1/点2 两条铁律）。
- 能在控制台跑的**只有 `smokeTest`** —— 它刻意不依赖鉴权（`smokeTest/index.js:43` 的 `exports.main` 无鉴权）。**这很可能就是三验一直挂起的技术原因。**

**三条可行路径（我的推荐顺序）**：

| 路径 | 怎么做 | 能验什么 | 代价 |
|---|---|---|---|
| **A（推荐）** | 微信开发者工具里**跑小程序页面**：成本卡页保存两次 / 月份结果页跑两月 | **端到端**（含鉴权链、DataAdapter、真库写入） | 工具里点几下；**最接近真实用户** |
| B（备选） | 照 `smokeTest` 写一个**一次性免鉴权探针**（内部直调 `service`），部署→控制台触发→**删函数** | 真云 DB 形态 + 索引行为（不含鉴权链） | 多一个函数要删；**不得提交进仓库** |
| C | 控制台直接**读/写数据**（数据库面板） | 索引是否**真在生效**、数据形态 | 覆盖不到函数逻辑 |

---

## §2 验一 · `smokeTest` 探针（免鉴权 · 控制台 3 分钟）

**步骤**（照 `SMOKETEST_RUNBOOK.md:112-114`）：云函数 → `smokeTest` → 右键「测试」→ 入参 **`{}`** → 运行 → **把完整 JSON 复制出来**。

**期望输出（逐字段，出处 `SMOKETEST_RUNBOOK.md:117-128`）**：

| 返回字段 | 期望 | 若不符 → 动作 |
|---|---|---|
| `env` | 非空、= `cloud1-d4gphpoxy337f2a25`（**不含 dev 字样属正常**，走 `DEV_ENV_ID` 白名单） | 空/ERR → 先修环境 |
| `requireCommon.ok` | `true` | `false` → **机制失效**，全部云函数返工 |
| `requireCommon.exports` | 含 `assertShopOwner` 等 | 缺导出 → 重跑 `node tools/sync_common.js` |
| **`docGet.hasDataField`** | **`true`** | **`false` → A1/A2 修反了，立刻回退**（最关键翻案点） |
| `docGetMissing.behavior` | `resolve`(+`data:null`) 或 `reject` 都算"契约明确" | 哪种都正确 |
| `createIndex.typeof` / `.call` | `function` / `OK`（**A7 已定案为不支持，这里只是复核**） | `undefined`/THROW → A7 结论复现 |
| `uniqueEnforce.result` | 含「**报错（符合预期）**」 | 含「未报错」→ 唯一索引未生效 |
| `assertShopOwner` | `RESOURCE_NOT_FOUND` | 抛异常/恒 `FORBIDDEN` → A1 修复在真云不成立 |
| `createCollection` | `{ok:true}` 或 `ok:false` 且 msg 含「已存在」 | 其余 → 先修权限再重跑 |
| `dataAdapterGet` | `liveIsDoc:true` **且** `deadIsNull:true` | `deadIsNull:false` → **A2 不成立须回退** |
| `fsDiag.commonShape` | `flat-file(common.js)`（**R29 真判据**） | `ABSENT(...)` → common 没打进包 |

**清理**（`SMOKETEST_RUNBOOK.md:141-143`）：控制台「数据库」→ **手删 `probe_tmp` 集合**（SDK 不能 drop collection）；`smokeTest` 函数可删（可选）。
**留证**：完整 JSON 原文（**不要只贴结论**）+ 截图 → 归档 `review/evidence/realcloud_20260917/01_smokeTest.json`。

---

## §3 验二 · 真云多版本写入（`saveCostCard` · **走路径 A**）

**前置**：① 该店已有 ≥1 个原料（`shop_material`；没有就在小程序成本卡页新建一个）；② 记下**当前店铺的 `shop_id`**。

**入参契约（出处 `saveCostCard/validate.js:10-18`、`index.js:146-162`）**：`card.card_code` **不传 = 新建卡（服务端生成 `cc_…`，version=1）**；**传上次返回的 `card_code` = 同卡新版本（version = 该卡最大版本+1）**。

**三个子验合在一次操作里（这是本份最值钱的一段）**：

| # | 操作 | 期望 | 说明 |
|---|---|---|---|
| 1 | 保存**不带** `card_code` | `code:'SUCCESS'`、`data.card_code = cc_…`、`data.version = 1` | 新建 |
| 2 | 保存**带上** #1 返回的 `card_code`，**换** `client_request_id` | `data.version = 2`；库里同 `card_code` **两行并存、v1 未被改** | **多版本写入**（R38 的核心命题） |
| 3 | 保存**同 `card_code` + 同 `client_request_id`** | **返回首次结果**、版本不增、库里不新增行 | **幂等重放**（R73 重放形态） |

**入参 JSON 模板**（⚠️ `mode` **只能大写 `"A"`/`"B"`** —— 见 §4 R81）：

```json
{
  "shop_id": "<该店 shop_id>",
  "card": {
    "name": "真云验证卡",
    "mode": "A",
    "lines": [{ "material_id": "<该店 shop_material 里的一个 id>", "qty": 200 }],
    "aux_fen": 50,
    "loss_pct": 5,
    "price_fen": 2800,
    "target_margin_pct": 60
  },
  "client_request_id": "rc-A-001"
}
```
> `qty` 单位是**克或份**（`validate.js:26`）；`aux_fen` 是**分**；`loss_pct` 必须 ∈[0,100)。#2 只需把 `client_request_id` 改成 `rc-A-002` 并加 `"card_code": "<#1 返回值>"`。

**DB 侧核对**（控制台 → 数据库）：`shop_cost_card` 按 `card_code` 筛选 → **2 行**（`version` 1/2，`calc_mode:1`）；`shop_cost_card_line` → 明细行**带净料单位成本快照**（不是仅 `material_id`）。

**唯一索引"真在生效"的硬证据（控制台即可，无需并发）**：数据库 → `shop_cost_card` → 「添加记录」→ 把已存在行的 **`shop_id` / `card_code` / `version` 三元组原样复制**提交 ⇒ **必须被拒绝**（duplicate key）。⚠️ 若**写入成功** ⇒ 复合唯一索引没生效（此时"v1/v2 并存"也可能是巧合）⇒ 回查索引面板（**40/40 只证明"存在"，不证明"生效"**）。

---

## §4 验三 · 真云两月 `calcAmortize`（走路径 A）

**入参契约（出处 `calcAmortize/validate.js:14-42`）**：只接受 `{ shop_id, month }`；`month` 必须是 `YYYY-MM`。**wire 入参不再接受 `assets`**（R34 已删该入口，真相源 = 服务端台账）。

**前置（关键）**：该店 `shop_amortize` 里**要有 ≥1 笔活跃资产**，且 `start_month ≤ 第一月`。若为空 → 先在小程序「摊销」页添加一笔（或用验二的路径顺手添加），否则两月都返回 `total_amount_fen: 0`，**测不出东西**。

**操作**：对**同一家店**连续调用两次，只改 `month`：
```json
{ "shop_id": "<该店 shop_id>", "month": "2026-01" }
{ "shop_id": "<该店 shop_id>", "month": "2026-02" }
```

**期望**：两次都 `code:'SUCCESS'`，`data` 含 `month` / `total_amount_fen`（**整数分**）/ `details[]`（每笔资产的 `asset_id`、`amount_fen`、`in_period`）。
**为什么这条必须有**：`calcAmortize` 是**唯一**会在真云上走 `da.list('shop_amortize')` + `docToAsset` 全链路的函数 —— 本地单测用的是 mock，**真云的 `doc().get()`/`list()` 形态（A1/A2）只有它能证**（`calcAmortize/index.js:41-42`）。顺带验 `da.list` 的软删过滤（软删资产不应出现在 `details`）。
**一致性判读（本地可算）**：把两月结果与本地 `node cloudfunctions/calcAmortize/selftest.js` 的锚点口径对齐 —— 金额一律**整数分严格相等**（不许容差）；若真云结果与本地引擎不一致 ⇒ 优先怀疑**台账数据形态**（`total_months` 字符串、`total_value` 非 number 等，`docToAsset` 会点名抛 `INVALID_PARAM`）。
**留证**：两次返回 JSON 原文 + 该店 `shop_amortize` 的截图（资产条数/字段形态）。

---

## §4.5 新发现 🟡 R81：`mode` 入参**没有白名单**，两处静默兜底

- **证据（①②③ 逐字）**：① `cloudfunctions/saveCostCard/validate.js:31` = `const mode = card.mode === 'B' ? 'B' : 'A';`；② `cloudfunctions/saveCostCard/service.js:55` **同款再写一遍** = `const mode = (p && p.mode === 'B') ? 'B' : 'A';`；③ `index.js:167` = `calc_mode: card.mode === 'B' ? 2 : 1`（**库里 B = 2、A = 1**）。
- **后果**：调用方若传 `"b"`（小写）/**`2`（照库里的口径）**/`"C"`/`""`/缺失 ⇒ **静默当成 A**：不生成虚拟半成品、忽略 `batch_output`、落库 `calc_mode:1` ⇒ **成本语义悄悄变错且无任何报错**。
- **为什么这是缺陷而不是"容错"**：同文件对越界 `loss_pct`、缺失 `batch_output` 都是**响亮拒**（`validate.js:37-42`），本仓 R27/R30/R32/R35 一路的纪律是"涉金额的模糊入参一律响亮失败"；这里是**唯一的例外**。而且它是**同一语义两份实现**（validate 与 service 各兜一次）—— 正是 R62/R72/R73 反复清过的那类病。
- **修法（三处，含验收）**：① `validate.js:31` 改白名单：`if (card.mode !== 'A' && card.mode !== 'B') return err('card.mode 必须是 "A" 或 "B"');` ② `service.js:55` 改**断言式**（非法 mode 抛 `INVALID_PARAM`，不再兜底 A）；③ 补 4 条断言：`mode:'b'` / `mode:2` / `mode:'C'` / `mode:''` ⇒ **INVALID_PARAM**（当前会静默通过）。**变异回灌**：把白名单退回原来的三元兜底 ⇒ 这 4 条必须转红。
- **对执行单的影响**：§3 的入参**必须**写 `"mode": "A"`（大写字符串）；要验 B 卡须同时给 `"batch_output": <正整数>`（这条倒是响亮的 ✅）。

---

## §5 执行回执区（WorkBuddy 只追加）

> 本区归 WorkBuddy：**只追加、不改上文**。格式：`- [YYYY-MM-DD HH:MM] R<n>/验N 已落/未落/存疑 · 证据：<命令或操作> → <输出摘要> · commit <sha>`。

（暂无）

---

## §6 失败判读总表（症状 → 根因假设 → 动作）

| 症状 | 最可能根因 | 动作 |
|---|---|---|
| 任何业务函数返回 `{"error":"UNAUTHORIZED"}` | **在控制台跑的**（无 OPENID） | 改走 §1 路径 A；**不是缺陷** |
| `smokeTest` 报 `Cannot find module './common'` | 副本被压成 `common/` 子目录 | 跑 `node tools/sync_common.js` 后重新部署（`Runbook:108-110`） |
| `docGet.hasDataField = false` | A1/A2 修反 | **立刻回退**（`Runbook:122`） |
| 第二次保存没变 version | 漏传 `card_code`（被当新卡） | 检查入参 |
| 第二次保存报 duplicate key | 线上仍是旧的**单列唯一** `idx_card_code` | 索引面板 drop 旧索引（R38 记载） |
| 幂等重放却新增版本 | `client_request_id` 没带上 | 抓入参 + 看 `audit_log.idempotency_key` |
| 手工重复三元组**写入成功** | 复合唯一索引未生效 | 回查索引面板（存在 ≠ 生效） |
| `calcAmortize` 两月都是 0 | 该店台账为空 / 资产 `start_month` 晚于测试月 | 先补一笔资产 |
| `calcAmortize` 抛 `INVALID_PARAM` 并点名资产 | 台账脏字段（`total_months` 是字符串等） | **这是预期的响亮失败**，修数据 |

---

## §7 留证与清理规范（三验通用）

1. **原文优先**：每验留**完整返回 JSON**（不是"我看了，没问题"）；截图作辅证。
2. **归档落点**：`review/evidence/realcloud_20260917/`（`review/` 在 `packOptions.ignore` 内 ⇒ 进 git 不进小程序包）。
3. **清理**：`probe_tmp` 集合**手删**；一次性探针函数用完删；**不得**把临时免鉴权探针提交进仓库。
4. **收尾自证**（纪律 22）：结束时打印/截图 `git status` 干净 + `verify_all 56/56`（若本轮改了代码）。

---

## §8 队列

| 类别 | 内容 |
|---|---|
| **待执行侧** | ① 按 §2 跑**验一**（控制台，3 分钟，现在就可行）② 🔵 **R81** 修 `mode` 白名单（+4 断言 + 变异）③ 验二/验三走 §1 路径 A（或备选 B） |
| **待人工** | ① 真云三验（本文档即操作说明）② `ADMIN_SETUP_TOKEN` 的**值** ③ 上线三项（隐私政策 URL【硬阻塞】/ 审核测试账号 / 营业执照商户号）④ **R45** iOS 过滤 + `wechatide` 授权 |
| **下一步（条件式）** | **若 `git log -1` 在提交本份后为 X**，我 round35 核：R81 是否落地、验一/二的返回 JSON 是否归档（我按 §2/§3 的期望表逐字段判读）；**若你要我先做别的（如 R45 的两方案对比）**，说一声即可。 |
