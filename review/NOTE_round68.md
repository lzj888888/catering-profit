# NOTE_round68 · 自驱动巡检（2026-09-21 00:19–00:5x）

> 执行方：WorkBuddy（巴迪）。仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`。
> 证据：`review/evidence/privacy_collection_20260921/`。

---

## 1. 探针状态（硬判据，非印象）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight_turn` **0 行**；`message_count=1465`（**十五连持平**：round51→68 同值）；`idle_sec=205984.3`（**57.2h**）；`approval_audit` 末行 `approved_once`，**无 pending** | **idle** ⇒ 不点击、不投喂 |
| dsh | 窗口 hwnd 855322 原 `rect=-32000`（最小化）⇒ `ShowWindow(9)` 恢复至 `(852,105,1764,924)`；截图 912×819 **纯白 84.1%**；OCR 仅得「餐饮闭店决…」「127.0.0.1:3080」 | **第 17 轮不可用**，且上下文不匹配 ⇒ 不投递 |

**dsh 后端不可用侧证五步**（全只读）：
① `/` 200、`/v1/models` 200（SPA 兜底，**非健康信号**）；② `/api/sessions` `/api/health` `/api/config` **全 404**；
③ `https://api.deepseek.com` **401**（=上游可达、仅缺鉴权 ⇒ **排除断网与额度耗尽**）；
④ 进程 `bin.js web` 启动于 `20260917030702` ⇒ uptime **93.3h**；
⑤ `~/.dsh/web.log` mtime **93.4h ≈ uptime** ⇒ **自启动起零业务写入**（不是"本轮抽风"）。

> **不投递的第二条独立理由**：窗口会话是「餐饮闭店决策指标模型咨询」，与餐饮小程序仓库**非同一上下文**
> （李老师按主题分区开会话）⇒ 投了是上下文污染。
> **待李老师四选一仍悬着**（推荐 **D 允许重启 dsh web**；无人值守未动手）。

---

## 2. 并发写入方判定：无（四连）

- `git status --short | grep -v '^??'` ⇒ **`M` = 0**；
- 未跟踪 1035 项 = 已知 **1033 个并发方过程 PNG** + 2 个我方进程采样 txt（**round58 起未变**，不代提交、不代删）；
- 进程采样（脚本写成 .py 文件跑 + 按 PID 排除自身）⇒ **HITS 0**；证据目录末次写入 `2026-09-20 22:59:39`（我方 round67 自留）；
- `git log --oneline -8` ⇒ HEAD `92fc406` **≡ round67 收口 commit** ⇒ **无未复核新 commit**。

---

## 3. 本轮核心：同族病第 12 例 —— 隐私收集项清单 ≡ 代码，零守卫

### 3.1 发现

`specs/dev-specs/上线材料_隐私政策_v1.md` §二 的「# / 信息项 / 收集时机 / 用途 / **代码出处**」表（6 行）
是**递交给微信审核 + mp 后台《用户隐私保护指引》录入的依据**（李老师照抄进后台表单），
表内每一行都带**代码出处**（`saveShopSetting` / `saveLedger` / `chooseAvatar` …）。

**实扫（零守卫的证据）**：
- `grep -rln "信息项|收集项|代码出处" tools/ specs/dev-specs/prototype/` ⇒ **零命中**；
- `grep -rln "上线材料_隐私政策|隐私政策_v1" tools/ ...` ⇒ **仅 `check_privacy_placeholders.js`**，
  而它**只守占位符处数（6 处），不看收集项一个字**。

### 3.2 后果（比第 9 例页面清单更硬）

| 漂移方向 | 后果 |
|---|---|
| 云函数改名 / 删除 / 拼错 | 表里仍声称收集该项数据 ⇒ **指引与实现不符**（微信审核常见拒审理由） |
| 代码新增隐私 API（如 `getPhoneNumber`） | 「我们不收集」段**静默过期** ⇒ **谎报隐私合规**（比"文案错"重一档） |

### 3.3 处置

1. 在 §二 立**唯一声明处**：`🔒 隐私收集项口径（唯一声明处）：本表共 **6** 项个人信息收集项`；
2. 在 `上线材料_提审材料包_v1.md` 立一处**引用**（`隐私收集项口径引用：**6 项**`）；
3. 新增 `tools/check_privacy_collection.js`（**R104**，20 条断言），SUITES **76 → 77**；
4. 重启键两处「套件数」76→77 同步（`verify_all.js` 头注 + 重启键 §1.1/会漂行）。

**判据（C1~C9，全 fail-closed）**：
- C5 **文档→代码**：表内每个标识符型「代码出处」必须 ≡ 云函数目录 或 ∈ 白名单（改名/删除即红）；
- C6 **代码→文档**：小程序端（剥注释后）出现的隐私 API 必须已登记（表内收集 **或** 显式零命中）；
- C7 **最硬一条**：「无 `X` 调用」/「…均未出现」点名的 API 在小程序端必须**零命中**（说"不收集"却真调了 = 谎报）；
- C8 三道**前提守卫**（表格解析 ≥1 / 云函数 token ≥4 / 零命中声明 ≥2）+ 序号连续 + 弱面扫描面有效；
- 扫描面**排除 `tools/` `specs/` `review/`**，否则守卫自身与文档会自指误报（坑⑫/⑮）。

### 3.4 顺带核实（差点误报）

附 的「本轮已扫 `pages/` `utils/` `app.js` 共 **52 个文件**」——实算 `pages/` 全部 = 56、`pages/+utils/+app.js` = 66，
看似漂移。**实算核实：52 = pages 的 js/wxml/json 42 + `utils/*.js` 9 + `app.js` 1**，是**另一合法口径**
（不含 `.wxss`）⇒ **归入弱面只 ⚠️ 明示、不判红**（坑⑭/⑯ 第七次印证）。

---

## 4. 🆕 新坑⑱：扫描面用 `git ls-files` = 只扫 index，工作树新增源码零覆盖

**变异 M3 首轮假绿抓出**：新增 `pages/__mut_probe_r68.js`（调 `wx.getPhoneNumber`）⇒ 守卫**判绿**。
根因：`execFileSync('git', ['ls-files'])` 返回的是 **index**，未 `git add` 的新文件根本不在扫描面
⇒ **扫空 = 零覆盖，而单向变异照样通过**（与 round56「判据扫错了层」、round61「CJK 被静默跳过」同族）。

**修法**：扫描面 = **index ∪ 工作树**（对 `pages/ utils/ miniprogram/ app.js cloudfunctions/` 走目录递归），
并加**非恒真前提守卫 C1-③**（工作树补面须 ≥40 个文件；路径写错即零覆盖）。
修完 M3 **转红**、M11（把 `WT_ROOTS` 写成 `pages_typo`）**转红** ⇒ 该前提守卫不是恒真。

> ⚠️ **溢出（未修，待裁决）**：实扫 `grep -l "ls-files" tools/check_*.js` ⇒ **6 份命中**，其中
> **4 份仅扫 index**（`check_collection_perms` / `check_quota_limits` / `check_suite_count_claims` / `check_suite_coverage`），
> `check_fn_inventory` 与本人新写的 `check_privacy_collection` 已有工作树补面
> ⇒ 那 4 份存在同一盲区（新增但尚未入库的文件不在扫描面）。本轮只修自己新写的这一份，
> **不代修他人/前轮守卫**（避免抢写与扩大改动面），如实列出待裁决。
> （⚠️ 首版 NOTE 凭印象写成「5 份、且点名 `check_privacy_placeholders`/`check_page_manifest`」，
> 回源实扫证明两处都错 —— 与 round51「4/7/6 处」同族，**计数与名单一律实扫**。）

---

## 5. 双向变异回灌（12 组，0 异常）

| # | 变异 | 期望 | 实得 |
|---|---|---|---|
| M1 | 代码出处改成不存在的云函数名 | RED | RED（C5） |
| M2 | 唯一声明处 6→5 | RED | RED（C4-①/②） |
| M3 | 小程序端新增 `getPhoneNumber`（未登记） | RED | **RED（修完；v1 假绿）**（C7） |
| M4 | 「不收集」段新增「无 `chooseAvatar` 调用」 | RED | RED（C7） |
| M5 | 删唯一声明处（fail-closed） | RED | RED（C3-①/② + C4） |
| M6 | 引用行 6→7 | RED | RED（C4-②） |
| M7 | **正确声明换措辞**「共登记 **6** 项，逐项对照代码」 | GREEN | GREEN（不错杀） |
| M8 | **无关计数**「本段共 **3 项**遗留待办」 | GREEN | GREEN（只 ⚠️ 明示） |
| M9 | 表格删第 3 行 | RED | RED（C4-① + C8-④⑤） |
| M10 | 另一 md 自称唯一声明处 | RED | RED（C9） |
| M11 | 工作树补面路径写错 | RED | RED（C1-③ 非恒真） |
| M12 | **新增合法页面（无隐私 API）** | GREEN | GREEN（不错杀） |

还原一律 `git checkout --`；变异前本轮改动已全部 `git add`（坑⑩）；新守卫落盘后即归一 CRLF（坑⑰，实测 281/281）。

---

## 6. 队列五项复核（实跑，非采信自述）

HEAD `92fc406` ≡ round67 ⇒ ①A6b ②R91 F1/F2 ③AD G1–G8 ⑤14 页走查 **无新 commit ⇒ 不重跑**；
本轮实跑抽查：**门禁 76/76（改前）→ 77/77（改后）RC=0**、**A–L RC=0**、**AD 24/24**、**UI 31/31**。
④R86 超时值按 round50 三方一致结论**不再回读**（本轮**未实测**，记为存疑）。

---

## 7. 收口自检

- [x] 探针跑过，判据是 DB / 截图原文
- [x] 并发方四连判定：无
- [x] 门禁 77/77 RC=0 + A–L RC=0 + AD 24/24 + UI 31/31
- [x] 证据落盘 `review/evidence/privacy_collection_20260921/` 并 `ls` 回读（9 个文件）
- [x] 无 `_tmp*` / 变异探针残留（`pages/__mut_probe_r68.js` 已删并回读确认）
- [x] 回执见 §8
- [x] 推远端两方一致

---

## 8. 回执

- [2026-09-21 00:2x] R68 **已落** · 探针：InsCode `inflight=0` / `msg=1465` 十五连持平 / idle 57.2h；dsh 白屏 84.1% + `/api/*` 全 404 + 上游 401 + `web.log` 93.4h≈uptime 93.3h ⇒ 第 17 轮不可用且上下文不匹配 · 证据：`probe_agents.py` → 见 §1
- [2026-09-21 00:22] R68 **已落** · 并发方判定：进程采样 HITS 0 + `M`=0 + 证据目录静止 + HEAD ≡ 上轮 · 证据：`_proc_scan_r68.py` → `TS 00:22:22 HITS 0`
- [2026-09-21 00:43] R68 **已落** · 同族病第 12 例做成守卫 `tools/check_privacy_collection.js`（R104，20 断言），SUITES 76→77 · 证据：`node tools/check_privacy_collection.js` → `20 通过 / 0 失败`
- [2026-09-21 00:4x] R68 **已落** · 双向变异 12 组 0 异常（M3 由假绿转红、M11 证 C1-③ 非恒真、M7/M8/M12 不错杀）· 证据：`mutation_matrix.txt` → `异常 0 / 12`
- [2026-09-21 00:43] R68 **已落** · 门禁 77/77 RC=0 + A–L RC=0 + AD 24/24 + UI 31/31 · 证据：`gate_final_77.txt` → `===== 总览：77/77 套件通过 =====`
- [2026-09-21 00:5x] R68 **存疑** · R86 超时 42/42 本轮**未实测**（按 round50 三方一致结论不再回读），非缺陷、是节省通道的既定取舍 · 证据：无（本轮未跑 `cli`）
- [2026-09-21 00:5x] R68 **未落 + 理由** · 另有 **4 份**守卫仅扫 index（`check_collection_perms` / `check_quota_limits` / `check_suite_count_claims` / `check_suite_coverage`），同盲区 ⇒ 本轮不代修，列溢出待李老师裁决 · 证据：`grep -l "ls-files" tools/check_*.js` → 6 份命中，其中 4 份无 `readdirSync/walkDir` 补面
- [2026-09-21 00:5x] R68 **未落 + 理由** · 1033 个并发方过程 PNG 仍悬在工作区（round58 起未变），归属待裁决，不代提交不代删 · 证据：`git status --short | grep -c '^??'` → 1035
- [2026-09-21 00:5x] R68 **未落 + 理由** · dsh 方案四选一（推荐 D 重启）未获授权，无人值守不动手 · 证据：§1 侧证五步
- commit：`4a9dc54`（守卫 + 口径单源 + 重启键同步）
