# NOTE_2026-09-19_round40 —— 自驱动巡检轮（执行方：WorkBuddy）

> **归属（R96）**：本件是**执行方（WorkBuddy）的分析件**，前缀 `NOTE_`（`REVIEW_*` 归复审方）。
> 触发：自驱动巡检自动化（每小时），本轮 2026-09-19 08:08–08:30。

## 0. 一句话结论

两个外部代理**都不需要我救火**：InsCode 空闲 17 小时（无半成品、无待批），dsh 空闲停在输入框
⇒ 本轮把 **round39 的三份未复审 NOTE 正式递给 dsh 复审**（已发出并观察到起新轮），
并**刷新 R86 超时值回读**：**42/42 函数仍全是 timeout=3**，该硬阻塞**依然只靠李老师控制台手点**。

## 1. 探针事实（DB / 截图原文，非印象）

| 对象 | 判据源 | 实测 |
|---|---|---|
| InsCode | `inflight_turn` | **0 行** ⇒ 不在跑 |
| InsCode | `approval_audit` 末行 | id=54，`bash` / `cd`，**已批准**（非 pending）⇒ 不等批准 |
| InsCode | `sessions` | `message_count=1465`、`model=deepseek-v4-flash`、`permission=auto`、`idle_sec=61320`（≈17.0 h） |
| InsCode | `working_dir` | `C:\Users\lzj\WorkBuddy\Claw\catering-profit`（**同仓**，写入方互斥仍需守） |
| dsh | 窗口 rect | `(852,105,1764,924)`（**最小化为 `-32000` 后 `ShowWindow(hwnd,9)` 恢复**） |
| dsh | OCR | 占位符「给智能体发消息」在位 ⇒ **停在输入框、空闲**；模型 `DeepSeek-V4-Flash`；无 error/额度/quota 字样 |

## 2. 门禁（我方基线，独立复跑）

| 命令 | 结果 |
|---|---|
| `node verify_all.js` | **64/64 套件通过，RC=0** |
| `node specs/dev-specs/prototype/check_error_codes.js` | **门禁 A–L 全绿，RC=0** |
| `git status --short` | 空 |
| `git rev-parse HEAD` == `git ls-remote origin refs/heads/dev` | `5f7ace88…` 两方一致 ⇒ 已推 |

## 3. 本轮动作①：给 dsh 发 round39 + round40 复审请求

**为什么是这件事**：队列 §6 五项（A6b / R91 / AD G1–G8 / R86 / 14 页走查）**已全部闭环**，
而 round39 的三份 `NOTE_` 正文里**各自写着「未经复审方复核，按先审后合应由下轮先审」**
⇒ 按「先审后合」，**当前唯一真正的缺口是"我的产出没人复核"**，不是"没有新活"。

发送方式：剪贴板 + `Ctrl+V` + Enter（`inscode-desktop-feed` 同族手法，避开输入法吞字）。

**发送成功的判据（两级，不靠 UI 回显）**：
1. 粘贴后 OCR 读到请求正文出现在输入框内（`dsh_after_paste2.png` 可见「输出约定．只读不改文件，结论落到」
   /「review/REVlEW2026一09一19round39」等行）⇒ **内容确实进了框**；
2. Enter 后输入框**清空**（占位符「给智能体发消息」回归）+ **18 秒后 OCR 见 dsh 正在跑
   `git log` / `git status --porcelain` / `node verify_all.js` / `node tools/selftest_ad_gates.js`**
   （`dsh_turn_start.png`）⇒ **消息已受理并起新轮**。

请求要点（全文 `review/evidence/selfdrive_20260919/dsh_round39_request.txt`）：
- 待审提交：`5f7ace8` / `3374423` / `cd8877e` / `68ae219` / `e660dd3`
- 待审件：`NOTE_..._round39-a6b-shop-dedup.md`、`-r81-mode-whitelist.md`、`-realcloud-get.md`
- 请它重点判三件：①判据是否可证伪（恒真 / 写死期望值 / 「存在类」冒充「行为类」）②变异回灌是否真转红
  ③有没有「三层守卫全绿但真云仍崩」的同族缺口被漏掉（附已知同族：`common/index.js` 漏导 `genId`、
  批量部署空壳函数）。
- 已声明两条**人工面**不属我漏项：R86 超时值、`idx_card_code_version` 的 GUI 手工插重复三元组。

## 4. 本轮动作②：R86 超时值回读（刷新留证）

证据：`review/evidence/selfdrive_20260919/timeout_probe_20260919_0815.txt`

- 命令：`cli.bat cloud functions info --project <repo> -e cloud1-d4gphpoxy337f2a25 --names <42 个函数名>`
- **实测：42/42 全部 `status='Active'`、`timeout=3`、`Nodejs16.13`**；`grep -v "│ 3 "` 零命中 ⇒ **无一被改**。
- 与 02:30 那次回读（`review/evidence/timeout_probe_20260919.txt`）**完全一致**；期间无部署，符合预期。
- 对照定值表（应然）：`smokeTest`15 / `initDb`30 / 导出 60 / `calcAmortize`+`adminQueryUser`20 / 其余 20
  ⇒ **偏差 42/42**，且 `initDb`=3s 直接卡住**上线第一步**。

### 4.1 本轮新踩到的 CLI 坑（记下来，下次别再试错）

`cli cloud functions info --names` 的**多值必须空格分隔**：
- ❌ `--names "a,b,c"` ⇒ CLI 把**整串当成一个函数名**，报 `InvalidParameterValue.FunctionName`，
  且**表格只有表头、零数据行** —— 这是**假空结果**，不是"没有任何函数"。
- ❌ 不带 `--names` ⇒ `Missing required argument: names`。
- ✅ `--names a b c`（空格分隔）⇒ 逐个 `Fetching info of cloudfunction X`。
- 另：`cloudfunctions/` 目录下的 **`_adminCore` 与 `common` 不是云函数**（前者是共享依赖目录、
  后者是 common 单源），必须排除，否则同样报 `InvalidParameterValue.FunctionName`。

## 5. 队列 §6 状态表（全部核对过源码/文档，非采信自述）

| # | 项 | 状态 | 判据 |
|---|---|---|---|
| ① | A6b 代码层兜底 | ✅ 已闭环 | `68ae219` + `cd8877e`；真云实测 `shop.user_id` 非 unique ⇒ 改单源 `defaultShopId()` 确定性 `_id` + 撞键容错回读 |
| ② | R91 F1/F2 UI 缺陷 | ✅ 已闭环 | `core/13 §7` 2026-09-19 回写：F1/F2a/F2b/L1–L3 六项 6/6，证据 `review/evidence/ui_fix_20260918/`，静态自测 `tools/selftest_ui_fix.js`（27 条，套件 59） |
| ③ | AD 适配 G1–G8 | ✅ 已闭环 | `3374423`；权威判据 `node tools/selftest_ad_gates.js` 24/24 |
| ④ | R86 超时值 | 🔴 **未闭环（人工面）** | 本轮回读 42/42 仍 =3；只能控制台手点，属李老师 |
| ⑤ | 14 页真数据走查 | ✅ 已闭环 | `5f7ace8` 14/14（v3 每页独立 connect） |

## 6. 待办 / 存疑

- 🔴 **R86 是唯一还卡着的"我方无解、只能人工"的硬阻塞**，卡在上线第一步 `initDb`。
  需李老师在控制台逐个改：版本管理 → 配置 → 高级配置 → 执行超时（1–300s），定值表见 §4。
- 🟡 **投喂通道已空**：8 批（0–7）已收官，无「批次 8」（`重启键 §1` 明载）。
  队列清空后**没有再自创新批次** —— 中优先级那批（监控告警 / 埋点 5 事件 / 网络重试）归属运营与工程、
  且明写「上线后 1 月内补」，**不该由无人值守自动化擅自开工**。是否开新批次请李老师定。
- 🟡 **存疑**：`dataAdapter.BIZ_KEY_FIELDS` 不含 `user_id`（`NOTE_round39-a6b §6` 登记为待查项）。
  本轮**未**找到 `da.get('user', <user_id>)` 形态的有效调用，**维持不改**（改它会动到 A6a 兜底面）。
  已一并交给 dsh 复核。
- ⚪ dsh 本轮复审**结论未出**（发出后即收口），下一轮巡检应优先取 `REVIEW_2026-09-19_round39-verify.md`。
