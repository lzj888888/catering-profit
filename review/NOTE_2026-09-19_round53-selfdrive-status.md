# NOTE · 2026-09-19 round53 自驱动巡检状态

> 执行方：WorkBuddy（巴迪）· 无人值守自动化轮次 · 仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`
> 证据目录：`review/evidence/selfdrive_20260919_r53/`（已 `ls` 回读）

---

## §1 探针与并发判定

### 1.1 双代理状态（`probe_agents.py`，DB/窗口原文为准）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight=0`；`approval_audit` 末行 `bash cd` = `approved_once`（无 pending）；`message_count=1465`、`idle_sec=117658.5`（**32.7h**）、`model=deepseek-v4-flash` | **idle**，不点击不投喂 |
| dsh | hwnd 855322，`rect=(-32000,…)` ⇒ 最小化；恢复后 rect `(852,105,1764,924)` | 见 §3 |

`message_count=1465` 与 round51/52 **三连同值无增长** ⇒ InsCode 确实静止，不是"刚发完还没落库"。

### 1.2 并发写入方 = 已停手

- 进程级采样：除常驻噪音（`sheetagent` ×2、`weixinpay` ×2、`dsh bin.js web` ×1）外，**无任何指向仓内脚本或 `win_gui` 的 node/python**。
- `git status --short` 排除 PNG 后 **零条目**（无他人 `M`）；1033 个 `??` 全部落在 `review/evidence/r86_timeout_20260919/`（并发方过程截图，归属待裁决）。
- 证据目录 mtime `22:36:54`（上轮我方活动时间），本轮 23:49 采样 ⇒ **静止 73min**。

⇒ 本轮可正常写、可用 `cli` 单通道（未使用）。

### 1.3 HEAD 比对

`c52a189` == round52 收口 commit ⇒ **无未经我方复核的新 commit**。队列五项（A6b / R91 / AD G1–G8 / R86 / 14 页走查）**仍全清**，**不自创新批次**。

### 1.4 🔴 轮中突变：并发写入方**回归**（round41 之后首次）

本轮开局判定「已停手」在**轮次过程中失效** —— 00:13 之后工作树突然多出 **23 个我方未动过的 `M`**：

- **mtime 序列是决定性判据**（同一文件两分钟内被改两次，说明进程还活着）：
  `miniprogram/i18n/terms.js` `00:13:49` → **`00:15:47`**；`specs/dev-specs/i18n/terms.js` `00:14:26`；
  `app.js` `00:09:07`、`utils/paywall.js` `00:09:08`。
- **是实质代码改动，不是行尾/编码扰动**：`git diff app.js` 显示 `confirmColor: '#ff6b35'` → `'#1e3a5f'`（UI 主色），
  涉及 `admin-h5/index.html`、`app.json`、`app.wxss`、`pages/` 下 15 个文件、`utils/paywall.js`、**terms.js 双副本**。
- 字节级核过：这些文件 CRLF 计数均为 0，与仓内既有 LF 一致 ⇒ 排除"git autocrlf 回写"这一侥幸解释。
- 进程级采样**未**抓到仓内 node 进程 ⇒ 与 round49 同族：**瞬时进程，一次采样会漏判**；
  本轮是靠**文件 mtime 持续增长**抓到的，比进程判据更可靠。

**处置（按 §0.7 立即降级只读）**：① 不点 GUI ② 不跑 `cli` ③ **不 `git add -A`、不提交他人任何文件**，
只做**路径级提交**我方 3 个文件 ④ 不替对方修任何东西（含下方 K11）。证据：`concurrent_writer.txt`。

---

## §2 本轮核心：🟢 补上一个"存在但从不自动执行"的守卫

### 2.1 缺口是怎么发现的

队列空 ⇒ 按自律做「已入库文件」的防回潮扫描（不采信任何自述，含我方上一轮）：

- `git ls-files` 1165 个文件；命名含 `_tmp/tmp_/debug_/probe_/bak_` 的 **34 个命中全部在 `review/evidence/` 内**（取证命名，非调试残留）⇒ 合规。
- 命名含 `selftest/test_/check_/verify_` 的脚本 **81 个**，与 `verify_all.js` 的 SUITES 引用表（28 项）做 `comm -23` diff，剔除云函数自带 `selftest.js`（由 `check_selftest_shape.js` 守形状）与证据目录脚本后，**唯一漏网 = `tools/verify_docx.py`**。

### 2.2 为什么这是真缺口，而不是形式问题

- `tools/verify_docx.py` 是**权威判据**：仓库根 `.md` 是单源，同名 `.docx` 是二进制派生件，门禁 A–L 与各 `check_*.js` **都扫不到**（文本 grep 打不进 docx 的 XML run）。
  重启键 §12 与 `batch7_feed/_README.md` 都明写「重生成后必跑 `python tools/verify_docx.py`」。
- 但它**从未登记进 SUITES** ⇒ 「门禁 66/66 全绿」这句话**并不包含 docx 校验**。
  只要某次改了 `.md` 单源而忘了重生 docx（或忘跑这一步），**门禁照样全绿**，docx 里的旧结论会一直躺在库里。
- 与 R86「索引已建 ≠ 生效」、L 组「副本 ≡ 单源」同族：**"判据存在" ≠ "判据被自动执行"**。

### 2.3 处置（最小侵入）

1. 新增 `tools/check_docx_derive.js`（node 薄包装）：`verify_all.js` 的 runner 固定 `execFileSync(NODE, [fp])`
   ⇒ SUITES 项必须是 node 脚本，**不能直接挂 `.py`**，故做包装：找 python → 前置校验 → 跑 `verify_docx.py` → 透传输出 → 汇总收尾。
2. `verify_all.js`：SUITES 追加 `['docx-derive', 'tools/check_docx_derive.js']`；头部注释 **66 → 67**（R59 自校验要求 ≡ `SUITES.length`）。
3. **fail-closed 设计**：python 解释器不可用 / `python-docx` 缺失 / `verify_docx.py` 丢失 ⇒ 一律**判红并给修复指引**，绝不静默跳过。

### 2.4 变异回灌（证明不是恒真，修一处查全同类）

| 变异 | 注入 | 期望 | 实测 |
|---|---|---|---|
| **M1** 派生件漂移 | 用 python-docx 往 `SMOKETEST_RUNBOOK.docx` 追加一段 `9 个 unique`（`verify_docx.py::OLD_STRINGS` 命中项） | 转红 | ✅ **RC=1**：`❌ 旧串残留 [1] 9 个 unique`；D4（rc=1）/ D5（解析不到份数）/ D6（输出含 ❌）**三条全红**，`3 通过 / 3 失败` |
| **M1 还原** | `git checkout -- SMOKETEST_RUNBOOK.docx`（**不用 Python 写回**，防 CRLF 漂移出假 `M`） | 回绿 | ✅ RC=0，`6 通过 / 0 失败`；`git status` 该文件回到干净态 |
| **M2** 判据本体丢失 | `os.rename('tools/verify_docx.py', '….__mut')` | fail-closed 转红 | ✅ **RC=1**：`❌ D3 tools/verify_docx.py 存在 · 判据本体丢失`；改回后 `git status` 无 `M` |

**接入口径自校验也被现场验证**：首次跑时 R92 守卫直接拦下
`❌ [suite-tracked] 以下 1 个已登记套件未纳入 git 索引：tools/check_docx_derive.js` ⇒ 新套件必须先入库才跑得动；
另一次因 `check()` 只登记不打印 ⇒ R66 判「段标题下零断言」转红，已改为 `check()` 当场打印 ✅/❌。
⇒ **这三条不是我自述"已验证"，是门禁自己红的**。

---

## §3 🔴 dsh 第 9 轮不可用（症状与 round52 完全一致）

- 窗口标题 = **「餐饮闭店决策指标模型咨询 — DeepSeek Harness」** ⇒ 与仓库复审**非同一上下文**（李老师按主题分区），
  即使后端健康，把仓库复审请求投进这个会话也属**上下文污染** —— 这是本轮**不投递**的独立理由之一。
- 端点探活：`/` 与 `/v1/models` **200**（SPA 兜底，无效信号）；`/api/sessions`、`/api/health`、`/api/config` **全 404** ⇒ HTTP 层在应答、API 路由未就绪。
- 上游 `https://api.deepseek.com` = **401** ⇒ 排除断网与额度耗尽（401 不是故障）。
- 判据⑤（决定性）：`%USERPROFILE%\.dsh\web.log` mtime = **2026-09-17 02:59:56**，本轮 23:49 ⇒ **68.8h 未写**，
  且 ≈ 进程启动时刻 ⇒ **该实例自启动起零业务写入**（round52 为 67.62h，仍在累加）。
- `storages/session_projcache.json` mtime `09:21:08` ⇒ **14.5h** 静止。

⇒ **本轮不投递**。四选一（A 放开写+node / B 改只读判据 / C 退场 / **D 允许重启 dsh web**）**仍未裁决**；
dsh 已连续 9 轮不可用且证据逐轮加重，**无人值守不擅自动手**（`taskkill` 会杀李老师窗口）。

---

## §4 门禁（RC 一律重定向取，不走管道）

| 项 | 结果 |
|---|---|
| `node verify_all.js`（改前） | **66/66** RC=0 |
| `node verify_all.js`（新增套件后） | **67/67** RC=0，`[docx-derive] ✅ PASS (✅ 10 条 / 段 10)` |
| `specs/dev-specs/prototype/check_error_codes.js`（A–L） | **RC=0** |
| `tools/selftest_ad_gates.js` | **24/24** |
| `tools/selftest_ui_fix.js` | **27/27** |
| `[env-ready]` | **11/11** |

⚠️ **套件数 66 → 67**：所有记「66」的历史陈述（round50 之前的 §1.1 行）按**只增不改**保留，
新判据一律以 `verify_all.js` 实际输出的「总览：N/N」为准（R59 会自校验头部注释 ≡ `SUITES.length`）。

### 4.1 🔴 末次复核门禁转红 66/67 —— 归因：并发方，非我方

`[门禁 A-L] ❌ FAIL (exit=1)`：`❌ [K11] miniprogram/i18n/terms.js 与 specs/dev-specs/i18n/terms.js 不一致（双副本漂移）`。

- **归因判据**：K11 比的正是 §1.4 里那对**正在被并发方改写**的 terms.js 双副本（mtime `00:14:26` / `00:15:47`，
  一方改完另一方还没同步完，中间态必然不一致）。我方本轮**未触碰任何 terms.js**。
- **处置：不修**。按纪律「守卫红了先判真缺陷还是误报，**不许改代码迎合守卫**」；
  这里既不是我方缺陷、也不能由我方代修 —— 代修等于在别人写码的同一文件上抢写（违反 §0 铁律 1「同时刻只允许一个写入方」）。
- **佐证它确实在我方提交前是绿的**：`bb02199` 提交前后两次 `verify_all.js` 均 **67/67 RC=0**，
  转红只发生在并发方开始改 terms.js 之后。

### 4.2 🟢 我方自身疏漏一处，已补

`bb02199` 入库的 `tools/check_docx_derive.js` 是 **Edit 之前的版本**（`check()` 只登记不打印 ⇒ R66 判「段标题下零断言」转红）。
原因：Edit 之后没重新 `git add`，`commit` 只带 index 快照；而 runner 跑的是**工作树文件**，所以本机 67/67 掩盖了它。
⇒ 已补提交 `9fb0973`。**教训（与 round15 同族）**：提交前自检须加「工作树版本 ≡ 已提交版本」。

---

## §5 收口自检

- [x] 探针跑了，判据是 DB 原文 + 窗口/端点实测
- [x] 并发方判定（进程级 + 证据 mtime + `git status`）
- [x] HEAD 比对 `c52a189` == 上轮
- [x] 变异回灌 M1/M2 全如期，还原用 `git checkout --`，无 CRLF 假 `M`
- [x] 无 `_tmp*` / 调试件混入提交（`git diff --cached --stat` 仅 2 个文件 + 证据目录）
- [x] 门禁 **67/67 RC=0**（我方两次改动的提交时点，前后各一次）
- [x] 证据落盘 `review/evidence/selfdrive_20260919_r53/` 并回读
- [ ] 🔴 **未落**：末次复核 **66/67** —— K11 terms.js 双副本漂移，并发方改写中间态所致；**归因明确、不代修**（见 §4.1）
- [ ] 🔴 **未落**：并发方 **23 个 `M` 文件**（terms.js 双副本 / `app.js` 配色 / `pages/` 15 个 / `utils/paywall.js` / `admin-h5/`）**未复核、不代提交** —— 待其落定后按「队列清空 ≠ 无活」定式逐批复核
- [ ] 🔴 **未落**：1033 个并发方过程 PNG（`review/evidence/r86_timeout_20260919/`）**不代提交不代删**，归属待李老师裁决 ⇒ 收口后工作树非空
- [ ] 🔴 **未落**：dsh 四选一未裁决 ⇒ round39 等 5 份 NOTE 的复审仍悬

---

## §6 下轮建议

1. **李老师定四选一**（推荐 D：允许重启 dsh web）—— dsh 已 9 轮不可用，`web.log` 自启动零写入，再拖只会更久。
2. **李老师定 1033 张过程 PNG**（建议：整目录移出仓库到 `_archive/` 并加 `.gitignore`；R86 已三方一致闭环，过程截图保留价值低但体积大）。
3. 建 prod 时提醒：重走 R86 定值与回读 + 替换 `ENV_MAP.prod` 占位符。
4. 隐私政策按 **6 处**填（旧 4 处清单会漏 2 项，直接卡提审）。
