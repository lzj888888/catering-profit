# NOTE · 自驱动巡检 round42（2026-09-19 12:27–12:50）

> 执行方：WorkBuddy（巴迪）｜仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`（dev）
> 证据：`review/evidence/selfdrive_20260919_r42/`

## 0. 一句话结论

**并发写入方仍在跑（李老师授权的 R86 GUI 批量改超时）⇒ 本轮按技能 §0.7 全程「只读旁观」**；
顺带拿到一个**新发现：dsh 处在「沙箱拒绝写入与 node 子进程」的受阻态**，
这解释了为什么 round40 递过去的 round39 复审请求至今**没有结论**——**不是它不干，是它干不了**。

## 1. 探针（唯一入口，`probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight_turn` = **0 行**；`sessions.idle_sec` = **76906**（≈21.4h）；`message_count` 1465（与 round41 持平⇒期间零新往来）；`approval_audit` 末行 `approved_once`（**非 pending**） | **idle**，不投喂（8 批已收官，无「批次 8」） |
| dsh | hwnd 855322，rect `[852,105,1764,924]`（**可见，非最小化**） | **found**，但**不在输入框**（见 §3） |

## 2. 并发写入方检出（本轮决定性判据，三连全中）

1. 窗口枚举命中 **`云开发控制台 v2.0.3 (2.0.34@707916636)`**（hwnd 13174140，1800×1034）⇒ 有人在点控制台。
2. `review/evidence/r86_timeout_20260919/` **mtime 持续在涨**：12:31:09 采样目录 mtime = 12:31:10；
   12:31:29 再采样出现新文件 `reset_adminInit_2_0.png` / `chk_top.png` ⇒ **20s 内确实在写**。
3. `git status --short` 出现**我没动过的**改动：`M review/REVIEW_2026-09-15_round38-verify.md`（+13 行，是并发方追加的 R86 回执）、
   `M 索引补齐核对单.md`（1 行）、`?? review/evidence/r86_timeout_20260919/`。

⇒ 按铁律：**不点 GUI、不跑 `cli`（单通道会与它的逐函数回读撞车）、不 `git add -A`**，
本轮只做**路径级提交**我方文件；**不给任何窗口加 TOPMOST/前台**（会把并发方的固定坐标点击打到错窗口，round41 已实证）。

## 3. 🔴 新发现：dsh 被沙箱卡死（不是"不干活"，是"干不了"）

- 截图 `dsh_855322.png`（**用 `screenshot_window`，全程未抢焦点**）OCR 全文首屏即：
  `沙箱拒绝此类写入与node子进程。`（`find 拒绝` HIT，center=(174.5,165.2)）
- `find 发消息` ⇒ **MISS** ⇒ dsh **没有停在输入框**（≠ 可投递状态，也 ≠ 正在跑命令）。
- OCR 里那段命令是 dsh 试图对 `cloudfunctions/saveCostCard/validate.js` 做**变异回灌**
  （Copy-Item 备份 → 把 `if (card.mode ...)` 改成 `if (false) {` → 比对 hash），
  被它自己的 harness 沙箱**拒了文件写入 + node 子进程** ⇒ **变异类验证在 dsh 侧根本做不了**。
- 推论：**round40 递的 round39 复审至今无 `REVIEW_2026-09-19_round39-verify.md`，根因大概率就在这里**。
  ⚠️ OCR 只用于定位与粗判（本机 OCR 有"稳定读错"前科），故本条记 **存疑 + 合理解释**，等能安全重探时再坐实。

**给李老师的决策点（我方无权自行放开）**：
- 方案 A：给 dsh 的 harness 放开**写文件 + node 子进程**权限 ⇒ 它才能做变异验证（复审质量最高）。
- 方案 B：让 dsh 改走**只读判据**（读源码 + grep + 跑仓内既有套件 `verify_all.js`/`selftest_*`），**不做变异**。
- 方案 C：dsh 退场，round39 三份 NOTE 由**我方（WorkBuddy）自审**（但违反"谁写的自测不算证据"的分权原则，不推荐）。

## 4. 我方只读代复核（不占通道，不采信自述，自己读源码）

| 项 | 判据（我自己跑的） | 结论 |
|---|---|---|
| 门禁 | `node verify_all.js` → **64/64 套件通过，RC=0** | ✅ |
| 门禁 A–L | `node specs/dev-specs/prototype/check_error_codes.js` → **✅ 全部断言通过，RC=0** | ✅ |
| A6b 代码层兜底 | `grep -l defaultShopId cloudfunctions/*/cx_auth.js` ⇒ **42/42 副本全含**；单源 `cloudfunctions/common/auth.js:27` = `'shop_' + userId`（确定性 `_id`） | ✅ 源码层成立 |
| R81 mode 白名单 | `cloudfunctions/saveCostCard/validate.js:34-37`：非 `'A'`/`'B'` ⇒ `err(...)` **响亮拒**，含 `undefined` 显式提示 | ✅ 无静默兜底 |

⚠️ 这两条只是**我方交叉验证**，**不构成 dsh 复审的替代**（分权原则：执行方自测不算证据）。

## 5. R86 进度（**只读**读取并发方的产物，未跑 `cli`）

`review/evidence/r86_timeout_20260919/results.json`（并发方产出，12:2x）：

| 函数 | expect | ok | why |
|---|---|---|---|
| saveCostCard | 20 | ✅ | cli=20 |
| saveAsset | 20 | ✅ | cli=20 |
| saveMaterial | 20 | ✅ | cli=20（之前已完成） |
| syncCostCard | 20 | ✅ | cli=20（之前已完成） |
| adminExport | 60 | ✅ | cli=60 |
| adminGrantEntitlement | 20 | ❌ | version-page-not-loaded |

- 42 全集里**已确认 5 个达标**（比 round41 的 1 个有实质推进），**1 个失败**（版本页未加载，疑似瞬时/交互问题），当前正处理 `adminInit`（证据图 `filt_adminInit_*` / `reset_adminInit_2_0.png`）。
- ⚠️ 同目录 `current_timeouts.json` 是**中途快照，已陈旧**（它写 `saveAsset: 3`，但 `results.json` 里 saveAsset 已 `cli=20`）⇒ **不能拿它当终值判据**。
- **下轮（并发方跑完后）该做的事**：一次性 `cli cloud functions info -e <env> --names <42 个空格分隔>` 做 **42/42 终值回读**，`grep -c "│ 3 "` 须为 **0**；重点核差异化定值 6 个：`initDb`30 / `adminExport`60 / `exportData`60 / `smokeTest`15 / `calcAmortize`20 / `adminQueryUser`20。

## 6. 回执（round42）

- [2026-09-19 12:33] R42 **已落** · 探针：`probe_agents.py` → inscode.inflight=0 / idle=76906s / 末批准 approved_once；dsh hwnd=855322 rect=[852,105,1764,924] · commit 见下
- [2026-09-19 12:31] R42 **已落** · 并发方检出：`git status --short` + 证据目录 mtime 双采样（12:31:10 / 12:31:29 新增 `reset_adminInit_2_0.png`）+ 窗口枚举命中「云开发控制台 v2.0.3」→ 判定并发写入方在跑，本轮降级只读 · commit 见下
- [2026-09-19 12:35] R42 **已落** · 门禁：`node verify_all.js` → 64/64 RC=0；`node specs/dev-specs/prototype/check_error_codes.js` → 全部断言通过 RC=0 · commit 见下
- [2026-09-19 12:36] R42 **已落** · 代复核：`grep -l defaultShopId cloudfunctions/*/cx_auth.js` → 42/42；`saveCostCard/validate.js:34-37` mode 非 A/B 响亮拒 · commit 见下
- [2026-09-19 12:38] R42 **已落（只读）** · R86 进度：读 `results.json` → 5 达标 / 1 失败(adminGrantEntitlement version-page-not-loaded)，当前 adminInit · commit 见下
- [2026-09-19 12:40] R42 **未落** · 42/42 CLI 终值回读 · 理由：`cli` 单通道，并发方正在用（会撞车），等它跑完下轮补 · commit —
- [2026-09-19 12:40] R42 **未落** · 向 dsh 投递/重探 · 理由：投递需 `TOPMOST+SetForegroundWindow`，会把并发方固定坐标点击打到错窗口；且 dsh 现处沙箱受阻态，投了也跑不动 · commit —
- [2026-09-19 12:41] R42 **存疑** · dsh 确切轮次状态 · 理由：OCR 只作定位（本机 OCR 有稳定读错前科），结论「沙箱拒写 + 不在输入框」为**合理推断非硬判据** · commit —
- [2026-09-19 12:42] R42 **未落** · 新批次开工 · 理由：8 批（0~7）已收官、无「批次 8」；中优先级项归属运营与工程且明写「上线后 1 月内补」⇒ 自动化擅自开工属越权 · commit —

## 7. 下轮待办

1. **R86 终值 42/42 CLI 回读**（并发方跑完后；确认 `grep -c "│ 3 "` = 0）。
2. **李老师决策 dsh 权限**（§3 三选一）；定了之后再把 round39 三份 NOTE 的复审递上去。
3. 若并发方仍在跑 ⇒ 继续只读旁观，勿抢焦点、勿跑 `cli`。
