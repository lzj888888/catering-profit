# NOTE · round62 自驱动巡检（2026-09-20 15:0x–15:3x）

> 仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`。本轮 = 「队列已清 ⇒ 做防回潮扫描」，
> 抓出**同族病第 6 例**并做成守卫。所有结论均为实跑/实扫，不采信任何自述（含我方上一轮）。

---

## 一、状态探针（`probe_agents.py`，唯一入口）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight_turn` = **0** 行；`sessions.message_count` = **1465**（round58/59/60/61 后**九连持平**）；`idle_sec` = 172287（≈**47.9h**）；末条审批 `state=approved_once` | **idle**，无待批 ⇒ 不投喂、不点 |
| dsh（:3080） | 窗口 hwnd 855322 在（rect 852,105→1764,924）；标题会话 = **「餐饮闭店决策指标模型咨询」** | **found 但上下文不匹配**（本仓是餐饮小程序）⇒ 按 §3.2 不投递（投了是上下文污染） |

- HEAD `c3c0005` ≡ round61 末提交 ⇒ **无未经我方复核的新 commit**。
- 并发写入方：进程采样（自写 .py 排除自身 PID，**避免 round58 凭空造并发方的坑**）两次可见者只有
  我自己起的 `verify_all.js` / `check_requires.js`；常驻噪音仅 `sheetagent` / `weixinpay` / `dsh bin.js web`
  ⇒ **无并发写入方**，本轮可正常写。
- 工作树 1035 个未跟踪项 = 并发方历史过程 PNG（round58 实测 1033，**本轮仍未动**）⇒ 不代提交、不代删。

---

## 二、队列五项复验（§6，实跑非采信）

| 项 | 权威判据 | 结果 |
|---|---|---|
| ① A6b 代码层兜底 | 无新 commit ⇒ 不重跑（round39 已闭合） | 闭环 |
| ② R91 F1/F2 UI 缺陷 | `node tools/selftest_ui_fix.js` → **31/31 RC=0** | 闭环 |
| ③ AD 适配 G1–G8 | `node tools/selftest_ad_gates.js` → **24/24 RC=0** | 闭环 |
| ④ R86 超时值 | 按 round50 结论（round45/46/50 三方一致 42/42）**不再回读**；人工面只提醒 | 闭环（prod 需重走） |
| ⑤ 14 页真数据走查 | 无新 commit ⇒ 不重跑 | 闭环 |

---

## 三、本轮核心：同族病**第 6 例** —— 云函数清单与代码目录双向漂移

### 3.1 发现（实扫，命令与输出见证据 `fn_gap_scan_before.txt`）

`specs/dev-specs/core/10_云函数清单与接口契约.md` 头部自称
「**单一文档列出全部云函数** → 入参/出参/归属批次/鉴权，防止前端与后端各自生成导致命名/字段错位」，
是**写码 AI 的输入基线**。实测（`cloudfunctions/` 44 目录 − `_adminCore` − `common` = **42** 函数）：

- **8 个已部署函数在该文档零出现**：`archiveMonth` / `checkQuota` / `deleteAccount` /
  `getCardVersions` / `getShopContext` / `getShopList` / `saveShopSetting` / `smokeTest`
  （其中 `archiveMonth`、`getShopList`、`checkQuota` 在 `specs/` 全树亦**零命中**）。
- **4 个表内名字从未落地为目录**：`getPlan` / `savePlan` / `shopList` / `shopSwitch`
  —— 全仓**零调用点**（已 grep `pages/ utils/ miniprogram/` 及 `name:'xxx'` 调用写法），属计划未落地。
- `utilTime` 是 `cloudfunctions/common/utilTime.js` 公共模块，**不是**云函数（§0 登记，合法）。

**后果**：写码 AI 拿这份基线会**漏掉 8 个已存在函数**（重复造轮子/命名撞车），
并按 4 个不存在的名字生成调用代码。两级门禁全绿无人报警 —— A–L 的 K 组只守投喂链派生件，
`check_schema_sync` 只守**集合/索引**计数，**没有一组看「函数清单 ↔ 代码目录」这一层**。

### 3.2 处置

1. `core/10` 新增 **§9 后期增补函数**：逐个读 `index.js` + `validate.js` 核实后登记 8 个函数的
   入参 / 出参 / 鉴权（含 `saveShopSetting` 三态语义、`archiveMonth` 归档后只读等留痕）。
2. 给 4 个未落地名字就地打「**未实现**」标记（写明「无目录、零调用点」及替代者）。
3. `core/10` 头部立「**全集口径**」单源声明：**本表共登记 42 个已部署云函数**。
4. 新增 `tools/check_fn_inventory.js`（**R98**，12 断言）：
   F1 扫描面 fail-closed（函数数 ≥40 / 两个非函数目录确在 / 文档 ≥100 行 / common 模块清单非空）
   · F2 代码→文档（**每个实际函数必须有契约表格登记行**）
   · F3 文档→代码（= 已落地 / common 模块 / 带「未实现」标记；**反向防腐**：已落地却仍标未实现也红）
   · F4 全集口径声明 ≡ 实测 · F5 `selftest` 覆盖面声明 ≡ 实测 40。
5. `verify_all.js` SUITES **70 → 71** + 头注；重启键 `★知识存储点` 两处套件数同步 **71**（由
   round61 的 `check_suite_count_claims.js` 机械校验，不再靠人工跟）。

### 3.3 溢出发现（**未修**，如实记待办）

登记 §9 时逐个核实代码，发现 `saveShopSetting` 与 `archiveMonth` 都是**写操作**且入参收
`client_request_id`，但**全目录零 `common/idempotency` 调用**（对照 `saveAsset/index.js:38`
`findPriorResult` + `:78` `shopKey`）⇒ **重复提交 / 网络重试会重复写库并重复写 `audit_log`**。
`saveShopSetting` 是**核算口径开关的落点**（round55 才迁到月度录入页），重复写风险更高；
`archiveMonth` 因「设置 `is_archive`」天然幂等，风险低。

> §9 已**按实然标注**（不标 +幂等）以免门禁假红 —— 这是标注口径修正，**不是**修缺陷；
> 缺口本身**未修**，是否补接单源幂等预检由李老师/快马裁决（与 R72/R73 幂等覆盖同族）。

### 3.4 变异回灌（7 组，含 2 组「不错杀」）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| M1 | 删掉 `getShopList` 登记行（漏） | 红 | ✅ 红（点名「无登记行：getShopList」） |
| M2 | **正确实现**换措辞「本表共登记→全仓目前共」 | **仍绿**（不错杀） | ✅ 绿 |
| M3 | 新增未知函数目录 `__mut_fn62` | 红 | ✅ 红（F2 + F4 双点名） |
| M4 | 表格加一行 common 模块 `rateLimit`（合法） | **仍绿** | ✅ 绿 |
| M5 | 删掉「全集口径」声明行 | 红（fail-closed） | ✅ 红（命中 0 处） |
| M6 | 从 SUITES 摘掉 `fn-inventory` | 红（覆盖守卫活性） | ✅ 红（`check_suite_coverage` S5 点名） |
| M7 | 给已落地函数打「未实现」标记 | 红（F3 反向防腐） | ✅ 红 |

还原后基线 rc=0；`cloudfunctions/__mut_fn62` 已删并 `ls` 回读无残留。

> **首跑教训（值得单记）**：F2 初版写的是 `docRaw.includes(name)`（扫"任何提及"）⇒
> **M1 假绿** —— 因为 §9 备注里那句「8 个已部署函数零出现（… getShopList …）」也含该名字。
> 已改判「必须有**表格登记行**」（与 round56「判据扫错了层」同族：扫"任何提及" ≠ 扫"契约登记"）。
> 同理 F4 首版裸扫「N 个函数」**误杀 5 处**合法子集/历史口径（「只部署了 2 个」= 历史快照、
> 「44 个」= 目录数、「补 6 个函数自测」= 批次子集）⇒ 改为锚「全集口径」语义标记：
> 换措辞仍绿（M2）、删声明即红（M5）。

---

## 四、判据（终值）

| 判据 | 命令 | 结果 |
|---|---|---|
| 全量门禁 | `node verify_all.js` | **71/71 RC=0** |
| 门禁 A–L | `node specs/dev-specs/prototype/check_error_codes.js` | **RC=0** |
| AD 适配 | `node tools/selftest_ad_gates.js` | **24/24 RC=0** |
| UI 修复 | `node tools/selftest_ui_fix.js` | **31/31 RC=0** |
| 新守卫 | `node tools/check_fn_inventory.js` | **12/12 RC=0** |

证据：`review/evidence/fn_inventory_20260920/`（8 份，含探针 JSON、缺口扫描、守卫输出、变异矩阵、
四套判据终值），已 `ls` 回读。

---

## 五、回执（Round 62）

- [2026-09-20 14:58] R62-1 **已落** · 证据：`probe_agents.py` → InsCode `inflight=0`/`msg=1465` 九连持平/idle 47.9h；dsh found 但会话「餐饮闭店决策指标模型咨询」上下文不匹配 · commit `2f5a852`
- [2026-09-20 15:00] R62-2 **已落** · 证据：`_proc_scan_r62.py`（排除自身 PID）→ 仅我自身门禁进程，噪音 3 类常驻 ⇒ 无并发写入方 · commit `2f5a852`
- [2026-09-20 14:59] R62-3 **已落** · 证据：`git log --oneline -8` → HEAD `c3c0005` ≡ round61 末提交 ⇒ 无未复核新 commit · commit `2f5a852`
- [2026-09-20 15:01] R62-4 **已落** · 证据：`node verify_all.js`（改动前）→ 70/70 RC=0；AD 24/24；UI 31/31；A–L RC=0 ⇒ 队列②③闭环 · commit `2f5a852`
- [2026-09-20 15:06] R62-5 **已落** · 证据：`_r62_fn_scan.py` + `_r62_fn_scan2.py` → 42 函数 / 契约表 39 名 / **8 个零出现** / 4 个未落地 / 零调用点 · commit `2f5a852`
- [2026-09-20 15:12] R62-6 **已落** · 证据：`core/10` 新增 §9（8 函数契约逐个读 `index.js`+`validate.js`）+ 4 处「未实现」标记 + 头部「全集口径 42」单源 · commit `2f5a852`
- [2026-09-20 15:16] R62-7 **已落** · 证据：`node tools/check_fn_inventory.js` → 12/12 RC=0（F1–F5）；SUITES 70→71、重启键两处套件数同步 71 · commit `2f5a852`
- [2026-09-20 15:22] R62-8 **已落** · 证据：`_r62_mut.py` → 7 组变异全如期（M2/M4 两组「不错杀」仍绿），还原后基线 rc=0，无 `__mut_fn62` 残留 · commit `2f5a852`
- [2026-09-20 15:21] R62-9 **存疑** · 理由：`saveShopSetting` / `archiveMonth` 写操作零 `common/idempotency` 调用（对照 `saveAsset:38`）⇒ 重复提交会重复写库；**属代码缺口、我方不代改**（写码归快马/决策归李老师），已按实然标注并在 §9 点名 · commit `2f5a852`
- [2026-09-20 15:28] R62-10 **已落** · 证据：证据目录 `review/evidence/fn_inventory_20260920/` 8 份已 `ls` 回读；终值 71/71 + A–L RC=0 + AD 24/24 + UI 31/31 · commit `2f5a852`
- [2026-09-20 15:29] R62-11 **未落** · 理由：并发方 1035 个过程 PNG 归属待李老师裁决（round58 实测 1033、本轮仍未动），不代提交不代删 · commit —

---

## 六、待下轮 / 待李老师

1. 🆕 **幂等缺口裁决**：`saveShopSetting`（核算口径落点，风险高）/ `archiveMonth`（风险低）
   是否补接 `common/idempotency.js` 幂等预检？
2. **dsh 第 12 轮不可用**且上下文不匹配 ⇒ round39 等 5 份 NOTE 复审仍悬；李老师四选一未定
   （放开写+node / 改只读判据 / 退场 / 允许重启 dsh web）。
3. 并发方 1000+ 过程 PNG 待裁决（不代提交不代删）。
4. 建 prod 时提醒：**重走 R86 定值与回读** + 替换 `ENV_MAP.prod` 占位符。
5. 隐私政策按 **6 处**占位符填（旧清单会漏 2 项，直接卡提审）。
6. `core/10` §9 一旦有人新增云函数而没登记 ⇒ 门禁当场转红（已机械化，不再靠巡检撞见）。
