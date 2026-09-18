# REVIEW_2026-09-15 round38 · round37 处置核销（**五条全落**）+ 头号发现：**被证明的改动没提交**（R92–R96）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 38 轮**。**新开文件**（协议 §2）。
> 实测时刻：**HEAD = `73232ec` = `origin/dev`**，工作树**脏**（21 改 + 3 未跟踪）。
> ⚠️ **同号不同物**：执行方的 `round38-adgap.md`（静态缺口清单）与我这份 `round38-verify` 是**两件东西**；编号归属问题见 **R96**。
> **三档纪律**：① 我独立复跑 / ② 只读其输出未独立验证 / ③ 未验。

---

## §0 结论

**一句话**：**round37 那五条我逐条核过，全部落地，且质量好**（R89 你自己判"我错"、R87 逐行补登、R88 三版对照表 —— 这三处都是**按最高标准**做的）。`probe_tmp` 也**已经删完并重跑了**，李老师**不用再拍板**（我核了 `48` 原文的 `createCollection:{ok:true}`）。

**但当前仓库状态有一件必须先说的事**：**AD 缺口（G1–G8）在工作树里已经全部修好，而它们一个都没提交** ——
`app.js` / `app.wxss` / `pages/**` 共 **21 个文件**处于修改态，**新守卫 `tools/selftest_ad_gates.js` 未跟踪**，而 `verify_all.js`（工作树版）**已经把它登记进 SUITES** ⇒ **"62/62 通过"只对我的工作树成立；远端（`73232ec`）是 61 套件、且没有 AD 守卫**（`git cat-file -t HEAD:tools/selftest_ad_gates.js` → `fatal: … not in 'HEAD'`）。**更麻烦的是：证据（截图/报告/`pages_dump.json`）已经提交，而被证明的那份代码没提交** —— 这是"留证不可复现"的最高一级形态。

---

## §1 逐项核销（round37 的五条 + §2.6① + R81）

| # | 自报 | 档 | 我的结论与复现 |
|---|---|---|---|
| 1 | **R86 已落并升 🔴**（`list` 只有 `initDb`/`smokeTest`；两者 `timeout=3`） | **②+①** | ✅ **证据成立**：`47_timeout_all.txt §A/§B` 是 CLI 原文（②）；其中"全仓只有 1 个 `config.json`、不含 `timeout`"这条我**上一轮已①档独立复现**（`**/config.json` → 仅 `initDb/config.json`，内容只有 `envVariables.DEV_ENV_ID`）；`core/06:192/:410` 铁律原句我 grep 到。**升 🔴 我接受**（触发了我的预设条件），但**风险表述要再收窄一次 → R93** |
| 2 | **R86 第三步单点试：`config.json` 的 `timeout` 不被采纳** | **②** | ✅ 据其输出（deploy `13 files`/`14.6 KB`、`fsDiag.root` 出现 `config.json`、`info` 与控制台「高级配置→执行超时」**双面都读 3**）。**这个实验设计得对**（单点、可回退、dev-only、**删掉实验文件不留假配置**）。⚠️ 结论的**适用范围要写死**（见 R94 附注：只试了一种键名 + 一种文件位置 + 一条通道） |
| 3 | **R87 已落**（逐行补登 + `README` 立条文） | **①** | ✅ `review/README.md:37-42` 新条文我逐字读过：「正文归属 = 复审方（**含"执行单"**）＋ 例外必须**逐行登记**（文件＋起止行号＋改前原文＋改后新文）；**只写单行号 = 不合格**」；`round37 §3:142-147` 的补登**逐行对上了**（改前 1 行 / 改后 2 行原文 + `git show` 复现命令）。**这是本轮最规范的一处处置** |
| 4 | **R88 已落**（旧件 = `01`） | **①** | ✅ `_README.md §6.3` 已重写为**三版对照表**（`01`/`40`/`46` 各带**采集时刻 = mtime** 并可 `ls -l --time-style=+%H:%M:%S` 复现）；`:202` 明写"⚠️ **它不是'旧件'**"；时序更正（`commonShape` 改善在 deploy#1、deploy#2 只改文案）与我的结论**逐字一致** |
| 5 | **R89 → 判"你对、我错"，数值撤回** | **①** | ✅ `:143` 逐字核对无误：`mtime = 02:27:08` ⇒ 该图**不可能**显示 `02:29:24`，并把 `05faec0` 提交信息里那句一并列为已撤回。**这处我认可你的处理方式**：撤回具体数值、保留定性表述、闭合结论**改挂字段差**（唯一站得住的依据） |
| 6 | **R90 已落**（A6 拆 A6a/A6b + 换判据） | **①** | ✅ 拆分与单源引用（`collections.js:23/31` 兜底 A6a；`:27-28` 非 unique ⇒ A6b 无兜底）**与我的结论一致**；"不要把'索引齐了'读成'A6 全消'"这句补得好。⚠️ 但**"执行单 §3 声明作废"过度** → **R94** |
| 7 | **§2.6① `probe_tmp`：已落（两次删除 + 一次重跑）** | **①（读原文）** | ✅ **白捡的判据成立**：`48_result_raw_afterdrop.txt` 里 `createCollection` 由历次 `{"ok":false,…Table exist…}` 变为 **`{"ok":true}`**（成功分支**首次**在真云走通）；`fsDiag.root` 14 项（含 `config.json`）与你说的一致；`uniqueEnforce` 仍是 `proof:"none"` 版；`Duration 900ms`/`Coldstart 567ms`。⇒ **李老师不需要再回任何字**，这项已闭环 |
| 8 | **R81 未落（排队，已登记 `core/13 §6`）** | **②** | 接受排队。⚠️ **已挂 4 轮**，且它是当前**唯一"已知会静默算错成本"**的开口（`mode:'b'`/`2`/`'C'`/`''` ⇒ 静默当 A）⇒ 建议**下一批第一件**，别再滚 |
| 9 | 同批校验（门禁 / `verify_docx` / 派生链） | **①** | ✅ 我实测 `GATE=0`（含 K/L 组）、`verify_docx` rc=0（3 份、计数 md ≡ docx 双向）；`SMOKETEST_RUNBOOK.docx/pdf` 的 mtime = 09-18 05:47（与你说的一致） |

**顺带两处口径更正（都不影响结论）**：
- "其余 **44** 个仓库函数未部署" —— 44 是**目录数**（含 `common`、`_adminCore` 两个非函数目录），**可部署函数 = 42**；你后来的 `deploy_pass1_42ok.txt` 用的 **42/42** 才是对的。⇒ 计数必须带字段清单（我的老纪律）。
- `47_timeout_all.txt` 第 6 行写"本文件**不含任何云侧写入**"，而 **§F 含一次重发部署** ⇒ **文件头是全称否定、与 §F 冲突** → 并入 **R95**。

---

## §2 新发现

### 🟡 R92 —— **被证明的改动没提交**：证据在仓库里、代码在工作树里（+ AD 快照未标时点 + 2 个 `_tmp` 遗留）

- **①档证据（全部我自己跑）**：
  ```
  git status --porcelain          → 21 个 M（app.js / app.wxss / miniprogram+i18n/terms.js /
                                    pages/**（14 个）/ specs/i18n/terms.js / specs/★知识存储点 /
                                    utils/api.js / verify_all.js / 索引补齐核对单.md）
                                  + ?? tools/_g1_tmp.js   ?? tools/_g3_tmp.js   ?? tools/selftest_ad_gates.js
  (工作树 SUITES 行数, HEAD SUITES 行数) = 62, 61
  git cat-file -t HEAD:tools/selftest_ad_gates.js → fatal: path … exists on disk, but not in 'HEAD'
  git diff HEAD -- verify_all.js   → 工作树**新增** ['ad-gates','tools/selftest_ad_gates.js']
  ```
- **后果（为什么这条要放头一条）**：
  1. **`62/62` 不是远端可复现的成绩** —— 远端是 **61 套件、没有 AD 守卫**。而它**不会红**：R59 的 `guardSuiteCount` 比的是**同一份文件内**的"注释数 ≡ SUITES 长度"，在 HEAD 那份里 `61 ≡ 61` ⇒ **全绿**。⇒ **"绿着少了一个守卫"**，正是 R67 的镜像（那次是"守卫文件没接线"，这次是"接线了、文件没提交"）。
  2. **证据与被证物分离**：`73232ec` 提交了 `ui_walk3_afterfix/pages_dump.json`、`probe_after_redeploy.json`、5 张"修后"截图，**但被它们证明的那份页面代码不在仓库里** ⇒ 任何人按仓库复跑都**复现不出这些证据**（"留证不可复现"，本仓最忌）。
  3. **未提交 = 可丢失**：这 21 个文件包含 **6 处 UI 走查修复 + G1–G8 全部 AD 修复**（我抽样①档复现：G3 23 个数字输入全部加上了 `adjust-position="{{true}}" cursor-spacing="20"`；G4 `app.js:46-47` 有 `getUpdateManager`；G5 `pages/mine/index.wxml:12` 有 `type="nickname"`；G6 `amortize.js:254`/`mine/index.js:137` 各有 1 处 `vibrateShort`；G8 `app.js:73-74` 有 `onNetworkStatusChange`；`utils/api.js` 的 `debounce` 已删）—— **修好了但不入库 = 一次误操作就全没**。
  4. **`_tmp` 遗留**：`tools/_g1_tmp.js`（3125 B）/ `_g3_tmp.js`（1099 B）是**改 wxml 用的一次性注入脚本**（`_g3_tmp.js:1` 自述"临时：G3 数字输入加 adjust-position"），**全仓 0 引用**（我 grep 过），留在 `tools/` 会被 `check_requires`/`check_stale_claims` 扫到（本次没红属侥幸）。
  5. **AD 缺口文档未标时点**：`round38-adgap.md` 的 G1–G8 是 **14:06 的快照**，而修复在 **14:43–14:53** 进工作树 ⇒ 下一个读者会以为"还没修"。
- **修法（四件，按顺序）**：
  ① **提交工作树**（21 个文件 + `tools/selftest_ad_gates.js`）+ **删除两个 `_tmp`**（已确认无引用）；
  ② 在 `round38-adgap.md` 顶部加一行时点标注：**"本快照 = 09-18 14:06；G1–G8 的修复见 `<commit>`（工作树）"**，并给每条加"现状/已修"列；
  ③ **新守卫（建议进 SUITES）**：`verify_all.js` 里每个套件 `rel` 必须 **`git ls-files --error-unmatch <rel>` 命中**，否则**判红** —— 把"套件登记了但文件没进版本控制"变成响亮失败（R67 的镜像面，机械阻断）；同时把"工作树脏"列为**交付前自检项**（`git status --porcelain` 必须为空，R77 那套 `§7 收尾自证`只是"若改了代码"，应升为**硬前置**）。
  ④ 两个 `_tmp` 类脚本若要复用，移进 `review/evidence/**`（归档件），别留在 `tools/`。
- **验收**：`git status --porcelain` **空** ∧ `git cat-file -t HEAD:tools/selftest_ad_gates.js` = `blob` ∧ HEAD 版 `verify_all.js` 的 SUITES 行数 = 62 ∧ `tools/` 下无 `_*tmp*`。

### 🟡 R93 —— `initDb` 的 🔴 要**再收窄一次**，并换一条**可判读**的验收

- **现状**：`47 §D4` 写"**可能**在建到一半被杀"，并正确地注明"按风险处理、非观测结论"。方向对，但**现场无法判读"到底建完没有"**。
- **两条被忽略的事实（①档，我读单源 + 探针原文）**：
  1. **`initDb` 是可重入的**：它的建集合是"已存在即拒绝**不阻断**"（`smokeTest` 历次 `createCollection:{"ok":false,…Table exist…}` 就是这条路径），种子写入也按既有键判重 ⇒ **中途被杀后重跑会继续建剩下的**，不是"部分现场不可恢复"。
  2. **40 条索引它本来就建不上**（A7 已定案：SDK 无 `createIndex`）⇒ `initDb` 的真实工作量 = **25 个 `createCollection` + 种子**，比"25 集合 + 40 索引"小得多（**这一点直接影响 3 秒够不够的判断**）。
  ⇒ 风险表述应改为：**"可能建到一半被杀，且返回/界面仍可能显示成功"**（与发现 A 同一个坑：控件上的"成功"指**调用**成功，与函数跑完无关）。
- **验收（可判读、只需一次控制台操作）**：跑完 `initDb` 后**回读 25 集合清单**（控制台数据库列表）**+ 种子行数**，而不是看返回值；并在 `core/13 §5` 与 Runbook 步骤里把"**回读清单**"写成硬前置。
- **为什么这条重要**：**prod 首次初始化必然是新环境 ⇒ 必然吃 3 秒默认** —— 这是上线路径上唯一"第一次就会撞"的地方。定值建议见 §2.6。

### 🟡 R94 —— "执行单 §3 声明作废"**过度**：它不答 A6，但它**本身仍然有效**

- **①档证据**：`round37 §3:162` 写"**原挂点（执行单 §3 成本卡三元组）声明作废**"；而 `round34:99` 的 §3 是「数据库 → `shop_cost_card` → 添加记录 → 复制已存在行的 **`shop_id`/`card_code`/`version` 三元组** ⇒ **必须被拒绝**」。
- **为什么不能作废**：它验的是**复合唯一索引"是否真的生效"**，并顺带排除"v1/v2 并存可能只是巧合" —— 那是 **`idx_card_code_version` 的生效性判据**，与 A6 **无关但独立有效**。R90 的正确结论是"**§3 答不了 A6**"，不是"§3 作废"。**作废它 = 白丢一条验收**（且它是"存在 ≠ 生效"这条本仓反复强调的判据的唯一真云落点）。
- **修法（一句话）**：`round37 §3` 与 `★知识存储点`/`RUNBOOK` 的对应措辞改为 —— **"§3 仍在册（验 `idx_card_code_version` 复合唯一是否生效）；但它**不答 A6**；A6a/A6b 改用 §2.6 那两条 1 分钟操作"**。
- **附注（`config.json` 实验的适用范围，同样别写宽）**：该实验证明的是「**这个键名、放在这个文件里、走 IDE CLI 这条通道，不被采纳**」；**不能**写成"平台不支持用文件配置超时"（没试过别的键名/位置/通道）。你 §F 的措辞（"不被 IDE CLI 部署通道采纳"）已经够窄 ✅，**只需在 `core/13 §5` 沿用同一措辞**，别在别处升级成全称。

### 🔵 R95 —— 留证文件的"**性质/时序**"自相矛盾（**一天内第 3 例** ⇒ 建议机械阻断）

- **3 例（①档，全部逐字）**：
  1. `47_timeout_all.txt:6` ="本文件**不含任何云侧写入**" vs **§F 含一次重发部署**（`13 files` 那次）；
  2. `48_result_raw_afterdrop.txt:2` 采集 = **05:30**，而 `:5` 前置① = "**05:31** 已在控制台删除 `probe_tmp`" ⇒ **前置晚于采集**；
  3. （round37）`35_function_list2.png` 的 mtime 02:27 vs 被引为 02:29:24（已撤回）。
- **定性**：不是数据造假，是**元信息（性质/时刻）没被当判据管**。本仓对"代码/文档计数"已有 6 个守卫，对**证据文件的元信息**一个都没有。
- **修法（建议机械阻断，5 行脚本级）**：新增 `tools/check_evidence_meta.js`（进 SUITES）——
  ① 每个 `review/evidence/**/*.txt` 若含 `# 采集：` 与 `# 前置`，断言**前置时刻 ≤ 采集时刻**（正则抽 `HH:MM`，同日比较）；
  ② 头注声明"只读/纯读"的文件，正文里**不得出现** `deploy`/`删除集合`/`add(`/`update(` 等写入关键词（命中即红，或要求显式写"§X 含云侧写入"）。
- **验收**：把上面两例塞回去 ⇒ 必须转红；现状（修好头注与时刻后）⇒ 绿。

### 🟡 R96 —— 执行方写了 **`REVIEW_*` 前缀的文件**：归属与编号两条都要定规矩

- **①档事实**：`review/REVIEW_2026-09-18_round38-adgap.md`（6465 B，mtime 09-18 14:06）由执行方在 `43daf40` 提交；内容自述"我只登记与复核"。
- **内容我判**：**质量高，我认**——静态 grep + **双计数**（含文档 vs 仅代码）+「**文档里写了 ≠ 代码里有**」的定位 + §4 明确"全部静态、无一项运行时验证""0 命中只证明关键词不存在，等价写法看不见" —— **边界写得比很多复审报告都严**。**但它的 §2 已经是过去时**（G1–G8 在工作树里都修好了）⇒ 见 R92 修法②。
- **两条要定规矩**：
  1. **前缀归属**：`REVIEW_*` 是**复审方产物**（`review/README.md:31`，且 R87 刚把"正文归属"钉死）⇒ 执行方的分析件请用**别的前缀**（建议 `NOTE_*` 或直接放 `review/evidence/<topic>/_README.md`）。否则"谁写的这份"重新变成要靠猜 —— 那正是 R87 要消除的歧义。
  2. **编号归属**：我现在与你**同时用 round38**（你 `round38-adgap` / 我 `round38-verify`）。建议成文：**`roundNN` 按"复审方一轮"计数**；执行方的并行分析件用 `roundNNx`（如 `round38-adgap`，且换前缀）—— 或反过来由你定，但**必须有一条规则**，否则下一轮还会撞。
- **注意**：这条**不影响**那份文档的价值，我**不建议删**；只改前缀 + 加一句归属说明即可。

---

## §2.6 两个待你拍板的值（R86 的收口）

`config.json` 那条路已证**不通**（§F）⇒ 只能**控制台手点**，所以要**先定值、再一次点完**（否则 42 个函数带着 3 秒上线）：

| 函数 | 建议值 | 理由 |
|---|---|---|
| `smokeTest` | **≥10s**（建议 15s） | 探针约 10 次串行 DB 往返 + 冷启动 567ms；10s 已有余量 |
| **`initDb`** | **≥20s**（建议 30s） | 25 个 `createCollection` + 种子（索引建不上，不计）；**prod 首次初始化必撞**，这是上线硬前置 |
| `adminExport` / `exportData` | **60s** | 对齐 `core/06:410` 铁律；1500 条分页累取 ≈15 页往返 |
| `calcAmortize` / `adminQueryUser` | **20s** | 资产多 / 上限 500 条 |
| 其余 | 默认 3s 或统一 20s（**写下来**即可） | 关键是"有取值且留痕"，不是"每个都调" |

⚠️ **两个纪律**：① 点完必须**逐个 `cli cloud functions info` 回读**留证（"**设置了 ≠ 生效了**"——本仓同族病：`config.json` 随包上传 ≠ 生效）；② **先定值再全量部署**，否则 42 个函数会各自吃默认值。

---

## §3 执行回执区（WorkBuddy 只追加）

> 本区归 WorkBuddy：**只追加、不改上文**（`review/README.md:37-42`）。格式：`- [YYYY-MM-DD HH:MM] R<n> 已落/未落/存疑 · 证据：<命令或操作> → <输出摘要> · commit <sha>`。

- [2026-09-19 00:02] R92① 已落 · 提交工作树 23 文件（含 `tools/selftest_ad_gates.js`）+ 删 `tools/_g1_tmp.js`/`_g3_tmp.js` · 证据：`git status --porcelain` → 提交后仅剩本份文件未跟踪 · commit `372838f`
- [2026-09-19 00:02] R92② 已落 · AD 文档加时点列 + 换前缀 + 归属说明 · 证据：`git mv REVIEW_2026-09-18_round38-adgap.md NOTE_2026-09-18_round38-adgap.md`；文件头补「归属（R96）」+「时点标注：快照 14:06 / 修复于 `372838f`」+ G1–G8 现状表（9 行全 ✅）· commit 待落
- [2026-09-19 00:02] R92③ 已落 · `verify_all.js` 新增 `guardSuiteTracked()`（SUITES 每个文件必须 `git ls-files` 命中，否则 exit 1；git 不可用按 fail-closed 判红）· **变异回灌**：注入未入库的 `tools/_mutant_untested.js` 并把头部注释同步成 63 ⇒ **R59 绿而 R92 红**（正是你描述的"R59 不会红"那个洞）· commit 待落
- [2026-09-19 00:02] 44→42 口径更正 已落 · `core/13:48` 由「其余 44 个业务函数尚未部署」改为「可部署云函数 = **42**（44 目录减去 `common/`+`_adminCore/` 两个非函数目录），42 个已于 2026-09-18 逐个重部署成功，但 timeout 仍是 3s 默认」· commit 待落
- [2026-09-19 00:02] R93 已落 · `core/13:44` + 重启键 `:116` 的 initDb 风险表述收窄：删「25 集合 + 40 索引 + 种子」，改为「① 建集合已存在即拒绝、不阻断 ⇒ 可重入；② 40 索引本来就建不上（A7）⇒ 真实工作量 = 25 次 createCollection + 种子」；风险改写为「**可能建到一半被杀，且界面仍可能显示成功**」；**验收 = 回读 25 集合清单 + 种子，不看返回值**；补「🔴 prod 首次初始化必撞」· commit 待落
- [2026-09-19 00:02] 超时定值表 已落 · `core/13` 与重启键 `:118` 同时补完整表（smokeTest ≥10s/建议 15s；initDb ≥20s/建议 30s；adminExport+exportData 60s；calcAmortize+adminQueryUser 20s；其余 20s）+ 两条纪律（**先定值再全量部署** / 点完逐个 `info` 回读留证）· **人工面（控制台点 + 回读）未做**，属李老师/控制台动作
- [2026-09-19 00:02] R94 已落 · 重启键 `:92`/`:107` 的「原挂点已撤 / 替换原挂点」改为「**§3 保留为独立验收项（验 `idx_card_code_version` 是否真生效），与 A6 新判据并列、互不替代**」，并写明「作废它 = 白丢一条验收」· `config.json` 结论**未**升级成全称（沿用 `:118` 的窄措辞：只证「这个键名、这个文件、这条通道」不被采纳）· commit 待落
- [2026-09-19 00:02] R95 已落 · 新增 `tools/check_evidence_meta.js` 并挂进 SUITES（62 → 63）· E1 纯读声明 vs 写入痕迹（**诚实标注例外即放行** —— `47_timeout_all.txt §F` 是正面样本，基线放行 3 次）/ E2 前置时刻 ≤ 采集时刻 / S1 扫描面非空 / S2 规则曾被完整触发（防正则腐化）· **变异回灌两组**：① 删 `:77` 例外声明 ⇒ 转红并点名 `:79`/`:83`；② 造「采集 05:30 + 前置 05:31 已删除」⇒ 转红 · 另：E2 无样本时**不开段标题**（避免 R66 判"零断言"，也不塞恒真断言）· commit 待落
- [2026-09-19 00:02] R96 已落 · `review/README.md` 命名表新增「执行方分析件 = `NOTE_*`」一行 + 前缀/编号四条规矩（前缀标归属 / roundNN 按复审方一轮计 / 已落文件不改名 / 分析件必须带时点标注）· 唯一改名实例已做（`round38-adgap` 由 REVIEW_ 改 NOTE_，文件头加归属说明、内容未删）· commit 待落
- [2026-09-19 00:02] R81 未落 · `saveCostCard` 的 `mode` 白名单**仍挂**（你标"挂 4 轮、建议下一批第一件"）· 本轮未动：它与本轮主题（提交 / 口径 / 元信息）无关，按你 §4 的建议留给下一批第一件 · 无 commit
- [2026-09-19 00:02] probe_tmp 存疑（**按你说明应为已闭环，我不重开**）· 你已核 `48_result_raw_afterdrop.txt` 原文：`createCollection` 由 `{ok:false,…Table exist…}` 变为 `{ok:true}` ⇒ 成功分支首次在真云走通 · 我不重复验，仅登记为「按复审方结论闭环」
- [2026-09-19 00:02] 全量门禁 · `node verify_all.js` → **63/63 RC=0**（含新增 `evidence-meta` 与 `ad-gates`）；门禁 A–L → **RC=0** · commit 待落

<!-- 以下为 00:40–02:15 追加（提交工作树后**真云首次跑通完整业务链路**的结果） -->
- [2026-09-19 02:15] 🔴 **新缺陷 2 已落**（真云）· 资产原值**字段名分裂**：写端 `saveAsset:48/60` 落库 `value_fen`，读端 `calcAmortize::docToAsset` 只认 `total_value` 且 throw ⇒ 真云上 `calcAmortize` 全程 `-504002`，**摊销不可用**。修法与既有先例 `getAmortSchedule:32` 一致（两字段名都接受，严格判型不变）。**复验**：修复前 2026-08/09 均 `-504002`；修复后均 `SUCCESS` = **833333 分**（30,000,000 ÷ 36，尾差倒挤末月，自洽）· 证据 `realcloud_20260919/amort_after_fix.json` · commit `89ce56e`
- [2026-09-19 02:15] 🔴🔴 **新缺陷 3 已落**（真云，**本轮最大**）· `da.get(coll, id)` = `.doc(id).get()` **按 `_id` 查**，而 `insert()` 走 `add()` ⇒ **`_id` ≠ 业务主键** ⇒ 6 处调用点真云一律 null（成本卡存不下 / 资产·物料只能新增不能改 / 店铺设置 / 导出）。**反证**：`smokeTest:114/116` 传真 `_id` ⇒ 一直正常。**证据链三步**：saveMaterial 建出 id → getMaterial 能列出 → saveCostCard 说"不存在"。**复验**：修复前 `RESOURCE_NOT_FOUND`；修复后 `version=1` / `version=2`（同 card_code 只 INSERT 不改）+ `getCardVersions` 有数据 ⇒ **验二通过** · 证据 `card_versions_after_fix.json` · commit `89ce56e` + `0b2d6b5`
- [2026-09-19 02:15] R97 已落 · 新增 `tools/check_data_contract.js` 并挂进 SUITES（63 → **64**）：C1 `da.get` 兜底在位**且非空**（≥3 字段）+ 不含非唯一字段；C2 同义字段在 **DB 读取点**必须兼容。**变异回灌三组**（含**修我自己的恒真断言**：首版只查"字符串在位" ⇒ 清空数组仍绿）；**两次假红**已收窄（只认 `doc.` 前缀 / `\]+` 容两个 `]`）· commit `89ce56e`
- [2026-09-19 02:15] 第三轮逐个重部署 · **42/42 FAIL=0**（推 common 变更必全量逐个部署）· 证据 `deploy_pass3_42ok.txt` · commit `0b2d6b5`
- [2026-09-19 02:15] 未闭合 · ① **§3 判据**（`idx_card_code_version` 真生效）需**控制台 GUI 手工插入重复三元组** —— 云函数入参**不接受 `version`**，我造不出重复三元组，只能走控制台 ② 超时值控制台手点 + `info` 回读 ③ **R81**（`mode` 白名单，挂 4 轮）· 无 commit


<!-- 以下为 2026-09-19 01:00-01:40 追加（R81 闭环：挂 4 轮后本轮做完） -->
- [2026-09-19 01:40] ✅ **R81 已落（挂 4 轮后闭环）** · `saveCostCard` / `calcBom` 的 `mode` 白名单。改 **8 处**：① `saveCostCard/validate.js:34` ② `calcBom/validate.js:43`（入口白名单，**含缺失也拒**）③⑤ 三份 `calcCostCard` 引擎副本改**断言式** `throw {code:'INVALID_PARAM'}`（`calcBom` / `saveCostCard` / `syncCostCard` 的 service.js）⑥⑧ 三处调用点包 `try/catch`把引擎抛错**透传为 INVALID_PARAM**（否则退化成 SYSTEM_ERROR = 含糊拒，违背 R27）· commit 待落
- [2026-09-19 01:40] ✅ **19 条断言 + 变异回灌** · 越界 `'b'` / `2` / `'C'` / `''` / 缺失 ⇒ INVALID_PARAM；**反向证据** `'A'` / `'B'` 必须放行（否则"一律拒绝"也能让越界断言转绿 = 判据失效）。**回灌**：把四处白名单条件改回 `false`（等价旧三元兜底）⇒ **19 条转红、两个 selftest RC=1**；还原后 `saveCostCard` 29/29、`calcBom` 40/40、`syncCostCard` 4/4 · 基线套件 64/64 + 门禁 A–L RC=0
- [2026-09-19 01:40] ✅ **真云复验通过（路径 A）** · 三函数**逐个**部署均一次成功（`success:true`）⇒ 页面上下文实调：`saveCostCard` 的 `'b'` / `2` / `'C'` / `''` 四条全 `INVALID_PARAM`（msg 逐字带当前值），`'A'` = **`SUCCESS`**；`calcBom` 同样 `'b'` 拒 / `'A'` 通。真 `shop_id=shop_mu6j87v1itrs`、真原料 `mat_mu7606ti1psx`（`getMaterial` 返回 6 条）⇒ **不是 mock** · 证据 `review/evidence/r81_probe_result.json` + `r81_deploy_20260919.txt` + `r81_probe.js`

- [2026-09-19 01:40] 🔎 **顺带核清（防误伤，不是想当然）** · 前端**恒传** `'A'`/`'B'`：`pages/card/edit.js:71` 的 `calcMode` 取自 `getCostCard` 出参，而 `getCostCard/service.js:13` 已把 DB 的 `calc_mode(1/2)` 映射成 wire 的 `'A'/'B'` ⇒ 收紧**不打断**现有流程；**grep 查全同类**：全仓 `=== 'B' ? 'B' : 'A'` **零命中**（唯一命中是 selftest 里的背景注释），`function calcCostCard` 只有 3 份，`web-preview` / `admin-h5` **无第四副本**
- [2026-09-19 01:40] 仍挂（人工面）· ① **§3 判据**（`idx_card_code_version` 真生效）需控制台 GUI 手工插重复三元组 ② 超时值（R86/R93）控制台手点 + `cli cloud functions info` 回读 · 无 commit
- [2026-09-19 01:40] 评审请求 · 执行方分析件 = `review/NOTE_2026-09-19_round39-r81-mode-whitelist.md`（`NOTE_` 前缀，R96）；建议与 `NOTE_...realcloud-get.md` 一并审

<!-- 以下为 2026-09-19 02:00-02:35 追加（A6a/A6b/§3 三判据实测 + A6b 修复） -->
- [2026-09-19 02:20] ✅ **A6a / A6b / §3 三条判据全部真云实测完成**（此前只能靠**控制台 GUI 手工插重复三元组** = 人工面，一直挂着重）· 做法：给 `smokeTest` 加 `{ uniq: 'cc' | 'user' | 'shop' }` 入参触发（**程序化 + 自带清理**；默认不跑，避开线上 3s timeout）⇒ ① 往 `shop` 抄同 `user_id` **两次都成功** = **A6b 成立**（**实测，不再是"查单源推断"**）② 往 `user` 抄同 `openid` **被拒**（`E11000 … index: idx_openid`）= **A6a 已兜底** ③ `shop_cost_card` 重复三元组 **被拒**（`E11000 … index: idx_card_code_version`）= **§3 判据闭合**（"索引存在 ≠ 生效"首次拿到**正面证据**）· 证据 `review/evidence/uniq_probe_result.json`（E11000 全句原文）+ `uniq_probe.js` · commit `3a60294`
- [2026-09-19 02:20] ✅ **A6b 已修（代码层兜底）** · `shop` 无唯一索引 ⇒ **两处**建店点（`common/auth.js::resolveAuth` —— **每个函数必经**、风险面最大；+ `getShopContext` 建店分支）改用**确定性 `_id`**：单源新增 `defaultShopId(userId)` / `defaultEntitlementId(userId)`（**键格式单源，禁调用点自拼**）· 抽出 `autoProvision`，**顺序不可换**：先抢 `user`（`idx_openid` 是权威）→ 撞键则回读并**采用赢家的 `user_id`** → 再建 shop/entitlement（反过来会给临时 user_id 建出**孤儿店**）· 撞键判定单源 `isDuplicateKeyError`（认 `E11000|duplicate key` 或 `errCode=-502001`）· 回读仍为空 ⇒ **fail-closed**（不猜、不返回假 shop_id）· 三名新符号**同步进聚合入口 `common/index.js`** 并加进 `check_requires §2 MIN_KEYS`（**防 genId 漏导事故重演**）
- [2026-09-19 02:20] ✅ **A6b 判据 9 条 + 变异回灌** · `common/__tests__/batch0_selfcheck.js` 新增 A6b 段（严格假库：拒重复 `_id` / 拒重复 `openid`）：并发两次 `resolveAuth` ⇒ 1 user / 1 shop / 1 entitlement / 同一 `user_id` / `shop_id == shop_<user_id>`；**机制级**：确定性 id 下同 user 第二次建店**被库拒**；**反向证据**：换回随机 `genId` ⇒ **两次都成功 = 2 个店**（证明判据**非恒真**）· **变异回灌**：`defaultShopId(userId)` 改回 `genId('shop_')` ⇒ **RC=1** · 基线 `batch0_selfcheck` 41/41、`getShopContext` 29/29、套件 64/64、门禁 A–L RC=0
- [2026-09-19 02:20] ⚠️ **自我更正（写在回执里，不藏）** · 我一条断言原写「旧实现随机 id 会建 2 个」——**措辞不实**：`resolveAuth` 并发场景里输家采用赢家 `user_id` 后**提前返回、根本不建店**，功劳不在确定性 id。已改中性措辞，并把「确定性 id 真正压住的那条路径」（**用户已存在但无店** ⇒ 两个并发都 insert）单独做成**机制级**判据
- [2026-09-19 02:20] 📄 分析件 `review/NOTE_2026-09-19_round39-a6b-shop-dedup.md`；两处**过期否定式结论**已更正（`★知识存储点:92/107` 的「A6b 仍无任何兜底」→ 实测原文 + 已修，按 R82 纪律不删只改）
- [2026-09-19 02:20] ⚠️ **因 `cloudfunctions/common/` 变更 ⇒ 全量 42 个函数逐个重部署**（日志 `review/evidence/a6b_deploy_20260919.txt`）—— 不能批量（一次多个 `--names` 会产生**空壳**，见 round38 根因分析）
- [2026-09-19 02:20] 🔎 **顺带登记（未闭合，本轮未动）** · `dataAdapter.BIZ_KEY_FIELDS` **不含 `user_id`** ⇒ 若存在 `da.get('user', <user_id>)` 形态的调用会取不到；本轮**未**发现该形态的有效调用（`resolveAuth` 走 `where({openid})`）   ⇒ 登记待查，**不得**凭此改 `BIZ_KEY_FIELDS`（会动到 A6a 的兜底面）

- [2026-09-19 02:25] ✅ **A6b 全量重部署完成 43/43 零失败** · 日志 `review/evidence/a6b_deploy_20260919.txt`（`OK=43 FAIL=0`，逐个部署，含 `smokeTest`）
- [2026-09-19 02:25] ✅ **`_id` 主键唯一性真云实测**（A6b 兜底的前提）· `smokeTest` 加 `{ uniq: 'id' }` 段：同 `_id` 连插两次 ⇒ 第二次**被拒 `-502001`** ⇒ `_id` 必然唯一。4 项真云全中：`idx_card_code_version` UNIQUE / `user.idx_openid` UNIQUE / `shop.user_id` 无兜底（预期）/ **`_id` UNIQUE**，清理全成功 · 证据 `review/evidence/uniq_probe_result.json`（`primary_id` 段）· commit 待落
- [2026-09-19 02:25] 📄 A6b 分析件 `NOTE_...a6b-shop-dedup.md` 已补 §1 证据行 + §5 部署/复验结果

- [2026-09-19 02:15] 评审请求 · **批次 8（8a/8b/8c）+ genId 事故 + 本件两个新缺陷** 都还没经你复审；我落的执行方分析件 = `review/NOTE_2026-09-19_round39-realcloud-get.md`（按 R96 用 `NOTE_` 前缀）· 建议下轮优先审它

---

## §4 队列与自登记

| 类别 | 内容 |
|---|---|
| **🔴 先做** | **R92①** 提交工作树（21 文件 + `tools/selftest_ad_gates.js`）+ **删两个 `_tmp`** —— 这件事不做，`62/62` 与 `ui_walk3` 证据都只能算"工作树自述" |
| **待执行侧** | ② R92③ 新守卫「SUITES 的每个文件必须在版本控制内」+ 交付前 `git status` 空为硬前置 ③ R92② AD 文档加时点列 ④ **R93** `initDb` 风险表述收窄 + 回读 25 集合作为验收 ⑤ **R94** §3 不"作废"、只"不答 A6"；`config.json` 结论别升级成全称 ⑥ **R95** `check_evidence_meta.js`（证据元信息自洽，机械阻断）⑦ **R96** 前缀/编号两条规矩成文 ⑧ **R81（挂 4 轮）** `mode` 白名单 —— 建议**下一批第一件** |
| **待人工（复审方核不了）** | ① **超时定值 + 控制台逐个手点 + `info` 回读**（见 §2.6）② 三验的**验二/验三**（现在 42 个函数已部署 ⇒ **前置终于满足**，走路径 A：小程序页面驱动）③ `ADMIN_SETUP_TOKEN` 的**值** ④ 上线三项（隐私政策 URL【硬阻塞】/ 审核测试账号 / 营业执照商户号）⑤ **R45** iOS 过滤 ⑥ `Nodejs16.13`（已 EOL）是否另立待办 |
| **未评审面（请排专轮）** | **批次 8（8a/8b/8c）** + **`39e3e8a` 的 genId 事故修复**（`common` 单源漏导 `genId` ⇒ 全新用户首进必崩；已加 `check_requires.js §2 MIN_KEYS` 导出完整性守卫 —— 我①档确认守卫已在位、`MIN_KEYS` 含 `genId`）—— 这三件都**没经过复审**，我不在本轮下任何结论 |
| **我的自登记** | ① **转述落后仓库时必须报差值**：你这次转述的是 `6090691` 的处置，而仓库已到 `73232ec`（+10 提交）；我先核仓库再动笔，**做对了**，登记为纪律候选 35（"以仓库为准并**显式报告差值**"）；② 我一度把 `44`（目录数）当成函数数（含 `common`/`_adminCore`）⇒ 计数带字段清单这条**第 3 次**在同一个坑附近打转，已并入 R92 的口径更正 |
| **下一步（条件式）** | **若 `git log -1` 在提交本份后为 X**：我 round39 核 —— ① `git status` 是否已空、`HEAD:tools/selftest_ad_gates.js` 是否存在 ② R93/R94 的措辞是否改到位 ③ R95 守卫是否进 SUITES ④ **批次 8 / genId 专项**（若你说"先审这个"我就先做它，否则按上面顺序） |
