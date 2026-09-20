# NOTE_round60 · 自驱动巡检（2026-09-20 11:53–12:2x）

> 执行方：WorkBuddy（巴迪）· 仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit` · 分支 dev
> 一句话结论：**队列五项已全清、无并发写入方、无未复核新 commit**；本轮把「判据忘了挂 SUITES」这个**两次复发**的
> 系统性缺口做成了机械守卫（`tools/check_suite_coverage.js`，SUITES 68→**69**），双向变异 7 组全如期。

---

## 1 · 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结果 |
|---|---|---|
| InsCode | SQLite `inflight_turn=0`；`message_count=1465`（**七连持平**，round55/58/59 同值）；`idle_sec=161329`（**44.8h**）；`approval_audit` 末行 `approved_once` 无待批 | **idle** ⇒ 不投喂、不打断 |
| dsh | hwnd 855322，rect 正常（未最小化）；OCR 见「餐饮闭店决…」「127.0.0.1:3080」 | 窗口在，但**会话是「餐饮闭店决策指标模型咨询」，与仓库复审非同一上下文** ⇒ 不投递（上下文污染，§3.2） |

## 2 · 并发写入方判定（四连，§0.7）

- `git status --short`：被修改的已跟踪文件 **M = 0**；未跟踪 1034 个**全在 `review/evidence/`**（r86 过程 PNG 1033 + `_proc_scan_r58.txt`）。
- 进程采样两采（**11:57:49 / 12:11:49**，脚本写成 .py 文件运行以排除自身 PID，§0.7 坑）：**hits = 0 / 0**。
- 门禁跑完（约 1 分钟 + 多轮）后回读证据目录 mtime：最新仍为 `selfdrive_20260920_r59/` @ **10:47:57**（上轮），无新目录。
- `git log --oneline -8`：HEAD = `822af0a` **≡ 上轮 HEAD** ⇒ 无未复核新 commit。

⇒ **无并发写入方，本轮可正常写。**

## 3 · 队列五项复验（§6，不采信自述，逐条实跑）

| 项 | 判据 | 结果 |
|---|---|---|
| ①A6b 代码层兜底 | 已闭环（`68ae219`+`cd8877e`） | ✅ 无回潮 |
| ②R91 F1/F2 UI | `node tools/selftest_ui_fix.js` → **31 通过 / 0 失败**，RC=0 | ✅ |
| ③AD 适配 G1–G8 | `node tools/selftest_ad_gates.js` → **24 通过 / 0 失败**，RC=0；G1 grep（font-size <28rpx）**0 命中**；G2 grep 15 命中（人工判读：spacer/min-height 合规，以 selftest 为准） | ✅ |
| ④R86 超时值 | 人工面；round46/50 两次独立回读 42/42 ⇒ 已升级为「稳定保持」，本轮**不再回读**（留通道给新活） | ✅ 仅提醒 |
| ⑤14 页真数据走查 | 已闭环（`5f7ace8`，14/14） | ✅ |

## 4 · 本轮核心：SUITES 覆盖守卫（同族病第 3 例的**系统性**收口）

### 4.1 缺口陈述

本仓已**两次**栽在「新判据忘了挂 SUITES，且没有任何东西会报警」：

| 轮次 | 漏网判据 | 后果 |
|---|---|---|
| round53 | `tools/verify_docx.py` | 《改计数后必跑》的权威判据（docx 二进制，A–L 与 check_*.js 都扫不到）从未登记 ⇒ 「66/66 全绿」**不含** docx 校验 |
| round55 | `TERMS.forbidden` 13 条禁用词 | 全仓零守卫引用 |

两次都是**靠某一轮巡检恰好扫到**才发现的 —— 说明「覆盖率」本身**不是被机器校验的对象**。与 R86「索引已建 ≠ 生效」同族：
**判据存在 ≠ 判据被自动执行**。

### 4.2 本轮实扫（先确认当前有没有第 3 例）

| 扫描 | 结果 |
|---|---|
| 入库判据类脚本 vs SUITES 引用表 `comm -23` | 仅 4 个命中，**全在 `review/evidence/`**（取证件）+ `tools/verify_docx.py`（由 round53 的 `check_docx_derive.js` 间接包装，已覆盖） |
| 反向 `comm -13`（SUITES 引用但文件不存在） | **空** |
| `git ls-files` tmp/debug/probe/bak 命名 | 37 命中，**全在 `review/evidence/`**（取证命名，合规；round53 为 34，+3 属新轮取证） |
| 云函数 `selftest.js` 40 个 | **40/40 全挂 SUITES** |
| `tools/{check_,verify_,selftest_,test_}*.js` 20 个 | **20/20 全挂 SUITES** |
| 恒真断言扫描 | 仅 `tools/check_terms_forbidden.js:113` 的 `check(..., true)` —— 前置 `require` 失败即抛 ⇒ **装饰性 ✅（为过 R66），良性，不判红** |

⇒ **当前零漏网**。但「这一刻没漏网」靠的是人肉扫描，故补机械守卫。

### 4.3 新增 `tools/check_suite_coverage.js`（8 条断言，SUITES 第 69 项）

- **面 A（生产判据，必须挂 SUITES）**：`tools/`+`specs/dev-specs/prototype/` 的 `check_|verify_|selftest_|test_*`(.js/.py)、云函数 `*/selftest.js`、`common/__tests__/*.js` —— 实扫 **69 个**。
- **引用判定**＝直接（出现在 `const SUITES = [...]` 块）**或**间接（被任一 SUITES 脚本按其**相对路径**调用）。
  ⚠️ 间接匹配**只用相对路径、不用 basename** —— 40 个云函数都叫 `selftest.js`，按 basename 会互相"覆盖"、守卫当场失明。
  ⚠️ 只取 `const SUITES = [ ... ];` 块，不整文件扫 —— 否则 R59 的"收尾期望值"映射里的路径会被算成引用，守卫失明。
- **面 B（证据目录取证件，走枚举式 EXEMPT）**：4 条，带 `by/date/reason`；**双向防腐**：未登记即红（S6）、僵尸条目即红（S7）。
- **前提守卫 S8**（§0.3⑦：排除项必须连前提一起守）：面 B 得以豁免的前提是「它不是生产判据」⇒ 断言**面 B 零个脚本被 SUITES 引用**，一旦被引用即红（该移出证据目录，不是继续豁免）。
- **fail-closed**（S1–S3）：git 列表拿不到 / SUITES 块解析不出 / 面 A 为空 ⇒ 一律红，绝不静默跳过。
- **S4 反向**：SUITES 引用的 69 个文件全部存在。

### 4.4 双向变异回灌（§0.3⑧：能抓错 **且** 不错杀）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| M1 | 新增 `tools/check_zz_probe.js`（判据类命名）但**不挂** SUITES | 红 | ✅ RC=1，`S5 面 A 70 个判据零漏网` |
| M2 | 新增 `tools/gen_zz_probe.js`（**非**判据类命名） | **绿**（不错杀） | ✅ RC=0 |
| M3 | 证据目录新增未豁免取证脚本 | 红 | ✅ RC=1，`S6 面 B 5 个…` |
| M4 | 把一条 EXEMPT key 改成不存在路径（僵尸） | 红 | ✅ RC=1，`S6`+`S7` |
| M5 | 把面 B 脚本挂进 SUITES（违反豁免前提） | 红 | ✅ RC=1，`S8` |
| M6 | 切断 `check_docx_derive.js` 里 `PY_SRC` 指向 `verify_docx.py` | 红 | ✅ RC=1，`S5` ⇒ **证明 verify_docx.py 确靠间接引用覆盖，不是碰巧没扫到** |
| M7 | 正确实现换名（`check_env_ready_v2.js`）并同步挂 SUITES | **绿**（不错杀） | ✅ RC=0 |
| M8 | 全部还原 | 绿 | ✅ RC=0 |

### 4.5 🆕 本轮新坑（务必记取）

**`git checkout -- <file>` 从 index 还原 ⇒ 会把「本轮已编辑但未 `git add` 的文件」一起回滚。**
M7 首次报 `MUTATION_NOT_APPLIED`，查下来不是 CRLF，而是：M5 变异改了 `verify_all.js`、还原时它**尚未入 index**
（我只 `git add` 了新文件），于是 `git checkout -- verify_all.js` 把我本轮的两处编辑（头部 68→69 + SUITES 新增项）
**一并抹掉**，门禁回落到 68/68。
⇒ **定式：跑变异之前，先把本轮全部改动 `git add` 进 index，并确认 `git diff --stat` 为空（工作树 ≡ index）**；
   否则「还原变异」会变成「还原自己的工作」。与铁律 #8（还原一律 `git checkout`）不冲突，是它的**前置条件**。
   另：变异结束务必回读 `git diff --cached --stat` + `git diff --stat` 双确认。

## 5 · 门禁

| 门禁 | 结果 |
|---|---|
| `node verify_all.js`（改动前） | **68/68 套件通过**，RC=0 |
| `node verify_all.js`（改动后） | **69/69 套件通过**，RC=0（`[suite-coverage] ✅ PASS (8 条 / 段 9)`） |
| `node specs/dev-specs/prototype/check_error_codes.js`（A–L） | RC=0（I/J/K/L 四组派生护栏全绿） |
| `node tools/selftest_ad_gates.js` | 24/24，RC=0 |
| `node tools/selftest_ui_fix.js` | 31/31，RC=0 |

## 6 · 回执

- [2026-09-20 12:20] R60-01 探针双代理状态 · **已落** · 证据：`probe_agents.py` → InsCode idle(msg 1465 七连持平/idle 44.8h/无待批)、dsh 窗口在但上下文不匹配 · commit 见下
- [2026-09-20 12:20] R60-02 并发写入方四连判定 · **已落** · 证据：M=0 / 进程两采 0+0 / 证据目录 mtime 静止 / HEAD≡上轮 · commit 见下
- [2026-09-20 12:20] R60-03 队列 ①A6b 复验 · **已落** · 证据：无回潮（已闭环 commit 在库） · commit 见下
- [2026-09-20 12:20] R60-04 队列 ②R91 UI 复验 · **已落** · 证据：`node tools/selftest_ui_fix.js` → 31/0 失败 RC=0 · commit 见下
- [2026-09-20 12:20] R60-05 队列 ③AD G1–G8 复验 · **已落** · 证据：`selftest_ad_gates.js` 24/24 RC=0；G1 grep 0 命中；G2 grep 15 命中经人工判读均为 spacer/min-height 合规 · commit 见下
- [2026-09-20 12:20] R60-06 队列 ④R86 超时值 · **未落（按设计不重跑）** · 证据：round46/50 两次独立回读 42/42 已「稳定保持」，技能明写后续不必再回读 · commit 见下
- [2026-09-20 12:20] R60-07 队列 ⑤14 页走查 · **已落** · 证据：已闭环 `5f7ace8` 14/14 · commit 见下
- [2026-09-20 12:20] R60-08 「已入库判据 vs SUITES」防回潮扫描 · **已落** · 证据：5 道扫描，当前零漏网（4 命中全在证据目录，verify_docx.py 已由包装器间接覆盖） · commit 见下
- [2026-09-20 12:20] R60-09 新增 SUITES 覆盖守卫 `tools/check_suite_coverage.js` · **已落** · 证据：8 条断言 8/8；SUITES 68→69；头注同步 · commit 见下
- [2026-09-20 12:20] R60-10 双向变异回灌 7+1 组 · **已落** · 证据：M1/M3/M4/M5/M6 如期转红、M2/M7 不错杀、M8 还原回绿 · commit 见下
- [2026-09-20 12:20] R60-11 证据落 `review/evidence/selfdrive_20260920_r60/` 并 `ls` 回读 · **已落** · 证据：18 个文件 · commit 见下
- [2026-09-20 12:20] R60-12 提交并推 dev（两方一致） · **已落** · 证据：`git ls-remote origin refs/heads/dev` == `git rev-parse HEAD` · commit 见下
- [2026-09-20 12:20] R60-13 工作区日记忆追写 · **已落** · 证据：`.workbuddy/memory/2026-09-20.md` · commit（工作区，非本仓）
- [2026-09-20 12:20] R60-14 恒真断言扫描发现 `check_terms_forbidden.js:113` 装饰性 `check(...,true)` · **存疑** · 理由：前置 `require` 失败即抛 ⇒ 行为上 fail-closed，仅为过 R66 的装饰性 ✅；**是否要改成显式断言由李老师/复审方定**，我方不擅改他人守卫 · commit 见下
- [2026-09-20 12:20] R60-15 dsh 第 11 轮不可用 + 上下文不匹配 ⇒ 未投递复审请求 · **未落** · 理由：①当前会话「餐饮闭店决策指标模型咨询」与仓库非同一上下文 ②dsh 连续多轮后端不可用；round39 等 5 份 NOTE 复审仍悬，待李老师四选一 · commit 见下
- [2026-09-20 12:20] R60-16 1034 个并发方过程文件（1033 PNG + `_proc_scan_r58.txt`）· **未落** · 理由：归属待李老师裁决，按纪律不代提交、不代删（round52/58/59 同） · commit 见下

## 7 · 待下轮 / 待李老师

1. **李老师四选一**（dsh 放开写+node / 改只读判据 / 退场 / 允许重启 dsh web）—— 仍悬，round39 等 5 份 NOTE 复审未做。
2. 1034 个过程文件归属裁决（不代提交不代删）。
3. 建 prod 时提醒：**重走 R86 定值与 42/42 回读**（平台不采纳 `config.json::timeout`）+ 替换 `ENV_MAP.prod` 占位符。
4. 隐私政策按 **6 处**占位符填（旧清单会漏 2 项，直接卡提审）。
5. R60-14 装饰性断言是否整改，待定。
