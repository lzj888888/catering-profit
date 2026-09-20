# NOTE · 2026-09-20 round61 自驱动巡检 —— 重启键「套件数」漂移实锤 + 套件数口径守卫

> 仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`。本轮为无人值守自驱动轮。
> 证据目录：`review/evidence/selfdrive_20260920_r61/`（已 `ls` 回读）。
> 一句话结论：**round60 新增第 69 个套件后漏跟了重启键的两处人工面（仍写 68，实算 69）**；
> 本轮实扫实锤、修正口径，并把「口径 ≡ 实算」做成常驻守卫（SUITES 69→**70**），
> **7 组双向变异全如期**；过程中变异 M3 又抓出一个更隐蔽的病：**`git ls-files` 对 CJK 路径默认八进制转义 ⇒ 整个 CJK 文件族被 `catch` 静默跳过**（已修两个守卫）。

---

## 1. 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| **InsCode** | `inflight=0`；`message_count=1465` **八连持平**（round58 起同值）；`idle_sec=166621`（≈46.3h）；`approval_audit` 末行 `approved_once` 无 pending；`working_dir` = 本仓 | **idle**，无待批准 ⇒ 不投喂（投喂队列 8 批 0~7 早已收官，无「批次 8」） |
| **dsh（:3080）** | 窗口在（`rect=[852,105,1764,924]`，非最小化），OCR 见「给智能体发消息」；但 `/api/sessions` `/api/health` `/api/config` **全 404**（`/` 与 `/v1/models` 200 = SPA 兜底，无效信号）；`api.deepseek.com` **401**（排除断网/额度）；`C:\Users\lzj\.dsh\web.log` mtime **2026-09-17 02:59**（≈82h ≈ 进程 uptime ⇒ 自启动零业务写入）；窗口会话名为「**餐饮闭店决策指标模型咨询**」，与仓库复审**上下文不匹配** | **第 11 轮不可用** ⇒ 不投递（两条独立理由：后端挂 + 上下文不匹配）。方案 D（重启 dsh web）仍待李老师批，无人值守未动手 |

## 2. 并发写入方判定：无（可正常写）

- 进程级两采（间隔 70s，脚本写在 .py 文件里跑 + 排除自身 PID，避 §0.7 自匹配坑）：**0 / 0**。
- `git status --short`：**`M`=0**；未跟踪 1034 个里 1033 个是并发方遗留的过程 PNG（`review/evidence/r86_timeout_20260919/`，round58 实测同为 1033 ⇒ **仍未动**，按纪律不代提交不代删）。
- 证据目录最近 mtime 除本轮产物外为 `selfdrive_20260920_r60`（12:18）；门禁跑完回读 mtime 无新增。
- HEAD `065016e` ≡ 上轮记录 ⇒ **无未复核的新 commit**。

## 3. 队列五项复验（§6）—— 仍全部闭环，无一回潮

| 项 | 复验方式与结果 |
|---|---|
| ① A6b 代码层兜底 | 已闭环（`68ae219`+`cd8877e`）；本轮无改动，`git log` 无新 commit ⇒ 不重跑 |
| ② R91 的 F1/F2 UI 缺陷 | `node tools/selftest_ui_fix.js` → **31 通过 / 0 失败**，RC=0（`ui.txt`） |
| ③ AD 适配 G1–G8 | `node tools/selftest_ad_gates.js` → **24 通过 / 0 失败**，RC=0（`ad.txt`）；辅助 grep：G1 字号 **0 命中**、G2 触控 **15 命中**（与 round60 同值，经人工判读均为 spacer / `min-height:88rpx` 合规，**以 selftest 断言为准**） |
| ④ R86 超时值 | 按 round50 结论（round45/46/50 三方一致 42/42）**不再回读**；仅保留提醒：建 prod 时须重走定值与回读 |
| ⑤ 14 页真数据走查 | 已闭环（`5f7ace8` v3 每页独立 connect，14/14）；本轮无改动 |

## 4. 本轮核心：重启键「套件数」漂移（同族病第 5 例）

### 4.1 实锤（不采信 round60 自述：它声称已「重启键回填」）

`tools/check_suite_count_claims.js` 首跑（`count_claims_before2.txt`）：

```
✅ C1 实算 N = 69
❌ C2-② 重启键 §1.1 一键校验入口行的套件数 ≡ N · 文档 68 / 实算 69
❌ C2-③ 重启键「套件数会漂」行当前值 ≡ N · 文档 68 / 实算 69
```

⇒ **round60 只同步了 `verify_all.js` 头注（R59 那处有守卫），重启键两处人工面漏跟**。
该文件自己就写着「改 SUITES 后两处都要跟，否则重启键自相矛盾而 **A–L 无一组能发现**」——
**这条警告至今成立，本轮才被机械化**。与 R86「索引已建≠生效」、round53「判据存在≠被执行」、
round51「隐私政策处数三份全错」同族：**权威入口写的数 ≠ 机器实算的数，且没人报警**。

### 4.2 修正 + 新守卫

- 重启键：`§1.1` 行 `串 **68**`→`**70**`、「套件数会漂」行`（现 **68**`→`（现 **70**`，演进链补 **69**（round60 覆盖守卫）与 **70**（本守卫）两条。
- `verify_all.js`：头注 69→70；SUITES 追加 `['suite-count-claims', 'tools/check_suite_count_claims.js']`。
- 新增 `tools/check_suite_count_claims.js`（**9 条断言 / 7 段**）：
  - C1 实算单源 = `const SUITES = [...]` 块（与覆盖守卫同源，不整文件扫）。
  - C2 **当前态声明 ≡ N**：`verify_all.js` 头注（与 R59 交叉）、重启键 §1.1、重启键「会漂」行；**fail-closed**（解析不到 = 红）。
  - C3 **「第 N 套件」序号声明 ≡ SUITES 实际位置**：同行须点名脚本，归一化后双向子串匹配（`env-ready` ↔ `check_env_ready`）。
  - C4 扫描面非空；C5 `review/` 排除的**前提守卫**（历史陈述面确实存在，56 个文件）；C6 **自指排除仅放行注释行**。
  - 历史陈述（review/ 下 `64/64`、`66/66` 等）按「只增不改」放行，靠**扫描面排除**而非句式猜。

### 4.3 双向变异回灌（7 组，全如期；`mutations3.txt`）

| 变异 | 期望 | 实际 |
|---|---|---|
| M1 重启键 §1.1 回退成 68（实算 70） | 红 | **RC=1 ✔** |
| M2 **正确实现换措辞**：「串 **70** 个套件」→「共 **70** 个校验套件」 | **仍绿（不错杀）** | **RC=0 ✔** |
| M3 提审材料包「第 66 套件」→「第 61 套件」 | 红 | **RC=1 ✔**（首轮曾假绿，见 §4.4） |
| M4 破坏「一键校验入口」标题锚点 | 红（fail-closed，不许静默跳过） | **RC=1 ✔** |
| M5 把 `review/` 排除改成不存在的 `reviewX/` | 红（C5 非恒真） | **RC=1 ✔** |
| M7 本守卫**代码行**（非注释）写一句「第 66 套件」 | 红（C6 非恒真） | **RC=1 ✔** |
| M6 从 SUITES 摘掉本守卫 | 覆盖守卫 S5 红 | **RC=1 ✔**（`未挂 SUITES：tools/check_suite_count_claims.js`） |

变异前已 `git add` 全部改动并确认 `git diff --stat` 为空（§0.3⑩：否则 `git checkout --` 会抹掉本轮工作）；
变异结束工作树 diff 为空、staged 仍在。

### 4.4 🆕 变异 M3 抓到的新坑：`git ls-files` 对 CJK 路径默认八进制转义

M3 首轮**该红却绿**——根因不是判据太宽，而是**扫描面里根本没有那个文件**：

- `git ls-files` 默认 `core.quotepath=true` ⇒ `specs/dev-specs/上线材料_提审材料包_v1.md` 输出成 `...\344\270\212...`；
- 守卫 `readFileSync` 找不到 ⇒ 被 `catch(_) { continue; }` **静默跳过** ⇒ **整个 CJK 文件族零覆盖而门禁全绿**。
- 验证：`git ls-files | grep 知识存储点` 零命中；`git -c core.quotepath=false ls-files | grep 知识存储点` 正常输出。
- 已修**两个**守卫（`check_suite_count_claims.js` 与本轮回溯到的 `check_suite_coverage.js`，后者同一处病），
  并加 fail-closed 断言：**路径里出现 `\NNN` 八进制转义即判红**（不许再靠 catch 静默跳过）。
- 同族：round56「判据扫错了层」、round53「判据存在≠被执行」——**扫空 = 零覆盖，而单向变异照样通过**。
  ⇒ **这也是「双向变异」价值的又一次实证：只看"能抓错"会放过"根本没扫到"。**

### 4.5 🆕 第二个新坑：守卫自指误报

M2 首轮判「误杀」，实为**本守卫自己的注释里写了「第 66 套件」举例**被自扫描命中
（与 round59「正确实现本身也会引用被禁对象 ⇒ 粗判据必误杀」同族）。
修法沿用 round59 模板：**自身文件排除 + 前提守卫 C6**（自指只许出现在注释行，非注释行出现即红），
并用 M7 证明 C6 不是恒真。

## 5. 门禁（改 specs 前后各跑）

| 命令 | 结果 |
|---|---|
| `node verify_all.js`（改动后） | **总览：70/70 套件通过**，RC=0（`verify_all.txt`）；`[suite-count-claims] ✅ PASS (9 条 / 段 7)`、`[suite-coverage] ✅ PASS (8 条 / 段 9)` |
| `node specs/dev-specs/prototype/check_error_codes.js` | **A–L 全绿 RC=0**（`AL.txt`，改 `specs/` 后必跑） |
| `node tools/selftest_ad_gates.js` | 24/24 RC=0 |
| `node tools/selftest_ui_fix.js` | 31/31 RC=0 |
| `node tools/check_suite_count_claims.js`（基线） | 9 通过 / 0 失败 RC=0 |

## 6. 回执

- [2026-09-20 13:26] R61-01 探针（InsCode idle 46.3h / msg 1465 八连持平、无待批；dsh 第 11 轮不可用）· **已落** · 证据：`probe_agents.py` → `inflight:0, verdict:idle` / `/api/*` 全 404、`web.log` mtime 2026-09-17 02:59 · commit `7c84e5d`
- [2026-09-20 13:28] R61-02 并发写入方判定 · **已落（判无）** · 证据：进程两采 0/0（`_proc_scan_r61.txt`）+ `git status` M=0 + 证据目录静止 + HEAD≡上轮 · commit `7c84e5d`
- [2026-09-20 13:40] R61-03 **重启键套件数漂移实锤** · **已落** · 证据：`node tools/check_suite_count_claims.js` → `❌ C2-② 文档 68 / 实算 69`、`❌ C2-③ 文档 68 / 实算 69`，RC=1（`count_claims_before2.txt`）· commit `7c84e5d`
- [2026-09-20 13:44] R61-04 修正口径（重启键两处 68→70 + 演进链补 69/70；`verify_all.js` 头注 69→70 + SUITES 追加）· **已落** · 证据：`count_claims_after.txt` → `9 通过 / 0 失败` RC=0 · commit `7c84e5d`
- [2026-09-20 13:52] R61-05 双向变异 7 组（M1–M5/M7 红、M2 绿、M6 覆盖层红）· **已落** · 证据：`mutations3.txt` 七行全「✔如期」 · commit `7c84e5d`
- [2026-09-20 13:47] R61-06 **CJK quotepath 静默跳过**修复（两个守卫 + fail-closed 断言）· **已落** · 证据：`git -c core.quotepath=false ls-files | grep 上线材料` 命中；M3 由假绿转红 · commit `7c84e5d`
- [2026-09-20 13:49] R61-07 门禁 · **已落** · 证据：`verify_all.js` → `总览：70/70 套件通过` RC=0；A–L RC=0；AD 24/24；UI 31/31 · commit `7c84e5d`
- [2026-09-20 13:50] R61-08 队列五项复验 · **已落（全闭环、无一回潮）** · 证据：见 §3（UI 31/31、AD 24/24、G1 0 命中、G2 15 命中人工判读合规）· commit `7c84e5d`
- [2026-09-20 13:26] R61-09 dsh 复审请求投递 · **未落** · 理由：后端 `/api/*` 全 404 + 会话上下文为「餐饮闭店决策指标模型咨询」与仓库不符 ⇒ 投了是上下文污染 · 证据：见 §1
- [2026-09-20 13:26] R61-10 并发方 1033 个过程 PNG · **未落（不代提交不代删）** · 理由：归属待李老师裁决，round58 起实测数量未变 · 证据：`git status --short | wc -l` = 1034
- [2026-09-20 13:26] R61-11 R86 超时值回读 · **未落（按 round50 结论不再回读）** · 理由：三方一致 42/42 已「稳定保持」；保留提醒：建 prod 须重走定值与回读 · 证据：round46/round50 证据目录

## 7. 提交

主体 commit ****（本 NOTE 的 sha 回填见紧随其后的 docs commit）。

本轮改动：`tools/check_suite_count_claims.js`（新）、`tools/check_suite_coverage.js`（quotepath 修复）、
`verify_all.js`（头注 69→70 + SUITES 第 70 项）、`specs/dev-specs/★知识存储点_2026-09-10.md`（两处口径 + 演进链）、
本 NOTE + `review/evidence/selfdrive_20260920_r61/`（取证文件 + 变异台账）。

## 8. 待下轮 / 上报李老师

1. **dsh 四选一仍未定**（放开写+node / 改只读判据 / 退场 / 允许重启 dsh web）⇒ round39 起 5+ 份 NOTE 复审仍悬；本轮新增第 11 轮不可用证据。
2. 并发方 1033 个过程 PNG 待裁决。
3. 建 prod 时提醒：重走 R86 定值回读 + 替换 `ENV_MAP.prod` 占位符。
4. 隐私政策按 **6 处**填（旧清单会漏 2 项，直接卡提审）。
5. 🆕 **CJK 路径是仓内所有 `git ls-files` 型守卫的通用盲区** —— 已修 2 个；若后续新增同类守卫，必须带
   `-c core.quotepath=false` + 转义路径 fail-closed 断言。
