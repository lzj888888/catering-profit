# NOTE · 2026-09-19 round43 自驱动巡检（只读旁观轮）

> 执行方：WorkBuddy（巴迪）｜性质：**无人值守自动化第 43 轮**｜模式：**只读旁观**（检出并发写入方，见 §2）
> 仓库：`C:\Users\lzj\WorkBuddy\Claw\catering-profit`（分支 `dev`）｜证据：`review/evidence/selfdrive_20260919_r43/`

## 0. 一句话结论

**并发方（李老师授权的 R86 GUI 批量改超时）仍在跑 ⇒ 本轮全程只读旁观、不点 GUI / 不跑 `cli` / 不加 TOPMOST。**
只读复核拿到的实质进展：**R86 已从 round42 的 5/42 推进到 13/42（13:58 读）→ 15/42（14:14 读，仍在涨）**，
但 **27 个未达标里 20 个卡在 `console-not-foreground`（控制台窗口不在前台）** —— 这是 GUI 批量最大的脆弱点，也是本轮最有价值的发现。
dsh 仍卡在**沙箱受阻态**（与 round42 同一屏文案）⇒ 本轮**不投递**（投了它也跑不动）。

## 1. 探针判据（DB / 截图原文，非印象）

| 代理 | 判据来源 | 结果 |
|---|---|---|
| InsCode | `C:\Users\lzj\.config\inscode\inscode.db` | `inflight_turn` **0 行**；`approval_audit` 末行 `state=approved_once`（非 pending）；`sessions.message_count=1465`（与 round41/42 **持平** ⇒ 期间零新往来）；`idle_sec≈82.8k`（≈23h）；`model=deepseek-v4-flash`；`permission=auto` ⇒ **idle** |
| dsh | hwnd 855322，rect `[852,105,1764,924]`（**可见、未最小化**） | OCR 首屏仍见 **`沙箱拒绝此类写入与node子进程。`** + 它想做的变异动作（Copy-Item `saveCostCard/validate.js` + 改 `if(false){` + 比 hash）；`find 发消息` **MISS** ⇒ **不在输入框** ⇒ **沙箱受阻态（round42 同态，无进展）** |

⚠️ 补一条取证坑：本轮我另存的一张 `dsh_1340.png` 是**近乎全黑**（912×819，主色 `rgb(39,39,39)` 占 71%），`find` 全 MISS。
根因 = `screenshot_window`（BitBlt）在窗口被遮挡/未参与合成时抓不到内容 ⇒ **BitBlt 截图全黑 ≠ 窗口没内容**，判状态要以 `probe_agents.py` 拿到的那一版为准（它同样用 `screenshot_window`，但落在其 STATE 目录且时序不同）。**判据不可靠时改走 `read` 全文本**，别拿一张黑图下结论。

## 2. 并发写入方：三连全中（§0.7）

1. **窗口**：枚举到 `云开发控制台 v2.0.3 (2.0.34@707916636)`（hwnd 31199328）在跑；
2. **证据目录在涨**：`review/evidence/r86_timeout_20260919/` 文件数 13:56 `575` → 13:57 `578`（25s 内 +3），最新 `reset_calcSandbox_1_2.png` @13:58；
3. **他人 git 改动**：`M review/REVIEW_2026-09-15_round38-verify.md`、`M 索引补齐核对单.md`、`?? review/evidence/r86_timeout_20260919/`。

⇒ 处置：**不点 GUI、不跑 `cli`（单通道会撞车）、不 `git add -A`、不加 TOPMOST**（会把并发方的固定坐标点击打到错窗口），只做**路径级提交**我方文件。

## 3. 本轮实质发现（只读，不替代并发方结论）

### 3.1 R86 进度：13/42（13:58）→ 15/42（14:14）达标（读并发方 `results.json`，**未跑 cli**）

**达标 13**（13:58 读数，`ok=true`，`why` 均为 CLI 回读值，属**行为判据**）：
`adminExport=60` · `adminLogin/adminLogout/adminOrderList/adminQueryUser/adminRefreshToken/adminRefundMark/adminRevokeToken/archiveMonth/saveAsset/saveCostCard/saveMaterial/syncCostCard = 20`。

**未达标 29**，失败原因分布（13:58）：

| why | 数量 | 含义 |
|---|---|---|
| `console-not-foreground` | **25** | 🔴 控制台窗口**不在前台** ⇒ 固定坐标点击全部落空 |
| `version-page-not-loaded` | 3 | `adminGrantEntitlement` / `adminManualOrder` / `calcAmortize` / `calcBom` / `calcMonthlyProfit` 中的 3 个，版本页没加载出来 |
| `search-miss` | 1 | `adminInit`，搜索框过滤没命中行 |

**14:14 复读（本轮收口前再采一次，证明它不是静止的）**：`ok` **15/42**，未达标 27 =
`console-not-foreground` **20** + `version-page-not-loaded` **6** + `search-fail` 1。
⇒ 分布结构不变，**`console-not-foreground` 始终占 74%~86%**，是这批的主卡点。
（两次原始读数已落 `review/evidence/selfdrive_20260919_r43/r86_progress_1340.json`。）

**判读**：`console-not-foreground` 占 86% ⇒ 这批失败**不是超时值本身改不动**，而是**焦点被别的窗口/会话抢走**（`saveAsset`/`saveCostCard` 的 CLI 回读已证明 GUI 手改这条路走得通）。
证据链还显示 12:44 → 13:29 有 **45 分钟空档**（期间正是 round42 我在探 dsh），之后 13:29–13:43 又连续达标 8 个 —— 与「焦点回归即恢复推进」完全吻合。
**建议（交并发方/李老师）**：脚本每函数六步之前先 `SetForegroundWindow(console_hwnd)` + 校验 `GetForegroundWindow()==console_hwnd`，失败即重试；批量期间**其他会话一律不得抢焦点**。

⚠️ `current_timeouts.json` 仍是 10:46 的**陈旧快照**（39 个写 3、3 个写 20）⇒ **不可作终值判据**，只看 `results.json`（mtime 实时更新）。

### 3.2 交接纪律提醒（不擅自改，只上报）

并发方把两条 R86 回执（09:50）**直接写进了 `review/REVIEW_2026-09-15_round38-verify.md` 正文**。
按本仓交接纪律：`REVIEW_*` 正文归**复审方（dsh）**，我方（含并发执行方）只追加 **§3 回执区**，改正文须逐行登记。
⇒ **本轮不动它**（正在被对方使用），建议跑完后由我方迁回 `NOTE_*` 或 §3 区，避免复审方的文件被写入方污染。

### 3.3 `索引补齐核对单.md`（归属存疑）

diff 只有一行变化：生成时间 `2026-09-18 22:45` → `2026-09-19 09:17`（该文件由 `tools/gen_index_checklist.js` 从单源生成，正文标注「请勿手工编辑」）。
我方无 09:17 的操作记录 ⇒ **归属存疑**，本轮**不提交、不删除**，待李老师确认后由归属方提交。

## 4. 门禁（本轮实测，node 不与并发方抢 `cli` 通道）

- `node verify_all.js` → **64/64 套件通过，RC=0**（含 `data-contract` 7/7、`check_evidence_meta` 2/2、`S1` 扫描面非空）。
- `node specs/dev-specs/prototype/check_error_codes.js` → **A–L 全部断言通过，RC=0**（A/B 三向一致、C 云函数登记、D 配额口径、E 表格、F 字符、G 价格天数、H 环境门禁、I 派生精度、J H5 护栏、K 投喂链派生、L common 同步）。

## 5. 本轮**没做**的事（未落 + 理由）

| 项 | 状态 | 理由 |
|---|---|---|
| 投喂 InsCode 下一批 | **未落** | ① 8 批（0~7）已收官、**无「批次 8」**；② 中优先级项归属运营与工程、明写「上线后 1 月内补」⇒ 无人值守自动化擅自开工属越权 |
| 给 dsh 投递复审请求 | **未落** | dsh 处于**沙箱受阻态**（`find 发消息` MISS，不在输入框）⇒ 投不进去；且 round42 已上报三选一，**等李老师定** |
| 42/42 CLI 终值回读 | **未落** | 需跑 `cli cloud functions info`，`cli` 是**单通道**，并发方正在用 ⇒ 撞车风险，留待并发方跑完 |
| 提交他人两个 `M` 文件 | **未落** | 归属非我方（`REVIEW_*` 归复审方、`索引补齐核对单.md` 归属存疑）⇒ 只做路径级提交 |

## 6. 下轮待办（按优先级）

1. 并发方 R86 跑完 ⇒ 做 **42/42 CLI 终值回读**（`cli cloud functions info --names <空格分隔>`，`grep -c "│ 3 "` 须为 **0**）。
2. 李老师对 dsh **三选一**（放开写+node / 改只读判据 / 退场）定了以后，再投 round39 复审。
3. 盯 `console-not-foreground` 是否随「每函数前置 `SetForegroundWindow`」消失 —— 这是本轮给出的可证伪改进点。

---

## 7. 回执（SOUL.md 格式）

- [2026-09-19 14:10] R43 已落 · 证据：`probe_agents.py` → InsCode `inflight=0`/`idle=82.8k`/`msg 1465`（持平）；dsh hwnd 855322 OCR 见「沙箱拒绝此类写入与node子进程」、`find 发消息` MISS · 并发三连：`云开发控制台`窗口在 + r86 证据目录 25s 内 575→578 + 他人 git 改动 3 项
- [2026-09-19 14:10] R43 已落 · 证据：`node verify_all.js` → **64/64 RC=0**；`node specs/dev-specs/prototype/check_error_codes.js` → **A–L 全绿 RC=0**
- [2026-09-19 14:14] R43 已落 · 证据：解析 `review/evidence/r86_timeout_20260919/results.json` → **ok 13/42（13:58）→ 15/42（14:14）**，未达标 27 = `console-not-foreground` 20 + `version-page-not-loaded` 6 + `search-fail` 1；原始读数落 `r86_progress_1340.json`
- [2026-09-19 14:10] R43 未落 · 42/42 CLI 终值回读 —— 理由：`cli` 单通道，并发方在跑，撞车风险（见 §5）
- [2026-09-19 14:10] R43 未落 · 投递 dsh round39 复审 —— 理由：dsh 沙箱受阻态不在输入框，投不进去（见 §5）
- [2026-09-19 14:10] R43 未落 · 提交他人 `REVIEW_2026-09-15_round38-verify.md` / `索引补齐核对单.md` —— 理由：非我方产物、归属存疑（见 §3.2/§3.3）
- [2026-09-19 14:10] R43 存疑 · `screenshot_window` 自存图为全黑（`rgb(39,39,39)` 占 71%）⇒ OCR `find` 全 MISS —— 理由：BitBlt 抓不到被遮挡窗口内容，非窗口无内容；已改以 `probe_agents.py` 文本为准
