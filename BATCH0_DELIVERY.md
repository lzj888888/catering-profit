# 批次 0 · 工程地基 · 交付文档（待你按重启键 :48 五条逐条验）

> 生成时间：2026-09-12 ｜ 依据：`specs/dev-specs/delivery/批次0_提示词_可直接复制.txt` + `core/09`（错误码）+ `core/10`（云函数契约）+ `prototype/init_db.js` + `i18n/terms.js`
> 本批**只做地基**：项目初始化 + 鉴权中间件 + 统一错误码 + 基础表结构 + 时间工具 + 软删过滤层。**未写任何 M1/M2/M3 业务算法**（契合批次 0 §4 禁止项）。
> 自测：本机 `node cloudfunctions/common/__tests__/batch0_selfcheck.js` → **20 通过 / 0 失败 + 1 待办（EXIT=0）**（原 21 + A2 回归 3 条 `da.get`；点④ 4 条假绿断言已改为不计入失败的 🔶 待办）。⚠️ 自测绿只证明 mock 契约下逻辑对；点④ 占位符未替换时**只标 🔶 待办、不打 ✅、不计入失败**。点②/③ 的 A1/A2 契约错已修，并经**内存回退变异验证**（回退 A1→1 失败；回退 A2→2 失败；基线→0 失败）—— 修复 + 有鉴别力护栏才算闭环。

---

## 一、复审节点① 五条 ↦ file:line

| # | 验收点（重启键 :48） | 落地文件:行 | 关键代码 / 行为 |
|---|---|---|---|
| **点1** | 鉴权丢弃前端 user_id/shop_id/openid，身份只来自 `cloud.getWXContext().OPENID` | `cloudfunctions/common/auth.js:26` `resolveAuth(ctx, db, audit)`（签名**无 event 入口**）<br>`auth.js:27` `const OPENID = ctx && ctx.OPENID;`<br>`auth.js:31` 只按 OPENID 查 user | 函数只接收云端上下文 ctx，任何前端伪造 `user_id`/`shop_id`/`openid` 无从进入；身份唯一来源 = `ctx.OPENID`。自测「点1·身份只来自OPENID(忽略伪造记录)」`user.id=u_real`（伪造 u_forged 被忽略）✅ |
| **点2** | `shop.user_id !== ctx.user.id → FORBIDDEN` | `cloudfunctions/common/auth.js:75-87`<br>`if (shop.user_id !== userId) return fail(ERROR_CODES.FORBIDDEN);` | 越权 → `FORBIDDEN`；本人 → `SUCCESS`。✅ **A1 已修（重验通过 + 变异护栏）**：`assertShopOwner` 改 `const shop = r && r.data` + try/catch 兼容 SDK reject，`auth.js:75-87`。复审曾发现原契约错（当文档本体 → 线上恒 FORBIDDEN 死锁）。 |
| **点3** | DataAdapter `is_deleted=true` 不出现于任何列表 | `cloudfunctions/common/dataAdapter.js:16-19`<br>`const cond = Object.assign({}, extra \|\| {}, where \|\| {}, { is_deleted: false });`<br>`dataAdapter.js:27` count 同注入 | 列表/计数统一注入 `is_deleted:false`；软删数据不出现。✅ **A2 已修（重验通过）**：`get()` 改 `r && r.data` + try/catch（`dataAdapter.js:21-24`），单条软删生效。✅ **A3 已修**：`is_deleted:false` 移到 `Object.assign` **最后**，extra 无法覆盖（列表铁律加固）；另增 `listIncludingDeleted` 供审计/管理端看软删。 |
| **点4** | `config/env.js` 填真实 `catering-dev-xxxxxx`（非短名） 🔶 **待建环境后替换** | `miniprogram/config/env.js:14-15` `ENV_MAP.dev/prod = 'catering-dev-xxxxxxxx'/'catering-prod-xxxxxxxx'`（**占位符，未填真实 ID**）<br>`app.js:3,13` `wx.cloud.init({ env: env.getEnv() })` | 占位符即「真实ID形态」，绝非短名。🔶 **自测点④ 现为 🔶 待办（不打 ✅、不计入失败）**：占位符未替换时推入待办；点④ 须**待你建 dev/prod 环境后替换 env.js:14-15 真实 ID** 才算完成（需人对着控制台比，不能靠自测）。 |
| **点5** | initDb 部署后 `blocked===undefined && created.length===25` | `cloudfunctions/initDb/collections.js:7` `COLLECTIONS`（25 张）<br>`collections.js:141` `return { blocked: undefined };`（dev 放行）<br>`cloudfunctions/initDb/index.js` `result.created.push(c)` + 末尾 `return result;`（**不设 blocked 字段**） | COLLECTIONS.length===25 ✅；dev 环境 gate 返回 `blocked===undefined` ✅；prod 恒 `blocked=true` ✅；白名单误配 prod 仍拒 ✅。运行时：fresh dev 环境建 25 集合 → `created.length===25` 且 `blocked===undefined` |

---

## 二、自测结果表（本机 `node …/batch0_selfcheck.js`，EXIT=0）

```
✅ 点1·身份只来自OPENID(忽略伪造记录)      → user.id=u_real
✅ 点1·函数不接收event(签名为 ctx,db,audit) → resolveAuth.length=3（无 event 入口）
✅ 点1b·首次自动建档返回user               → user.id=u_***
✅ 点1b·建了默认shop                       → shop=1
✅ 点1b·建了entitlement(expire_at=0)      → expire_at=0
✅ 点1b·建档写audit_log(AUTH_AUTO_PROVISION) → audit=1
✅ 点2·越权→FORBIDDEN                     → code=FORBIDDEN
✅ 点2·本人→SUCCESS                       → code=SUCCESS
✅ 点2·幂等键含shop_id(换店同ID不误拦)    → shopA.ok=true, shopB.ok=true
✅ 点3·软删记录不出现在列表               → len=1
✅ 点3·查询条件注入is_deleted=false       → cond={"shop_id":"x","is_deleted":false}
✅ 点3b·get 活跃文档返回文档本体(非{data}) → alive={"_id":"g1","user_id":"owner","is_deleted":false}
✅ 点3b·get 软删文档→null                → dead=null
✅ 点3b·get 不存在文档(reject)→null      → missing=null
🔶 点4·🔶 待办：env.js:14-15 仍是占位符 —— 部署前置，非单测可判真（替换真实ID后重跑转 ✅）
✅ 点5·集合数=25                          → len=25
✅ 点5·dev 环境 gate.blocked===undefined   → blocked=undefined
✅ 点5·prod 环境 gate.blocked===true       → blocked=true
✅ 点5·白名单精确匹配dev放行              → blocked=undefined
✅ 点5·白名单误配prod仍拒                 → blocked=true
✅ 限流·第61次写触发RATE_LIMITED         → limited=true
合计：20 通过 / 0 失败（待办 1 项不计入失败）
```

---

## 三、生成的文件清单（本地路径，可直接打开复核）

**地基公共层 `cloudfunctions/common/`**
- `errors.js` — 统一错误码 ERROR_CODES + ok/fail（对齐 core/09）
- `utilTime.js` — 服务端 UTC 时间（nowUtc / toMonth / monthAnchor，禁前端时间）
- `money.js` — 元↔分 / fenRound / 尾差倒挤
- `dataAdapter.js` — **软删过滤层（点3）**、统一字段注入、只 INSERT
- `auth.js` — **鉴权中间件（点1/点2）**：resolveAuth / assertShopOwner
- `idempotency.js` — 幂等键 `shop_id+client_request_id`
- `rateLimit.js` — openid 维度 60 次/分钟
- `audit.js` — audit_log 只 INSERT
- `index.js` — 公共层统一出口（后续 1~7 批 `require('../common')`）

**建库云函数 `cloudfunctions/initDb/`**
- `collections.js` — 25 张集合 + 索引 + 种子（纯数据/纯函数，供自测引用，零漂移）
- `index.js` — 部署用 main（依赖 wx-server-sdk，dev 门禁）
- `package.json` — `wx-server-sdk`

**前端 `miniprogram/`**
- `config/env.js` — **环境配置（点4）**
- `i18n/terms.js` — 从 `specs/dev-specs/i18n/terms.js` 复制（文案走 i18n，禁硬编码）
- `app.js`（已改）— `wx.cloud.init` 只从 `config/env.js` 取值

**自测 & 交付**
- `cloudfunctions/common/__tests__/batch0_selfcheck.js` — 五条自测
- `BATCH0_DELIVERY.md` — 本文档

---

## 四、部署注意（你执行，本机无 inscode/云连接器）

1. **common 层打包**：WeChat 云函数按函数目录独立部署，`cloudfunctions/common/` 不是可部署函数。inscode 部署每个云函数时，需把 `common/` 随函数一起上传（或在每个函数目录内放一份 `common` 副本）。当前 `initDb/index.js` 通过 `require('./collections')` 引用同目录文件，可直接部署；后续 1~7 批云函数 `require('../common/...')` 时请确认 common 已随包上传。
2. **config/env.js 填真实 ID（点4 上线动作）**：把 `dev`/`prod` 占位替换为云开发控制台真实环境 ID（形如 `catering-dev-xxxxxx`），**切勿留短名**。
3. **initDb 仅 dev**：`initDb` 部署到 **dev** 手动跑一次建 25 集合；**prod 的 25 张集合在控制台手工建，绝不部署 initDb 到 prod**（代码门禁已强制 `!/prod/` 恒拒）。部署后实测 `blocked===undefined && created.length===25`。
4. **commit 策略**：地基先合 `dev`，各批次投喂完成后再统一合 `main`（与分支策略一致）。

---

## 五、与门禁关系

本批源码不触碰 `specs/dev-specs/` 内规范，故 **A–K 门禁无需重跑**（门禁守规范层，不守本批生成的应用代码）。本批质量由本交付文档 §一 五条 file:line + §二 自测（20 通过 + 1 待办，EXIT=0）承保；点②/③ 另经**内存回退变异验证**确认回归护栏有效（回退 A1→1 失败、回退 A2→2 失败）。
