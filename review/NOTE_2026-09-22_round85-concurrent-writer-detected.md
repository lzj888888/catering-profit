# NOTE · 2026-09-22 round85 自驱动巡检

> 结论一句话：**门禁基线 87/87 有效，但本轮检出第三个写入方正在活跃写码 ⇒ 按铁律 #1 全程只读旁观，两项计划内工作未落（理由见 §4）。**

## 1 探针（唯一入口，DB/窗口原文为据）

`probe_agents.py`：
- InsCode `idle`（`inflight=0`；`message_count=1465` **二十五连**持平；`idle_sec≈297803`≈82.7h；model `deepseek-v4-flash`；permission `auto`）
  ⇒ 不投喂、不投递。
- dsh `missing`（无标题含 DeepSeek Harness 的窗口）⇒ 不投递。

⇒ 两者均无活。按技能 §2 决策表，本轮不是"驱动"，而是**复核 + 防回潮**。

## 2 门禁基线（01:53 实跑，对应当时 HEAD `56b0ca1`）

| 项目 | 命令 | 结果 |
|---|---|---|
| 全套门禁 | `node verify_all.js` | **87/87 套件通过，RC=0** |
| A–L | `node specs/dev-specs/prototype/check_error_codes.js` | RC=0 |
| AD 复验 | `node tools/selftest_ad_gates.js` | **24 通过 / 0 失败** |
| UI 复验 | `node tools/selftest_ui_fix.js` | **38 通过 / 0 失败** |

队列 ①A6b / ②R91 / ⑤14 页走查：无新 commit、代码未变 ⇒ 维持已闭环结论（不重跑）。
队列 ④R86 超时值：人工面，本轮**未实测**，记**存疑**（沿用 round45/46/50 三方一致结论）。

## 3 独立复核 round84 的守卫 R114（`tools/check_waimai_spec_sync.js`）

不采信其自述，读源码 + **双向变异回灌 10 组**：

| 组 | 变异 | 期望 | 实际 |
|---|---|---|---|
| M1 | 规范 A.11.2 平台名漂移 | RED | RED |
| M2 | 规范 A.11.3 item_key 漂移 | RED | RED |
| M3 | 代码单源 terms.js 平台名漂移 | RED | RED |
| M4 | 代码单源 collections.js item_name 漂移 | RED | RED |
| M5b | 规范 A.11.2 删一行（4→3） | RED | RED |
| M6 | 规范 A.11.3 显示名漂移 | RED | RED |
| M7 | 正确实现换写法（平台名加粗） | GREEN | GREEN（不错杀） |
| M8 | 正确实现换写法（sort_order 改 1..6，相对序不变） | GREEN | GREEN（不错杀） |
| M9 | fail-closed：守卫 SPEC_REL 路径写错 | RED | RED（8 条转红，非恒真） |

**0 异常** ⇒ R114 判据本体与强度均合格（含"不错杀"那一向，不是只测"能抓错"）。

🆕 **M5 首轮 `MUTATION_NOT_APPLIED`：成因②CRLF** —— 该规范文件是**纯 LF**（`CRLF=0 / LF=284`，坑⑰ 遗留），
我的锚点写了 `\r\n` 恒不命中；改 `\n` 后 M5b 转红。按定式先自查、未误判成"该变异不适用"。

## 4 🔴 本轮最重要发现：第三个写入方正在活跃写码（02:05–02:24）

`git diff HEAD --stat`（02:29 采样）：

```
 miniprogram/i18n/terms.js         |  58 +++
 pages/month/input.js              | 351 ++++++++++++++++-
 pages/month/input.wxml            | 107 ++++++-
 pages/month/input.wxss            |  29 ++
 specs/dev-specs/i18n/terms.js     |  58 ++++
 ★知识存储点_2026-09-10.md          |   6 +-
 tools/selftest_r85.js（新）        | 112 ++++++++
 utils/takeaway.js（新）            | 184 ++++++++
 verify_all.js                     |   4 +-
 9 files, 892 insertions(+), 17 deletions(-)
```

- mtime 序列：`terms.js` 双副本 02:05 / 02:13 → `input.js` 02:14 → `input.wxml` 02:16 / `input.wxss` 02:16
  → `verify_all.js` 02:18 → 重启键 02:24 ⇒ **写入节奏 1–3 分钟，仍在跑**。
- 归属三条独立证据（都不是 InsCode）：
  ① 探针 InsCode `inflight=0` 且 `message_count` 二十五连持平 ⇒ 排除 InsCode；
  ② 我方本轮目标（R114 复核 / 4 份守卫扫描面）与这 9 个文件**零交集**，且我方变异已全部字节快照还原 ⇒ 排除我自己；
  ③ `git` 警告 `LF will be replaced by CRLF` ⇒ 这些文件当前是 LF，由**外部工具**写入（round53/70 同特征）；
  ④ 暂存区已有它 `git add` 的两个新件（`tools/selftest_r85.js` / `utils/takeaway.js`）⇒ 它在准备提交。
- 内容语义：`verify_all.js` 新增 `['r85-takeaway', 'tools/selftest_r85.js']`（第 88 个套件）+ 头注 87→88，
  配合 `pages/month/input.*` 与 `utils/takeaway.js` ⇒ 在做**月度录入页外卖段取数与录入**（规范 §A.11 的落实现）。

⇒ 处置（铁律 #1）：**不点 GUI / 不跑 `cli` / 不 `git add -A` / 不代提交、不代复核其半成品**；
本提交只带**我方证据文件路径**。其产出等它提交后由下轮按 §0.10 定式独立复核（门禁 + 读源码 + 双向变异）。

### 4.1 ⚠️ 归属更正（02:37 复探，推翻 §4 的"不是 InsCode"初判）

写 §4 时依据的是 01:52 探针（`inflight=0` / msg 1465）⇒ 判"第三个写入方、不是 InsCode"。
**02:37 复探**：`"inflight": 1`、`message_count` **1465 → 1466**、`idle_sec` 290.6、`verdict: "busy"`。

⇒ 写入方**就是 InsCode**（working_dir 同为本仓），由另一个 WorkBuddy 会话在 02:0x 投喂后启动
（工作区日记忆 `2026-09-22.md` 02:09 记有「投喂已送达并在跑（`inflight=1`）」）。

- §4 的四条证据里 ①（探针 idle）**已被新判据推翻**；②③④（LF 外部工具特征 / 我方零交集 / 暂存区有其 add 件）仍成立，
  但只能证明"不是我"，不能证明"不是 InsCode"。
- **教训（与 round55「mtime 静止不足以判停手」同族）**：`inflight=0` 只是**采样瞬间**的快照，
  AI 类写入方的启动与采样时刻错开是常态 ⇒ **判定"谁在写"必须复探**，且以 DB 最新值为准，不采信单次快照。
- 处置不变（铁律 #1 只读旁观），但**下轮判据更省事**：先看 `inflight`，有行就什么都不做。

## 5 🆕 本轮我方踩的判据 bug（值得单列，因为它直接导致误判"无并发方"）

`git status --short` 的已跟踪修改列写成 **` M verify_all.js`（前面带空格）**。
我按 `grep -E "^(M|M )"` 过滤 ⇒ **前导空格导致零命中**，于是得出"tracked `M`=0、无并发写入方"的错误结论，
并据此把「停手四连」判成通过。

- 正确写法：`git diff HEAD --stat`（最省事，直接看工作树 vs HEAD）
  或 `git status --porcelain | grep -E "^ ?M"`。
- 代价：01:51–01:56 两次采样都"通过"，实际对方 02:05 才开始写 —— 所幸未造成代提交；
  但**若对方在 01:5x 已动手，我就会在它写入期间误判停手并动文件**。

## 6 实扫：仅扫 index 的守卫是 **4 份**，不是记忆里记的 2 份

`grep -ln "ls-files" tools/check_*.js` 得 14 份，逐个看有无工作树补面（`readdirSync`）：

| 守卫 | 状态 |
|---|---|
| `check_collection_perms.js` | 🔴 仅 index |
| `check_quota_limits.js` | 🔴 仅 index |
| `check_suite_count_claims.js` | 🔴 仅 index |
| `check_suite_coverage.js` | 🔴 仅 index（round70 已实证过一次） |
| 其余 10 份 | 已用 index ∪ 工作树 或纯工作树递归 |

⇒ 记忆里「只剩 2 份」是**错的**（第四次印证"不采信自述，含我方上一轮"）。
修法与验证计划已写好（`review/evidence/_patch_r85.py` 因 bytes 字面量含非 ASCII 编译失败 ⇒ **零写入**），
本轮因并发写入方活跃**未落**，挂下轮。

## 7 回执

- [2026-09-22 01:53] R85 已落 · 证据：`node verify_all.js`（01:53，HEAD `56b0ca1`）→ 87/87 RC=0 · 基线文件 `review/evidence/selfdrive_20260922_r85/gate_baseline.txt`
- [2026-09-22 01:55] R85 已落 · 证据：AD `selftest_ad_gates.js` → 24/0；UI `selftest_ui_fix.js` → 38/0；A–L `check_error_codes.js` → RC=0
- [2026-09-22 01:58] R85 已落 · 证据：独立复核 round84 R114 双向变异 10 组 → 0 异常（`mutation_r85.txt` / `mutation_r85b.txt`）
- [2026-09-22 02:00] R85 已落 · 证据：`grep -ln "ls-files" tools/check_*.js` + 逐个 `readdirSync` 计数 → 仅扫 index 者 **4 份**
- [2026-09-22 02:29] R85 **未落** · 理由：检出第三个写入方 02:05–02:24 活跃写码（铁律 #1 单写入方）⇒ 4 份守卫的工作树补面补丁未应用 · 证据：`git diff HEAD --stat` → 9 files / 892 insertions
- [2026-09-22 02:29] R85 **存疑** · 队列 ④R86 超时值属人工面，本轮未实测（沿用 round45/46/50 三方一致结论）

## 8 待下轮

1. 🔴 **复核第三个写入方的外卖段产出**（等它提交后：门禁 + 读 `utils/takeaway.js` / `pages/month/input.*` / `tools/selftest_r85.js` 源码 + 双向变异）
2. 🟡 4 份仅扫 index 守卫补工作树扫描面（补丁脚本已备，`_patch_r85.py` 需先把 bytes 字面量改成 `str.encode()` 再跑；补面后须双向变异：未跟踪 .md 含漂移陈述→红 / 含正确陈述→绿）
3. 🟡 坑⑰ 遗留：`开发规范v1.0_ModuleA_收入费用核算.md` 是纯 LF（CRLF=0），与同族 CRLF 文件混用 —— 技术债，不代改（会造成大 diff）
4. 四红线/红绿灯代码侧零实现二选一（round80）、M3.7 配额指令二选一（round79）、R106 `CAT` 补「小时/秒」映射
5. 工作区 1000+ 历史取证 `.py`/PNG（`??`）未代提交未代删，等李老师定
