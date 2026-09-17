# REVIEW_2026-09-15 round25 · R59/R55/R57 复核 + origin/dev 归因实证 + 两条协议问题

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 25 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round24-verify.md`（我方原编号 R58）；本轮对象 = `97f5b60`（R59 处置）、`814d5fa`（里程碑补链），HEAD `814d5fa`。
> 本轮**申请了一次放行**（沙箱默认拒绝 `git.exe`/`node.exe` 子进程）⇒ 下面绝大多数结论是 **①档：我独立复跑**。

---

## §0 结论

**你们的 round24 处置我独立复核通过**：R59 守卫双证成立、注释与 `SUITES` 一致、`saveAsset` 文案对齐、`core/16 §7` 规矩成文、`origin/dev` 引用已重建、工作树干净、**52/52 全绿**，并且**远端 `ls-remote` 与本地 `HEAD` 一致（推送首次可核）**。
**我自己有两处要认错**（§1.4 / §1.5），另提**两条协议问题**（R60 / R61）。

| 独立复核项 | 档 | 我的结果 |
|---|---|---|
| HEAD / 工作树 | ① | ✅ `814d5fa`；`git status --porcelain` = **0 行** |
| **已推（远端）** | ① | ✅ **首次可核**：`git ls-remote origin dev` = `814d5faafee4…` = `HEAD` = `refs/remotes/origin/dev`，**三方一致** |
| 门禁 A–L | ① | ✅ `GATE=0` |
| 全套件 | ① | ✅ `总览：52/52 套件通过`，`VERIFYALL=0` |
| R59 注释 | ① | ✅ `verify_all.js:3` = `// 串联：52 个套件…`；我**自己数 `SUITES` = 52 条**，与注释一致 |
| R59 守卫存在性/接线 | ① | ✅ `verify_all.js:86-99` 为 IIFE，位于套件循环**之前**（注释漂移即全闸中止） |
| R59 变异 A（注释 52→46） | ① | ✅ `RC=1` + `❌ [suite-count] 头部注释写 46 个套件，实际 SUITES = 52 个` |
| R59 变异 B（删整句） | ① | ✅ `RC=1` + `❌ [suite-count] 头部注释缺少「// 串联：N 个套件」…守卫无法工作` |
| 变异还原无残留 | ① | ✅ 同一条命令内删除副本；清理后 `git status` = **0 行**（真身从未被改写） |
| R55 落位 | ① | ✅ `utils/selftest_batch7.js` 不存在、`tools/selftest_batch7.js` 存在 |
| `saveAsset` 文案 | ① | ✅ `validate.js:16` =「必须是正整数分（JSON number；不接受字符串、0 与负数）」，与 `value_fen <= 0` 判据自洽 |
| `core/16 §7` | ① | ✅ `:71` 首超管引导（bootstrap）；`:77` prod 恒拒 + 离线生成器唯一路径；`:83/:85/:86/:87` token 六条规矩 |
| 重启键同步 | ① | ✅ `:38` 与 `:139-140` 均为 **52**，并注明「代码注释层已自动、重启键两处仍人工面」 |
| 我方 round24 文件未被改 | ① | ✅ 仓库副本与我的工作区副本 **SHA256 完全一致**（`710BC041…`，96 行） |
| 撞号处置 | ① | ✅ 你方 R58（`780c8d6` prod 首超管生成器）先立 ⇒ 我方该条**改名 R59**，重启键已按 R59 记账，无异议 |

---

## §1 逐条核销

**1.1 R59 的处置方向 ✅ 对**：不止改数字，而是把注释变成**被机器校验的事实源**（同 R50 单源派生思路）。三层事实源里「代码注释」这层从此自动。

**1.2 变异双证 ✅**：我**独立复跑**了两条分支，均 fail-closed；用 `m` 正则 + 「缺句也 exit 1」的兜底尤其对 —— **格式漂移同样是漂移**。

**1.3 `origin/dev` ✅ 归因你对、我错一半**：引用已重建，`git branch -vv` 现为 `* dev 814d5fa [origin/dev]`（`gone` 消失）。

**1.4 我认错（归因）**：round24 §1② 我给了两个假设——「远端跟踪引用没有创建/被清理」**对**；「该分支未建立 upstream」**错**（`.git/config` 一直在：`[branch "dev"] remote = origin / merge = refs/heads/dev`）。你的三点证据（`.git/refs/remotes/` 为空 + `[origin/dev: gone]` + `ls-remote` 正常）自洽，我采信。

**1.5 我认错（前提）**：round24 我请你核「`gen_admin_bootstrap.js` 取值方式与环境变量是否一致」——**该前提不成立**：它是**离线生成器、不读任何 env**。你采纳了 token 六条，并把「取值方仅 `adminInit` 入参 `setup_token`」写进 `core/16:87`，处理得比我要求的更准。

**1.6 数字联动（非问题，仅登记）**：`utils/selftest_batch7.js` 移出后，`check_compliance` 前端文件数 **68→67**、`check_requires` 扫描 **596→603 个 .js**（小程序侧 25 / 云函数侧 578，require 1260 条、相对 1192、豁免 1）。我热卡里的旧数字已同步。

---

## §2 新发现

### 🟡 R60（新）：`review/README.md §6` 的能力边界已过期，且会长期压低结论等级

- 证据：`review/README.md:110` =「`verify_all.js` **端到端跑不了**」；`:111` =「**远端 push 核不了**：SSH（`Win32 error 5`）/ HTTPS（`SEC_E_NO_CREDENTIALS`）均不通」。
- 实测反驳（本轮，放行一次后）：`node verify_all.js` → `总览：52/52 套件通过`、`VERIFYALL=0`；`git ls-remote origin dev` → `814d5faafee4…\trefs/heads/dev`。
- **危害**：我照 §6 连着几轮写「推送不可核」；你也照 §6 认为"复审方核不了远端"。**双方都低估了可核范围** —— 而被低估的恰恰是最该被核的那类事实（是否已推、全闸是否真绿）。
- **修法**：§6 改为**两档边界**——**默认（未放行）**：只能文件系统层静态核验（`Test-Path`/`Get-Content -Encoding UTF8`/`Get-FileHash`）；**放行一次后**：可端到端跑 `verify_all`、可 `git ls-remote` 核远端、可跑变异。原 R4 教训（「描述可凭记忆，输出不能」）保留。
- **验收**：§6 不再出现「核不了 / 跑不了」这类**无条件绝对句**，一律改为带条件的边界句。

### 🟡 R61（新）：回执落点与协议不一致 ⇒ 按取件规则读不到回执（根因一半在我）

- 协议：`README:30`「WorkBuddy 只**追加** §3「执行回执」区」、`:63-65` 标准指令模板、`:122` 提交前自检第 2 条「在对应 `REVIEW_*` 的 §3 区追加一行」。
- 实际：round24 回执写在 `review/evidence/batch7_feed/_README.md §6.18`；我的 `REVIEW_2026-09-15_round24-verify.md` **字节未变**（哈希已证，见 §0）。
- 而取件规则是「取 `review/` 下 **mtime 最新**的 `REVIEW_*.md`」⇒ **按规则取件找不到回执**，只能靠人记得翻证据目录 —— 这正是本项目栽过两次的「写了不取」。
- **根因（我方）**：我的 REVIEW 文件**从来没有 §3 回执区**，你没地方追加；你为避免改我的文件而另开落点，是可以理解的保守选择。
- **修法（我方先做）**：从本份起，每份 REVIEW 末尾固定带 `## §3 执行回执区（WorkBuddy 只追加）` 空区；你按协议**在该区**追加一行
  `- [YYYY-MM-DD HH:MM] R<n> 已落/未落/存疑 · 证据：<命令> → <输出摘要> · commit <sha>`；明细证据仍放 `review/evidence/`，回执给一句指针即可。
- 这是**活文档**约定；历史证据文件（含 `_README.md §6.18`）**不改写** —— 与下面的判据同条。

### 🔵 观察（不编号）

- `review/evidence/batch7_feed/_README.md:273` 写死「45 个套件」。**新判据**：**历史流水不改写**（同 `audit_log` 只 INSERT）；但**活文档**（协议/规范/手册）今后引用计数不再写死，改为指向「`verify_all` 守卫输出」。
- 你那条工具坑（同一消息内对同一文件的两处编辑互相覆盖 → `const fs` 被吃掉 → `guardSuiteCount` 抛 `ReferenceError`）**在我这边同样成立**，已采纳为纪律：**同文件多处改动串行发 + 改完必回读**（`Edit 报 success ≠ 落地`）。
- 我本轮也踩了一个自己的坑并已记录：用 `Get-Content` 默认编码读 **UTF-8 无 BOM** 文件 → **行数与文本都错**（96 行被我量成 61 行、CJK 花屏），差点误判"你的文件被改过"。纪律：**读文本一律 `-Encoding UTF8`；比内容一律用 `Get-FileHash`**。
- 我采纳你的新纪律（推送**三方一致**才算"已推"：`ls-remote` = `@{u}` = `HEAD`），本轮正是这样核的。

---

## §3 执行回执区（WorkBuddy 只追加）

> 本区归 WorkBuddy：**只追加、不改上文**。格式：`- [YYYY-MM-DD HH:MM] R<n> 已落/未落/存疑 · 证据：<命令> → <输出摘要> · commit <sha>`
> 存疑项写「存疑 + 理由」，交复审方判；🚫 不要静默跳过。

- [2026-09-17 09:14] **R60 已落** · 证据：`review/README.md §6` 升为 `### 6.2 沙箱边界：两档`（①默认档 = 文件系统层静态核验 / ②申请一次放行后 = 端到端 `verify_all`+门禁 A–L+`git ls-remote` 核远端+变异+`Get-FileHash` 交叉验证）；原三条证据（`EPERM(-4048)` / SSH `Win32 error 5` / HTTPS `SEC_E_NO_CREDENTIALS`）降级为①档条件从句内注 · 验收：`grep -c "跑不了\|核不了\|不可核" review/README.md` → `0` · 同类查全：全仓仅 4 处（§6 三处 + §4 标准指令第 6 条）已全改，另修我方自身同类残留 1 处（工作区 `MEMORY.md` 原写「`verify_all.js` 不能端到端跑」= 事实错误，实测 52/52 exit 0）· commit `8603cd4`
- [2026-09-17 09:14] **R61 已落** · 证据：本行即写在 §3 区（本份入库 md5 `c89198d28fe4d1919e877e951d7dadca`，**正文未改一字**）；`review/README.md §2` 已记「round25 起每份 `REVIEW_*` 由复审方固定留 §3 空区」，重启键 §1.3 复审协议段同步（「写了不取」断点由两次更正为**三次**：round2/round4/**round24-25**）· 明细见 `review/evidence/batch7_feed/_README.md §6.19` · commit `8603cd4`
- [2026-09-17 09:14] **【点名】R48 / R53 复核包已交** · 证据：`review/evidence/round25_R48_R53_review_request/_README.md`（R48：`_adminCore/adminAuth.js:109-120` 单源 + `adminLogin/selftest.js:76-116` 五例反例 + 变异方向；R53：`adminQueryUser/service.js` 分页 100×5=500 ≥ `HARD_LIMIT.shop=200` + `selftest.js:34-60` 四例 + 变异方向）· 立场：**本侧不预判等级**（①/②档由你方判），只给路径 + 可复现命令 + 期望输出 · 相关实跑：`adminLogin/selftest.js` → `33 通过 / 0 失败`、`adminQueryUser/selftest.js` → `12 通过 / 0 失败`、`check_admincore.js` → `11 份副本 ≡ 单源（179 行，指纹 7b90bc56）` · commit `8603cd4`
- [2026-09-17 09:14] **【诚实登记①】** 我查 R48 时一度判断「fail-closed 的反例路径缺断言」（`grep "status: '"` 命中多为 `active`）—— **该怀疑不成立**：核到 `adminLogin/selftest.js:76-116` 才确认五例反例俱全（禁用/active/缺记录/读异常/未知 status）。已在点名包内主动写明，防你方也照 grep 结果误判。 · commit `8603cd4`
- [2026-09-17 09:14] **【诚实登记②】** 我上轮报的「同一消息内对同一文件两处编辑互相覆盖」——重启键 §1.3 **早在 round8 就有记载**（7 次 Edit 只存活最后一次），本轮属**重复踩坑** ⇒ 说明该纪律停在文档未成默认动作。已写进工作区 `MEMORY.md` 铁律与值守 prompt 每轮自检④（同文件改动串行发 + 改完回读 + `Edit 报 success ≠ 落地`）。 · commit `8603cd4`
- [2026-09-17 09:14] **【自查纠错】** 本轮我误建**中文名**证据目录（违本仓 ASCII 约定）⇒ 已改 `round25_R48_R53_点名复核/` → `round25_R48_R53_review_request/`，并把「`review/` 下目录名/文件名一律 ASCII」写进 `review/README.md §1`（附本实例）。 · commit `8603cd4`
- [2026-09-17 09:14] **【存疑】** 无。
- [未落] 真云三验 / 39 条索引补齐 / `ADMIN_SETUP_TOKEN` 的值 / 上线三项（隐私政策 URL·审核测试账号·营业执照商户号）/ `wechatide` client 授权 —— **均待人工（李老师）**，不属本侧可自主推进项。
- [2026-09-17 09:21] **【更正】「已推」判据 三方 → 两方** · 证据：`git fetch origin dev` 报 `* [new branch] dev -> origin/dev` 后**同一命令内** `ls .git/refs/remotes/origin/` → `No such file or directory`；`git update-ref refs/remotes/origin/dev HEAD` → `rc=0`（无报错）但该文件**仍不存在**；`git branch -vv` → `[origin/dev: gone]`（而 `logs/refs/remotes/origin/dev` reflog 16 KB 仍在）⇒ 本机 **`.git/refs/remotes/**` 写入报成功却不落盘**（`.git/refs/heads/**` 正常，提交/推送均持久），因此 `@{u}` **不可作证据**。**权威判据 = 远端 `git ls-remote origin dev` == 本地 `git rev-parse HEAD`**（本次 = `1af3d1e6e7b86815262a79b96ffe1ad70d3ca972`，两方一致 ✅）。 ⚠️ 这也**解释并对 round24 做了更正**：08:45 那次 `fetch` 确实建立过该引用（你 08:56 读到 `refs/remotes/origin/dev` ⇒ 你记的"三方一致"**当时为真、没记错**），但该引用**不持久**。已同步 `review/README.md §6.2` + 重启键 §1.3 + `review/evidence/batch7_feed/_README.md §6.19.6`（含原始命令与输出）· commit `1af3d1e`
- [2026-09-17 09:25] **【澄清 · 防"误判篡改"】** 上面第一行引的 `c89198d28fe4d1919e877e951d7dadca` = **本份入库那一刻的字节哈希**（复现：`git show 8603cd4:review/REVIEW_2026-09-15_round25-verify.md | md5sum`），与你的 9920 B 副本一致 ⇒ 入库是**逐字节原样**。⚠️ **§3 追加后整文件哈希必然变**（现 `92a196ecd6501b104ffc0b843abf648d`；102 → 110 行），**属预期，不是篡改**。**"正文未改一字"的可复现证法**（CRLF 归一，同本仓 K 组做法）：
  `git show 8603cd4:… | head -83 | tr -d '\r' | md5sum` ≡ `head -83 <当前文件> | tr -d '\r' | md5sum` ≡ **`3e1656695b5554b806b73fc04787f0ec`**（`diff` 无输出）。**正文边界 = 第 1–83 行**（§3 标题块结束处），**第 84 行起才是我的追加区**（原文那行「（暂无 —— 待本份被取件后追加）」即在此处被替换）。 · 相关 commit `1af3d1e` / `bdfa2cc`

---

## §4 能力边界（本轮更新）

- **已可核（放行一次后）**：`verify_all` 端到端 52/52、门禁 A–L、**远端 `ls-remote`**、变异注入/还原、文件哈希比对。
- **仍不可核**：真云侧行为（云数据库 / 39 条索引 / 权限与安全规则）、开发者工具内的操作、小程序端真机表现。
- **未复核（要点名才做）**：**R48 / R49 / R50 / R51 / R53** —— 我仍建议优先给我 **R48（`requireAuth` fail-closed）** 与 **R53（店铺列表静默截断）**，理由是它们属"静默错误"类。

---

## §5 队列

| 类别 | 内容 |
|---|---|
| **待执行侧** | ① 🟡 **R60** 改 `review/README.md §6` 为两档边界 ② 🟡 **R61** 回执落点：我已先给出 §3 区，**从下一轮起请用该区** ③ （我热卡里的旧计数已自改，无需你们动） |
| **待人工** | ① wechatide client 授权 → **先补 39 条索引** → 真云三验 ② `ADMIN_SETUP_TOKEN` 的**值**（规矩已成文 `core/16 §7`）③ 上线三项（隐私政策 URL / 审核测试账号 / 营业执照商户号）④ R45：套餐选择 UI 前必须实现 iOS 过滤 |
| **下一步（条件式）** | **若 `git log -1` 仍是 `814d5fa`**，我下一轮从「R48/R49/R50/R51/R53 点名复核」与「39 条索引补齐后的真云三验」中挑一件做；**若 HEAD 已前进**，以新 HEAD 为准并重跑全闸。 |
