# NOTE 2026-09-22 · round93b —— 幂等「存疑」（R62-9）结案：**不是缺口，是已论证的豁免**

> 缘起：round62（2026-09-20）把 `saveShopSetting` / `archiveMonth` 记为
> 「写操作零 `common/idempotency` 调用 ⇒ 重复提交会重复写库」的**存疑项**，提交裁决。
> round93 我在整理「紧急待处理」时发现**这条误判已被我写进 `MEMORY.md`**（每轮注入上下文）⇒ 先结案。
> 本轮回执只做**判定与更正**，不改业务代码。

## 1 · 结论（一句话）

**两处都不是缺陷**：串行重放由「覆盖式赋终值」保证终态相同；并发首次由**唯一索引**封堵；
而且 `tools/check_idempotency.js` 的 `EXEMPT_WRITE` **早已登记这两条豁免并写了机制理由**，`I6` 每轮盯着它们不腐。
R62-9 的判据（有没有调 idempotency 模块）是**形式判据推实质结论**，结论不成立。

## 2 · 三条证据（可逐条复验）

| # | 证据 | 落点 | 复验命令 / 位置 |
|---|---|---|---|
| ① | **已登记豁免**，理由为「覆盖式赋终值 ⇒ 重复提交终态相同」 | `tools/check_idempotency.js` 第 42-45 行 `EXEMPT_WRITE` | `node tools/check_idempotency.js` ⇒ I5/I6 两条 ✅ |
| ② | 写路径**全是赋终值**（无 `inc`、无 append） | `cloudfunctions/saveShopSetting/index.js:46,58`（`update { name/remark/updated_at }`、`update { enabled }`）<br>`cloudfunctions/archiveMonth/index.js:62`（`update { is_archive, archived_at }`） | 读源码；`grep -nE "\.inc\(|push\(" <两文件>` ⇒ 零命中 |
| ③ | 并发首次的 check-then-act **被唯一索引挡住** | `cloudfunctions/initDb/collections.js`：`idx_acc_shop_month` **unique (shop_id, month)**、`idx_switch_shop_key` **unique (shop_id, switch_key)**；云端已实测 | `review/evidence/cloud_index_20260916/shop_monthly_account_索引管理.png`、`shop_switch_索引管理.png`；`review/evidence/index_buildout_20260917/_README.md`（**唯一索引 10/10**，判据为**绿色像素簇**、不经 OCR） |

补充：`I5` 的判据本身就覆盖了这两处 —— 「凡是 ①有业务写 **或** ②声明了 `client_request_id` 的函数，
都必须『有幂等实现』**或**『在 `EXEMPT_WRITE` 登记并写明机制理由』」⇒ 它们是**合法的例外**，不是漏网。

## 3 · 裁决与更正

- **R62-9 存疑项：结案，判定为「不成立」**（理由见 §2）。原判据「零 idempotency 调用」是事实，
  但**推不出**「重复提交会重复写库」——这一步缺了「写路径是否赋终值」与「唯一索引是否存在且生效」两个前提。
- **更正 `MEMORY.md` §6**：原句「未修 `saveShopSetting`/`archiveMonth` 零幂等」⇒ 改为
  「`saveShopSetting`/`archiveMonth` 非缺口(EXEMPT+唯一索引)」（2993 → 2990 字符）。
- **`PITFALLS.md` §3 新增一条**：判幂等缺口的三条判据（查 `EXEMPT_WRITE` / 查是否赋终值 / 查唯一索引含云端生效），
  并记下「**已登记豁免**与**未修缺口**在记忆层极易写反」这一同族病（与「注释声称的护栏」正好互为镜像）。

## 4 · 遗留（真存在、但无害的形式缺口）

| 项 | 事实 | 后果 | 处置建议 |
|---|---|---|---|
| `client_request_id` 只回显不去重 | 两函数**接收并原样回显**该字段，但从不用于查重（对照 `saveAsset:38` 有 `findPriorResult`） | 并发 / 弱网重试时，第二个请求可能**抛未捕获异常**（`archiveMonth` 的 `insert` 无 `try/catch`）⇒ 用户看到「失败」；**数据仍然干净**（唯一索引已挡） | 二选一：① 补 `idempotency` 走重放形态（与 `saveAsset` 一致）；② 仅给 `insert` 包 `try/catch` 返回友好结果。**属写码，归快马批次**，本轮不代改 |
| 注释措辞 | `archiveMonth/index.js:8` 写「同一 shop_id + month + `client_request_id` 重复调用返回同结果（归档标记天然幂等）」 | 从句暗示了请求号去重，**实现没有**；括号里"天然幂等"才是实情 ⇒ 措辞误导，不是假护栏 | 建议改为「归档标记天然幂等：覆盖式赋终值 + `(shop_id, month)` 唯一索引；**不依赖** `client_request_id`」 |

## 5 · 顺带清算的其它悬案（本轮一起核，避免只处理看得见的那条）

| 悬案 | 出处 | 判定 |
|---|---|---|
| `check_terms_forbidden.js:113` 装饰性 `check(..., true)` | `NOTE_2026-09-20_round60-selfdrive-status.md:121`（R60-14，当时"由李老师/复审方定"） | **维持现状**。已核：第 106-112 行 `catch` 里已 `check(...,false)` 且 `process.exit(1)` ⇒ 能走到 113 行必然 require 成功，属 **fail-closed 之后的装饰性 ✅**，风险为零；改造收益为零且有回归风险。**非假绿** |
| 「并发方 1033/1034 个过程 PNG 归属待裁决」 | round52/58/59/60/61/62 六轮反复挂账 | **建议改判为「不提交、不删、加 `.gitignore`」**：这些是未跟踪的过程产物，不属于任何交付物；`round93` 已确认 **dsh 自 09-21 起暂停参与本仓**、InsCode `inflight_turn=0` 空闲 ⇒ 产出方不会回来认领。加 `.gitignore` **可逆**（不删文件），可让 `git status` 恢复可读。**待李老师点头**（涉及仓库策略） |
| dsh 相关的 `存疑`（R41-f / R42 / R59-11 等） | 多个早期 NOTE | **自然关闭**：dsh 09-21 起暂停本仓，不再每轮探 |

## 6 · 本轮改了哪些文件

- `.workbuddy/memory/MEMORY.md`（工作区记忆，不入仓）—— §6 更正
- `.workbuddy/memory/PITFALLS.md`（工作区记忆，不入仓）—— §3 新增判据纪律
- `review/NOTE_2026-09-22_round93b-idempotency-adjudication.md`（本文件，入仓）

**未改任何业务代码**（本轮无代码缺陷）。
