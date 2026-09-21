# round74 自驱动巡检 · 状态与结论（2026-09-21 12:0x–12:4x）

> 本件只记**实跑/实扫**得到的事实，不采信任何一方自述（含我方上一轮）。
> 证据目录：`review/evidence/selfdrive_20260921_r74/`（`ls` 已回读，5 个文件）。
> 仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`，分支 `dev`。

## 1. 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight_turn` = **0**；`message_count` = **1465**（与 round70/73 持平，**十八连无增长**）；`idle_sec` ≈ 248071（≈68.9h）；`model=deepseek-v4-flash` / `permission=auto`；末条审批 `approved_once` | **idle** ⇒ 不点击、不投喂 |
| dsh | 窗口 hwnd 855322，`rect[0] = -32000` | **minimized** ⇒ 不投递（与 round70/73 同状） |

两个代理都无火可救 ⇒ 本轮动作为「我方独立推进」，不驱动任何外部代理。

## 2. 并发写入方：检出**第三个**（非 InsCode）

12:23 `git diff` 冒出 7 个**我方从未触碰**的文件，改动带外部工具特征：

| 文件 | mtime | 改动量 |
|---|---|---|
| `miniprogram/i18n/terms.js` | 12:13:17 | +25 |
| `specs/dev-specs/i18n/terms.js` | 12:13:49 | +25（双副本同步，人工改不会这么齐） |
| `pages/month/input.js` | 12:15:28 | +24/-… |
| `pages/month/input.wxss` | 12:16:30 | +3 |
| `pages/month/input.wxml` | 12:16:50 | +13/-… |
| `tools/selftest_batch8b.js` | 12:17:43 | +58 |
| `utils/dineChannels.js` | 12:18:22 | +65/-… |

**归属三条独立证据（按 §0.3 ⑥ 定式）**：
1. **不是 InsCode** —— 探针 `inflight=0` 且 `message_count` 十八连持平（它写码必然有 inflight 或消息数增长）；
2. **不是我** —— 我方本轮只改 `tools/check_fn_selftest_counts.js` / `verify_all.js` / 重启键，与这 7 件**零交集**，且变异已全部字节级还原（`git diff` 中无我方文件）；
3. **外部工具特征** —— git 告警 `LF will be replaced by CRLF`（round53/56 同特征）。

**在途内容（实读 `git diff`）**：`dineChannels.js` 正在做「**别名归并**」（`ledger.channelAliases`：口语叫法并入正式渠道、金额相加、只在渲染层归并、单来源不重格式化），并在 `selftest_batch8b.js` 补断言（+58 行）。属 round71/72 堂食渠道的后续（G11a/G11b）。

**判停手四连（round55 定式）**：① 12:23 与 12:32 两次采样 mtime **完全一致** ② 进程采样（`_proc_scan_r74.py`，已排除自身 PID）**两采 0 命中** ③ 门禁跑完（12:35）回读 **仍无变化**（末次写入 12:18，静止 19 分钟）④ `git log` 无新 commit ⇒ **判停手**，我方恢复写入。

**处置**：其 7 件在途产出**未代提交、未代保全、未代复核**（在途半成品，抢写风险 > 保全收益；round70 只对接「判据类」悬空件，本例是业务代码）⇒ 挂待办，等其提交后由我方独立复核（含双向变异）。

### 2.1 并发方 12:40 已自提交 `7a8fc33`，我方**独立复核**（不采信其自述 6/6）

其 commit 面 9 文件（含我方**已暂存的重启键编辑**被一并带进：`git commit` 会把暂存区整体带走 ⇒ 两处 83→108 已入库，无丢失）。
内容=李老师真机反馈「美团/现金 后红色 × 与上面重复」⇒ `terms.ledger.channelAliases`（17 条口语→正式渠道，双副本同步）+ `normalizeDineRows` 渲染层归并 + `markFixedRows/decorateRows` 唯一分派口 ⇒ 预设行一律不显 ×。

**我方独立变异（`_mut_r74b.py`，判据=有 ❌ 行 或 RC≠0）**：

| # | 变异 | 预期 | 实测 |
|---|---|---|---|
| M1 | 装配口 `presetOf` 不查别名表 | RED | **RED** rc=1 |
| M2 | 页面不把别名表传进装配口 | RED | **RED** |
| M3 | WXML 去掉 `!r.fixed`（× 复现，缺陷本体） | RED | **RED** |
| M4 | 别名表删「美团」（双副本同改，K11 不红） | RED | **RED** |
| M5 | 双副本各加一条**正确**别名 | GREEN | **GREEN**（不错杀） |
| M6 | 仅改注释 | GREEN | **GREEN** |

6/6 如期、还原后 `selftest_batch8b` **121/121**；合流后 `node verify_all.js` **81/81 RC=0**（`gate_81_merge_after_7a8fc33.txt`）。
⇒ 判**通过**，无溢出缺陷；其 commit message 里「81/81」与我方实测一致（它跑的是含我方 81 套件的工作树，非巧合）。

**值得记的协作事实**：本仓存在**第二个 WorkBuddy 会话**与自驱动轮次共用工作树（同为 `WorkBuddy <wb@local>` 作者）。
它用**路径级 commit**，把我的暂存件带走、却把 `verify_all.js`/新守卫留在暂存区 ⇒ **并发双方不能假设「暂存区归自己」**，收口前必须重新 `git diff --cached --stat` + `git log -3`。

## 3. 队列 §6 五项复核（逐条，非采信自述）

| # | 项 | 本轮结论 | 证据 |
|---|---|---|---|
| ① | A6b 代码层兜底 | 维持闭环（无新 commit 触碰；门禁 81/81） | 门禁总览 |
| ② | R91 的 F1/F2 UI 缺陷 | 维持闭环 | `selftest_ui_fix` 随门禁跑绿（R107 实跑 31 ≡ 声明 31） |
| ③ | AD 适配 G1–G8 复验 | 维持通过 | `selftest_ad_gates` 随门禁跑绿（24 ≡ 24） |
| ④ | R86 超时值 | **存疑 · 本轮未实测** —— 人工面（须 `cli` 单通道，且按 round50 三方一致结论不再回读）；建 prod 时**必须重走定值与回读** | 沿用 round45/46/50 三方一致 |
| ⑤ | 14 页真数据走查 | 维持闭环（无新 commit） | — |

队列空 ⇒ 按 §0.10 定式做**防回潮扫描**。

## 4. 本轮正事：同族病**第 16 例** —— 云函数 selftest 通过数 ≡ 实跑（零守卫）

### 4.1 怎么找到的（可复用的查法）
沿用 round67/69 定式：对 `specs/dev-specs/core/` + `上线材料_*` 逐个 `grep` **被守卫引用次数**（`_refscan_r74.py`）⇒ 零引用 4 份：
`11_微信审核自查清单`（round73 已读：两张不同清单，非漂移）、`13_上线前查缺补漏`、两份 `开发规范v1.0_ModuleM1/M3`。
M3 规范 §M3.7「操作功能清单（15 项）」实点 **15 行 ≡ 15**（无漂移）；转而按 round73 的**下界**思路查**云函数 selftest 通过数** —— R105 只守 `verify_seed_data` 一个脚本、R107 只守 `tools/` 下 6 个套件，
而 SUITES 里占多数的**云函数 selftest（42 个）一个都没守**。

### 4.2 实跑实锤（`node cloudfunctions/<fn>/selftest.js`，逐个真跑）

| 函数 | 实跑通过 | round16 旧值 |
|---|---|---|
| `calcBom` | **40** | 29 |
| `detectCycle` | 12 | 12 |
| `getCostCard` | 8 | 8 |
| `getMaterial` | 7 | 7 |
| `saveCostCard` | **29** | 15 |
| `saveMaterial` | 8 | 8 |
| `syncCostCard` | 4 | 4 |
| **合计** | **108** | **83** |

漂移面在**重启键**（状态入口）：POC2 交付行与其 §6 叙述段**两处都写 83**。旧明细可对照
`review/REVIEW_2026-09-15_round16-verify.md:92`「29+12+8+7+15+8+4 = 83 项」。

**后果（与第 13/15 例同型）**：通过数是**下界** —— 文档写 83 时，断言从 108 掉回 83，文档仍说「合计 83 项符合预期」
⇒ **25 条断言静默丢失而门禁照旧判绿**（selftest 自身只报 pass/fail，掉多少条没人知道）。

### 4.3 已做
1. 修两处陈述（83 → **108**），并在交付行立**语义标记形式的全集声明**（唯一声明处）；
2. 新增 `tools/check_fn_selftest_counts.js`（**R108**，13 断言 / 段 8），SUITES **80 → 81**；
   判据四条腿：① 真跑七函数取实算（fail-closed）② 唯一声明处 ≡ 实跑求和 ③ 当前态 `` `fn` N/N `` 陈述 ≡ 实跑
   ④ 三道前提守卫（受守集合 ≥7 / 声明值 >0 / 当前态命中 ≥3 / 历史面确有旧值 ⇒ 排除面没打错）；
   弱面（「合计 N 项」叙述）只 ⚠️ 明示、不判红（坑⑭/⑯ 定式）；扫描面为**工作树递归**，不用 `git ls-files`（坑⑱）。
3. 三处套件数同步：`verify_all.js` 头注（R59 自校验）+ 重启键 §1.1 + 会漂行；新增「第 81 套件」序号声明**同行点名脚本**（R97 要求）。

### 4.4 双向变异（12 组，0 MISMATCH；脚本见证据目录）

| # | 变异 | 预期 | 实测 |
|---|---|---|---|
| M0 | 删 `saveCostCard` 一条断言（下界本体） | RED | **RED** ❌ C2 声明 108 ≠ 实跑 107、C3 写 29/29 ≠ 28 |
| M1 | 声明 108 → 83（回归旧值） | RED | RED |
| M2 | 声明换措辞「通过数合计 108 项」 | GREEN | GREEN（不错杀） |
| M3 | 删唯一声明标记 | RED | RED（fail-closed） |
| M4 | `core/13:136` 单函数陈述写错 40/40 → 25/40 | RED | RED |
| M5 | 实跑路径 `calcBom` → `calcBomX` | RED | RED |
| M6 | C3 扫描面 `specs` → `specsX`（扫空） | RED | RED |
| M7 | 历史面 `review` → `reviewX` | RED | RED（排除面前提非恒真） |
| M8 | 受守集合缩到 6 个 | RED | RED |
| M9 | 声明标记扩散到第二份 md | RED | RED（单源不扩散） |
| M10 | 新增一条**正确**陈述 `detectCycle` 12/12 | GREEN | GREEN（不错杀） |
| M11 | 无关「合计 5 项」落弱面 | GREEN | GREEN（只明示不判红） |

🆕 **M0 首轮 `MUTATION_NOT_APPLIED` = 成因②（CRLF 锚点）**：`saveCostCard/selftest.js` 是**纯 LF**（该文件不在 autocrlf 回写面），
而变异锚点拼了 `\r\n`。按 round67 的「三成因按序自查」：① 脚本逻辑 ② 行尾 ③ 锚点不存在 ⇒ 改用 `\n` 后命中并如期转红。
（同族提醒：本仓**行尾不统一**，`tools/` 下新文件已转 CRLF，而部分并发方产出是 LF —— 变异前先核 `b.count(b'\r\n') == b.count(b'\n')`。）

## 5. 门禁与收口

- `node verify_all.js` → **总览 81/81 套件通过，RC=0**（`gate_81_20260921.txt`）；
- `node specs/dev-specs/prototype/check_error_codes.js` → **RC=0**（`gate_al_20260921.txt`）；
- R108 首跑 **13 通过 / 0 失败，RC=0**（`guard_r108_first_run.txt`）。

## 6. 回执

- [2026-09-21 12:04] R74 已落 · 证据：`probe_agents.py` → InsCode inflight=0 / msg=1465 十八连持平 / idle 68.9h ⇒ idle；dsh rect[0]=-32000 ⇒ minimized · 不投喂不投递 · commit `be93a24`
- [2026-09-21 12:23] R74 已落 · 证据：`git diff --stat` → 7 件陌生改动 + git 告警 LF→CRLF + 探针 idle ⇒ 第三个写入方在途（堂食别名归并）· 按其文件只读旁观
- [2026-09-21 12:35] R74 已落 · 证据：`node verify_all.js` → 81/81 RC=0；A–L RC=0
- [2026-09-21 12:30] R74 已落 · 证据：双向变异 12 组 0 MISMATCH（M0 下界本体转红、M2/M10/M11 不错杀）
- [2026-09-21 12:55] R74 已落 · 并发方已自提交 `7a8fc33` ⇒ 我方独立复核：`_mut_r74b.py` 6 组（4 抓错/2 不错杀）全如期，还原后 batch8b 121/121；合流门禁 81/81 RC=0 · 判通过 · commit `7a8fc33`（对方）+ `be93a24`（我方守卫）
- [2026-09-21 12:40] R74 **未落（已由对方自提交，我方不代做）** · 在途期未代提交/未代复核（半成品抢写风险 > 保全收益）· 提交后已补独立复核，见 §2.1
- [2026-09-21 12:40] R74 **存疑** · ④ R86 超时值本轮未实测（人工面 + 单通道 `cli` 与并发方冲突风险）· 建 prod 时必须重走定值与回读

## 7. 下轮待办（溢出，不代修）

1. 复核并发方（堂食别名归并 G11a/G11b）提交后的产出 —— 含双向变异；
2. ⑨ `init_db` 系统字典渠道仍 5 项 vs 前端 7 项（round69 起挂起，未修）；
3. 坑⑱：4 份前轮守卫仍只扫 index（`check_collection_perms` / `check_quota_limits` / `check_suite_count_claims` / `check_suite_coverage`）；
4. R106 `CAT` 缺「小时/秒」映射（判据强度缺口，round70 记）；
5. 李老师四选一（dsh 方案 D）未定；建 prod 时重走 R86 + 替换 `ENV_MAP.prod` 占位符；隐私政策按 6 处填。
