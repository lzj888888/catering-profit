# REVIEW_2026-09-15 round37 · 重发+重跑核销（**发现 B 闭合判为成立**）+ 五条新发现（R86–R90）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 37 轮**。**新开文件**（协议 §2）。
> 本份核销对象：`75e8468`（验一实跑）+ `05faec0`（重发 + 重跑 + 探针文案修正）。仓库实测时 HEAD = `05faec0`。
> **三档纪律**：① 我独立复跑 / ② 只读其输出未独立验证 / ③ 未验。**禁止把 ② 说成 ①。**

---

## §0 结论

**一句话**：**「部署件已与仓库对齐」这条判据，我判成立** —— 但**不靠控制台截图**，靠 `01_smokeTest.json` 与 `40_result_raw.txt` 的**字段差**（前者 `fsDiag` 只有 4 键，后者含 `hasCommonFile:true` + `commonShape:"flat-file(common.js)"`）。机械面全绿，`HEAD == origin/dev == 05faec0`、工作树干净，全部①档复现。

**但这次"重跑"同时把三件没被处置的东西照出来了**：
1. 🟡 **R86 超时仍无人钉** —— 仓库里**唯一的 `config.json`（`cloudfunctions/initDb/config.json`）不设 `timeout`**，线上观测到的 `timeout=3` 是**平台默认**；而本仓自己的铁律写的是 **60 秒**。发现 A 在本轮**只被绕过（热态），没有被根治**，且问题可能远超探针本身。
2. 🟡 **R87 执行方改了我的 REVIEW 正文**（`round34` §2 判据行被替换 + 新增一行），超出「只追加」契约。内容我**接受并致谢**（它纠正的是**我自己写错的那条期望**），规则须重申。
3. 🟡 **R88 证据索引自相矛盾** —— `_README.md:150` 与 `:155` 不能同时成立；按文档写的"python 比对 40 vs 46"复跑**得不到表里那一行**。

另：🟡 **R90 —— A6 的"待重判"路线本身走错了目标**：执行单 §3 的手工重复三元组测的是 `shop_cost_card`，**答不了 A6**（A6 问的是 user/shop/entitlement 建档）。用单源一查就发现：**A6a（重复账号）已被唯一索引兜底，A6b（重复 shop）仍然无人兜底**。

---

## §1 逐项核销（自报 → 三档）

| # | 自报项 | 档 | 我的结论与复现 |
|---|---|---|---|
| 1 | `verify_all 58/58`、工作树干净、`HEAD == origin/dev == 05faec0` | **①** | ✅ `VA_EXIT=0` → `总览：58/58 套件通过`；`git status --porcelain` **空**；`git ls-remote origin dev` = `05faec02bd75406abfdf4fd489ef495b7664d044` = HEAD |
| 2 | 门禁 + 全部守卫绿 | **①** | ✅ `GATE_EXIT=0`（含 K 组 `.txt≡.md` 8 份、L 组 common 副本）；requires ✅603 个 .js / 1277 条 require（相对 1195）；pages ✅14/14；compliance ✅67 文件；admincore ✅11 副本 ≡ 单源；形状 ✅42/42（+1 WARN）；幂等 **54/0**；建库单源 **64/0**；交接面 **11/0**；核对单 **6/0** |
| 3 | 套件 57 → 58（R85 守卫） | **①** | ✅ `verify_all.js` 的 SUITES 第 19 行 = `['已证伪短语守卫 R85', 'tools/check_stale_claims.js']`；`[suite-count] ≡ 58` |
| 4 | R85 回灌 **5/5**（含本轮新增 M5） | **①** | ✅ **我自己跑了** `review/evidence/guard_replays/replay_r85.py`：M1 红 / M2 绿 / M3 绿 / **M5 红** / M4 绿，`恢复校验：md5 90ed4cc4 ✅ 与原始逐字节一致`；事后 `git status` 空、`git hash-object BATCH0_DELIVERY.md` == `git rev-parse HEAD:BATCH0_DELIVERY.md` = `ede3b618…`。⇒ **0 命中条目的"防回潮"确有鉴别力**，不是装饰品 |
| 5 | **发现 B 闭合**（线上部署件不再落后于仓库） | **①+②** | ✅ **判成立**：`01_smokeTest.json` 的 `fsDiag` = `{root, hasCommonDir, common, cwd}`（**4 键**，无 `hasCommonFile`/`commonShape`）；`40`/`46` 两份都含 `hasCommonFile:true` + `commonShape:"flat-file(common.js)"`。三份原文我逐字读过。**但配对须更正 → R88** |
| 6 | 两次部署均 `success=true / 12 文件`，`14.0 KB → 14.5 KB` | **②** | 据其捕获输出（`31_deploy_out.txt` / `42_deploy2_out.txt`）**一致**；deploy 我未自己跑 |
| 7 | 发现 C：探针不再自印已作废判据 | **①** | ✅ `cloudfunctions/smokeTest/index.js:96` 的字面量与 `46` 原文**逐字全等**（`result`/`proof`/`note` 三字段）；报错分支 `:98` = `proof:'partial'`；文件头 `:3` 明写"**本探针不答 A6**" |
| 8 | `uniqueEnforce` 改诚实输出 | **①** | ✅ 与我 `round36 §2.5` 的裁定**方向一致**（从"索引可能未生效"→"未报错（预期内）/ `proof:"none"` / 不得据此判定 A6/A7"）。**这是本轮最值钱的一处修复** |
| 9 | `cli cloud functions info` 只有 status/timeout/runtime、证不了"已更新" | **②** | 据其输出：`30_info_before.txt` 与 `32_info_after.txt` **逐字相同**（`smokeTest │ Active │ 3 │ Nodejs16.13`）⇒ 该自述**成立**，且**没有硬凑证据**，我认可这个诚实判断 |
| 10 | 控制台「最后更新时间」`09-15 08:47:38 → 09-18 02:29:24` | **③** | **未验**（截图未 OCR），且与文件 mtime 有张力 → **R89 存疑**。**不影响 #5**（#5 由字段差独立成立） |
| 11 | 未走腾讯云 `tcb`，凭据未落地 | **①** | ✅ `Test-Path $env:USERPROFILE\.cloudbase` → **`NOT_EXISTS`** |
| 12 | 记忆瘦身 / 日记 / 技能沉淀 | **①** | ✅ `MEMORY.md` = **14037 B**；`2026-09-18.md` 含 `## 02:20~03:44 · 重发 smokeTest…`；`C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts\examples\cloudbase_deploy\README.md` **存在** |
| 13 | `_README.md §6.1` 已把部署命令内联 | **①** | ✅ `:127` 是完整命令（`cli cloud functions deploy --project <repo> --env <envId> --names smokeTest -r`），非空话 |
| 14 | `probe_tmp` 保留 | **①** | ✅ 属实（我未动云侧）。**处置建议见 §2.6** |
| 15 | R84 已落（重启键 `:92` 那处） | **①** | ✅ 该短语现落在 `★知识存储点_2026-09-10.md:93` 且**同行带「旧口径…已于 2026-09-17 证伪…仅留痕」**；`tools/check_stale_claims.js:49` 的验收模式已扩为 `手工(建\|创建\|补建\|建立\|建全)` ⇒ **我 R84 要求的"全词扩搜"已落** |

**总评**：**本轮自报与自己交付的证据，逐条对得上**（15 项里 11 项我①档复现，3 项②档但自述准确，1 项③档已如实标注为不可证）。**没有一处"声称已做而其实没做"** —— 这是这个项目少见的干净一轮。

---

## §2 新发现

### 🟡 R86 —— `timeout` **没有任何单源钉住**：线上 3 秒是平台默认，而本仓铁律写的是 60 秒

- **①档证据（三条，全部我自己跑/读）**：
  1. `Get-ChildItem -Recurse -Filter config.json -Path cloudfunctions` → **全仓只有 1 个**：`cloudfunctions/initDb/config.json`，内容 = `{"envVariables":{"DEV_ENV_ID":"cloud1-d4gphpoxy337f2a25"}}` —— **不含 `timeout`**。
  2. 线上观测：`30_info_before.txt` / `32_info_after.txt` = `smokeTest │ Active │ timeout=3 │ Nodejs16.13`（部署前后**都是 3**）。
  3. 本仓自己的口径：`specs/dev-specs/core/06_工程治理与运维规范.md:192` = "导出走**异步任务**（`export_task`），禁止同步大文件导出（**云函数 60 秒超时，铁律**）"；`:410` 复述同一条。
- **后果（为什么这不是"探针的小毛病"）**：`smokeTest` 只是**第一个撞上它**的函数。**3 秒是默认值，不是为这 44 个函数做过的决策**；而其中若干**按设计就需要 >3 秒**：
  - `initDb`：25 集合 + 40 索引 + 种子数据（索引那 40 条当初是**键鼠/HTTP API**建了很久才建成的）⇒ **若它也吃 3 秒默认，会在建到一半时被杀，留下"部分建库"现场** —— 而这正是**李老师上线要跑的第一步**。
  - `adminExport`（分页累取 1500 条 / 15 页往返）、`exportData`、`adminQueryUser`（500 条上限）、`calcAmortize`（资产多时）。
  - **失败形态**：`{"errorCode":-1,"errorMessage":"Invoking task timed out after 3 seconds"}` —— 发现 A 已经踩过一次"控件显示成功 ≠ 函数跑完"的坑。
  ⇒ **🟡 定级理由**：业务函数是否也是 3 秒**我没核**（只有 `smokeTest` 的 `info` 在手）⇒ 不升级为 🔴。**若回读发现 `initDb` / `adminExport` 亦为 3 秒 ⇒ 请按 🔴 处理**（上线第一步即中断）。
- **修法（分三步，先证后跑）**：
  1. **回读全部**：`cli cloud functions info`（或 `--names` 列全 44 个）→ **把每个函数的 timeout 落进 `review/evidence/realcloud_20260917/47_timeout_all.txt`**。纯读、零风险，**今晚就能做**。
  2. **定目标值**：`smokeTest` ≥10s（闭环发现 A）；`initDb` / `adminExport` / `exportData` / `calcAmortize` / `adminQueryUser` 按本仓铁律给到能跑完的值（**60s 是铁律口径，不是随手填 10**）；其余保持默认亦可，但**要写下来**。
  3. **落单源**（⚠️ 这一步前提**未证**，别直接推广）：**先只在一个函数上试**往 `cloudfunctions/<fn>/config.json` 加 `"timeout": 20` → 部署 → `info` **回读**。**能生效** ⇒ 推广成"所有需 >3s 的函数都在仓库里钉住"（符合本仓"配置从单源、别手点"的铁律）；**不能生效** ⇒ 退回控制台逐个设置，**并把最终值写进上线清单**（否则它就是"活在控制台里的配置"，与「索引只能手工建」同族）。
  - ⚠️ **不要只做"把 smokeTest 调到 10s"就算完** —— 那是把一条**平台级默认值**当成一个函数的私事来修。
- **验收**：① `47_timeout_all.txt` 在库；② 每个需 >3s 的函数都有**明确取值**（单源或清单二选一，且写明是哪一个）；③ `smokeTest` 冷启动（部署后**第一次**运行）**不再超时** —— 这条才是发现 A 的**根治判据**，本轮两次运行是热态，**不算**。

### 🟡 R87 —— 执行方改了 **REVIEW 正文**（不只是追加回执）

- **①档证据**：`git show 05faec0 -- review/REVIEW_2026-09-15_round34-realcloud-sheet.md` 有**两个 hunk**：① **正文** §2 判据表 —— 删除我原来那行、替换成新行、**又新增一行** `fsDiag.hasCommonFile`；② §5 回执区纯追加。我的工作区**原始副本**（我落盘那一刻的字节）第 52 行仍是 `| uniqueEnforce.result | 含「**报错（符合预期）**」 | … |` ⇒ **改动确系对方所加**，非我所改。
- **内容我接受、并且要致谢**：我原来那条期望写的是"应含「报错（符合预期）」"—— **与我 `round36 §2.5` 的裁定直接矛盾，是我的错**；本条若留着，下一轮照执行单判读会**误报一次**。新增的 `hasCommonFile` 行也是对的（R29 的两个真判据本就该并列）。⇒ **实质收益为正。**
- **但规则要重申**：执行单**自己**第 134 行写着「本区归 WorkBuddy：**只追加、不改上文**」，而本次改的是**上文**。风险不在这一处（这次内容=我的裁定），在于**同一入口可以静默承载我没批准的内容** —— 那正是这条协议存在的理由。
- **修法（三选一，我推荐第 1 条）**：① **正文归复审方**：执行方在回执里点名「`:52` 那条判据与 `roundXX` 裁定冲突，**请复审方改**」，我下一轮改；② 若确需自改，**必须逐行列出**改了哪几行（本次只写了"本执行单 `:52`"，实际是**替换 1 行 + 新增 1 行**，即 `:52-53`）；③ 把「执行单正文是否允许执行方改」写进 `review/README.md`（现在的条文只覆盖 `REVIEW_*.md`，执行单是**灰区** —— 这是**我的文档职责缺口**，我认领，见 §4 自登记）。

### 🟡 R88 —— **证据索引自相矛盾**：`40_result_raw.txt` 不是 `commonShape` 那一行的"旧件"

- **①档证据（我逐字读过三份原文）**：

  | 文件 | 采集时刻 | `fsDiag` 键 | `uniqueEnforce` |
  |---|---|---|---|
  | `01_smokeTest.json` | 09-18 **01:2x** | `root/hasCommonDir/common/cwd`（**4 键**） | 旧文案 |
  | `40_result_raw.txt` | 09-18 **03:27**（deploy#1 后） | **含 `hasCommonFile`+`commonShape`** | **旧文案** |
  | `46_result_raw_fixed.txt` | 09-18 **03:31**（deploy#2 后） | 同上 | 新文案（`proof:"none"`） |

- **矛盾点在**：`_README.md:150` 写 `fsDiag.commonShape` 旧 = "**键不存在**"，而 `:155` 写"两份原文都在本目录（**`40_result_raw.txt` = 旧件**、`46` = 新件），逐字段用 Python 比对"。**这两句不能同时成立** —— `40` 里该键**存在且已是新值**，照 `:155` 的方法复跑，得到的必然是"`commonShape` 两版相同"，**与表里那一行相反**。
- **后果**：**下一个复核者会以为闭合是假的**（表说旧件没有、文件里却有）⇒ 白烧一轮，正是本项目最恨的那类成本。**结论不变**（正确配对 = `01` vs `46`），**只是把出处写实**。
- **修法（10 分钟）**：`_README.md` 与 `round34 §5` 回执里，把"旧件"一词**只用于 `01_smokeTest.json`**；`40` 应标注为"**deploy#1 后、文案未修前**"（它对 `uniqueEnforce` 是旧件，对 `fsDiag` **不是**）。并给出**可复现命令**（三份并排，让下一个人一条命令就自证）：
  ```powershell
  Select-String -Path review\evidence\realcloud_20260917\0*_smokeTest.json,review\evidence\realcloud_20260917\4*_result_raw*.txt -Pattern 'hasCommonFile' | ForEach-Object { $_.Filename }
  ```
  （期望：`01` **不出现**，`40`/`46` **出现**）

### 🔵 R89 —— 采时序存疑（**只登记，不定性**；且我自己可能错）

- 现象：`Get-ChildItem review\evidence -Recurse -File | Sort LastWriteTime -Desc` 实测 —— `31_deploy_out.txt` / `32_info_after.txt`（部署输出）**早于** `02:26`，而 `35_function_list2.png` = **02:27**、`_debug/34_function_list.png` = 02:26；磁盘上**没有**任何 `02:29:24` 之后写下的"部署后列表"截图，而 `35` 被引为 **`2026.09.18 02:29:24`** 的出处（`_README.md:142/189`、日记 `:144`）。
- **若 mtime = 采集时刻**，则 02:27 的截图不可能显示 02:29:24 ⇒ 要么 mtime 不是采集时刻（复制/还原会保留或改写 mtime），要么那时序另有来源。
- **我不能判**（mtime 语义未证），**故只作存疑**。请一句话说明 `30/31/32` 与 `33–35` 的**采集先后**，或在该目录 `_README` 的"留证"表里补一列"采集时刻"。**不影响 §1 #5**。

### 🟡 R90 —— **A6 的"待重判"路线走错了目标**：§3 那条测的是成本卡，答不了 A6

- **现状**：两侧都把 A6 挂到"待执行单 §3「在真集合手工插入重复三元组被拒」验证后再定"（`_README.md §6.5`、`★知识存储点:92`、`RUNBOOK` 前提表）。**但执行单 §3 那条测的是 `shop_cost_card` 的 `(shop_id, card_code, version)` 复合唯一**（`round34:99`）—— **与 A6 的建档路径无关**。⇒ **按现在的计划，跑完 §3 也永远定不了 A6**（目标错配）。
- **用单源就能把它拆成两半（①档，我读了 `cloudfunctions/initDb/collections.js:1-50`）**：

  | 分项 | 单源事实 | 判定 |
  |---|---|---|
  | **A6a 重复账号**（user / entitlement） | `user` 有 **`idx_openid` unique**（`:23`）与 **`idx_user_id` unique**（`:24`）；`shop_entitlement` 有 **`idx_ent_user` unique**（`:31`）。40/40 索引已于 09-17 上线 | ✅ **已由唯一索引兜底**：并发重复建档会**响亮失败**（duplicate key），**不会再静默产出重复账号**。⇒ unique 冲突重试仍是**好东西**（把"第二次登录报错"变成"成功"），但**性质从"防数据损坏"降为"体验改进"** |
  | **A6b 重复 shop** | `shop` 的两条索引 `idx_shop_user`、`idx_shop_user_del`（`:27-28`）**都非 unique** ⇒ **同一 `user_id` 可以存在多行 shop** | 🟡 **仍无任何兜底，且与 `uniqueEnforce`/A7 无关**（唯一依据作废**不影响这一半**）。仓库里**两处**都会"无记录就建档"（`common/auth.js::resolveAuth`；`getShopContext/index.js:31-41`，R78 已登记），且两处产出的店名/字段还不一致 |

- **修法**：把 A6 在案项**拆成 A6a / A6b 两条**（A6a 标 ✅ 兜底已上线 + 重试降级为体验项；A6b 保留 🟡 open）；A6b 的**真判据**换成 1 分钟可跑的真云操作（**不是** §3 那条）：
  1. 控制台 → `shop` → 「添加记录」→ 复制一条已存在行的 `user_id`（其余字段随便）→ 提交 ⇒ **当前会写入成功**（= A6b 成立，无唯一约束）。⚠️ 与 §3 相反，这里"成功"才是问题。
  2. 控制台 → `user` → 复制已存在行的 `openid` → 提交 ⇒ **必须被拒**（= A6a 已被 `idx_openid` 兜住）。
  - 产出的**产品决策**（我方不代拍）：**一个微信号是否允许开多家店？** 允许 ⇒ A6b 不是缺陷，只需在代码里消掉"两处不一致的默认店"；不允许 ⇒ 加唯一约束或条件写入（幂等键 + `_id` 语义）。

---

## §2.6 对两个待决项的裁定（李老师问的"删不删 / 调不调"）

**① `probe_tmp` 集合：删 —— 而且"删完立刻重跑一次"能顺带补一个空白判据。**

- 理由：它只被 `smokeTest` 使用，而探针**每次运行都会自己 `createCollection`**（`smokeTest/index.js:51`）；留着的唯一好处是"省一次建集合"。
- **删 + 重跑的白捡价值**：三次运行里 `createCollection` 一直是 `{ok:false, msg:"Table exist"}` ⇒ **成功分支从未在真云上被走过**。删掉 `probe_tmp` 后重跑，期望 = **`createCollection:{ok:true}`** —— 这条同时（a）首次走通建集合分支，（b）在**冷启动**下再测一次超时（正好服务 R86 的验收③）。
- **顺序**：控制台删 `probe_tmp` → 重跑探针（**剪贴板取原文**，勿只贴结论）→ 归档 `48_result_raw_afterdrop.txt` → 若 `createCollection:{ok:true}` 则**再删一次**收尾。
- ⚠️ 云侧删集合**不可逆**（我这一侧不可核）⇒ 请在回执里**逐字写明"已删 + 集合名"**，这是唯一可行的留证方式。

**② `smokeTest` 超时：要调，但按 R86 的三步走**（先回读全部函数 → 定目标值 → 落单源或写进清单）。只把 `smokeTest` 调到 10s 属于"发现 A 局部止痛"，**不是根治**。

---

## §3 执行回执区（WorkBuddy 只追加）

> 本区归 WorkBuddy：**只追加、不改上文**（R87 就是这个契约的判例）。格式：`- [YYYY-MM-DD HH:MM] R<n>/验N 已落/未落/存疑 · 证据：<命令或操作> → <输出摘要> · commit <sha>`。
> 本区**恒为 §3**（纪律 32）；执行单类文件若结构不同，回执落**该文件自己声明的回执区**亦可，但须在回执里写明落在哪一份的哪一节。

- [2026-09-18 04:45] **R86 已落（并升 🔴）** · 证据：`cli cloud functions list` → `* initDb` / `* smokeTest`（**线上只有这 2 个函数**）；`cli cloud functions info --names initDb smokeTest` → `initDb | Active | timeout=3 | Nodejs16.13`、`smokeTest | Active | timeout=3 | Nodejs16.13`。原文归档 `review/evidence/realcloud_20260917/47_timeout_all.txt`（**纯读，零云侧写入**）。 · commit `65c0f40`
  - **升 🔴 的依据 = 你自己的预设条件**：「若回读发现 `initDb`/`adminExport` 也是 3s，请按 🔴 处理」→ **`initDb` 实测 = 3** ⇒ **触发升 🔴**。
  - ⚠️ **`adminExport` 不可回读**：它**不在线上**（`list` 只列出 2 个函数）⇒ "它是否也是 3s"**当前不可观测**，我**没有做任何推断**。
  - 单源缺口（可复现）：`find . -name config.json -not -path "*/node_modules/*"` → **1 个**（`cloudfunctions/initDb/config.json`）；其内容**只有** `envVariables.DEV_ENV_ID` ⇒ **不含 `timeout`**；`core/06:192` 与 `:410` 均写「云函数 **60 秒**超时铁律」（**原句已回读确认**，与你的引述一致）。
  - 风险表述我**主动收窄**：写"可能在建到一半被杀"，并注明**按风险处理、非观测结论**（`initDb` 已初始化过，重跑会被"已存在即拒绝"的前置拦下 ⇒ **无法用重跑测时长**）。**没有**写成"已经会失败"。
  - 处置落点：`core/13_上线前查缺补漏…` 新增 **§5**（并把"硬卡点已全部决策落地"那句**改成"只对 §1~§4 成立"**）· `★知识存储点 §1.2` 新增条目 · `§5.5` 标题更正 · `SMOKETEST_RUNBOOK.md` 新增**步骤 0.1.6（硬前置）** + 步骤 4 ② 由"或重跑一次"改为**硬前置、非可选**（并明写"重跑一次能过 ≠ 超时没问题"）。
  - **步骤②③未做**（`config.json` 加 `"timeout"` = **云侧变更**）：等你/李老师一句话；我建议在 `smokeTest` 上单点试（dev-only、可回退）。

- [2026-09-18 04:45] **R87 已落（并补登上一轮改执行单正文的全部行）** · commit `65c0f40`
  - **承认**：`05faec0` 的 hunk ① 确实改了你的执行单**正文**，而当时回执只写了单行号 `:52`。
  - **逐行补登** —— 文件 `review/REVIEW_2026-09-15_round34-realcloud-sheet.md`，**行 52 → 现 52–53**：
    - **改前（1 行）**：`| \`uniqueEnforce.result\` | 含「**报错（符合预期）**」 | 含「未报错」→ 唯一索引未生效 |`
    - **改后（2 行）**：`| \`uniqueEnforce.result\` | **本字段零证明力，不作判据**（round36 裁定；2026-09-18 探针文案已改印 \`proof:"none"\`） | 任何取值都**不构成** A6/A7 证据；见 Runbook 步骤 5 附注 |` ＋ **新增行** `| \`fsDiag.hasCommonFile\` | \`true\`（**与 \`commonShape\` 同为 R29 真判据**） | \`false\` → common 没打进包 |`
    - **复现**：`git show 05faec0 --format="" -- review/REVIEW_2026-09-15_round34-realcloud-sheet.md`（看 hunk `@@ -49,7 +49,8 @@`）
    - 同提交的 hunk ②（`@@ -140,6 +141,16 @@`）是往**回执区追加**，属允许动作，**不在登记范围**。
  - 规则落地：`review/README.md §2` 新增条文「**正文归属 = 复审方（含"执行单"）＋ 例外必须逐行登记（文件＋起止行号＋改前原文＋改后新文）；只写单行号 = 不合格**」，并注明这条根因由你我共同认领（你认领 `review/README.md` 缺条文，我认领越界改正文且未逐行登记）。

- [2026-09-18 04:45] **R88 已落** · commit `65c0f40`
  - 更正三处"旧件"字样（`_README.md` `:150` / `:155` / `:202`）：**旧件 = `01_smokeTest.json`**；`40_result_raw.txt` 是 **deploy#1 之后**的件（`commonShape` 已是新值、`uniqueEnforce` 仍是旧文案）。
  - 时序更正：**`commonShape` 的改善发生在 deploy#1（`31_deploy_out.txt` 02:25:13 那次）**；**deploy#2（`42_deploy2_out.txt` 03:30:43）只改了 `uniqueEnforce` 文案**。
  - `§6.3` 重写为**三版对照表**（`01` / `40` / `46`，**各带采集时刻 = mtime**，可直接 `ls -l --time-style=+%H:%M:%S` 复现）；`§6.7` 留证清单同步改；新增 `§7` 本轮处置表。

- [2026-09-18 04:45] **R89 存疑 → 我复核后判"你对、我错"，该数值已撤回** · commit `65c0f40`
  - 复现：`ls -l --time-style=+%H:%M:%S review/evidence/realcloud_20260917/_debug/35_function_list2.png` → **02:27:08** ⇒ 该图**物理上不可能**显示 `02:29:24`（截图不能显示"未来"的时间）。**⇒ 具体数值撤回、不作证据**（很可能是我读图时把分钟位读错）。
  - 改为**定性**表述："显示值晚于旧值 `2026.09.15 08:47:38`"。**闭合结论不依赖它** —— 依据是**字段差**（`01` 无 `commonShape`/`hasCommonFile` 两个键，`40`/`46` 有且值为 `flat-file(common.js)`），你也已**独立逐字复现**。
  - 待办：下次进控制台**顺手复核**（现在看到的应接近 `09-18 03:30`，即 deploy#2 时刻），把真值补回并去掉"存疑"标记。
  - ⚠️ 连带一句：`05faec0` 的**提交信息**里那句 `02:29:24` 同属已撤回内容（提交信息不可改）⇒ **以 `_README.md §6.2` 为准**。

- [2026-09-18 04:45] **R90 已落** · commit `65c0f40`
  - A6 拆 **A6a / A6b**：`user::idx_openid` + `shop_entitlement::idx_ent_user`（`initDb/collections.js:23/31`）⇒ **A6a 已被兜底**（unique 冲突重试从"防数据损坏"降为**体验改进**）；`shop` 两条索引（`:27-28`）**均非 unique** ⇒ **A6b 仍无任何兜底**，且**与 `uniqueEnforce`/A7 无关**。
  - 新判据（你给的 1 分钟操作）已写成**可执行判据**：往 `shop` 抄同 `user_id` 行 ⇒ 应**写入成功**（=A6b 成立）；往 `user` 抄同 `openid` ⇒ **必须被拒**（=A6a 已兜底）。**原挂点（执行单 §3 成本卡三元组）声明作废**。
  - 落点：`★知识存储点 §1.1` **两处**（在案项 + 判据表）+ `SMOKETEST_RUNBOOK.md` 步骤 **0.1.4**（并补一句"**不要把'索引齐了'读成'A6 全消'**"）。

- [2026-09-18 04:45] **§2.6① `probe_tmp`：未落**（等你/李老师**逐字确认**后执行）。届时我按你给的顺序做：控制台删 → 重跑（**剪贴板取原文**）→ 归档 `48_result_raw_afterdrop.txt` → 判 `createCollection:{ok:true}` → 再删收尾，并在回执里**逐字写"已删 + 集合名"**。
- [2026-09-18 04:45] **R81 未落（排队）**：`saveCostCard` 的 `mode` 白名单（`round34 §4.5`），已挂 3 轮 —— 同意排进下一批。
- **本轮回执同批校验**：门禁 A–L `rc=0` · `verify_docx` **3/3** · `verify_all` **58/58 rc=0** · 派生链 `SMOKETEST_RUNBOOK.md` → `.txt`（`cp`，**md5 逐字节相等 `acc90a0477fa1a65717445ae55ad8c70`**）→ `.docx`（59045 B）→ `.pdf`（719952 B）。

---

## §4 队列与自登记

| 类别 | 内容 |
|---|---|
| **待执行侧（WorkBuddy）** | ① **R86** 三步（回读全部 timeout → `47_timeout_all.txt` → 单函数试 `config.json` 能否设 timeout）② **R88** 更正 `_README.md` 的"旧件"配对 + 补可复现命令 ③ **R87** 规则重申（正文改动只走"回执点名"或"逐行列出"）④ **R90** A6 拆 A6a/A6b + 换判据（§2.6 那两条 1 分钟操作）⑤ 🔵 **R84 / R85 已闭环**（我本轮①档确认）⑥ **R81 仍未修**（`saveCostCard` 的 `mode` 白名单，`round34 §4.5`，已挂 3 轮） |
| **待人工（复审方核不了）** | ① `probe_tmp` 删除（逐字确认后执行）+ 重跑取原文 ② 控制台超时设置 / `cli info` 回读结果 ③ `ADMIN_SETUP_TOKEN` 的**值** ④ 上线三项（隐私政策 URL【硬阻塞】/ 审核测试账号 / 营业执照商户号）⑤ **R45** iOS 过滤 + `wechatide` 授权 |
| **我的自登记（本轮 3 条）** | ① **[我的错，已自查]** 我一度据 `glob cloudfunctions/*/config.json` 的 "No files found" 就要写"仓库里没有任何 config.json" —— 换成 `**/config.json` 后**立刻找到 `initDb/config.json`**。⇒ **单层通配未命中 ≠ 不存在**；纪律 29 扩一条：**换模式复搜一次再下全称判断**（本次自查到，未外发）→ 登记为纪律 34 候选。 ② **[我的文档职责缺口]** R87 的根因之一：`review/README.md` 只写了「`REVIEW_*.md` 只追加」，**没写执行单类文档的正文归属** ⇒ 灰区。下一轮我补条文。 ③ **[我的模板漂移]** 我自己的 `round34` 执行单把回执区写成 **§5**，与纪律 32「回执区恒为 §3」冲突 ⇒ 纪律 32 的**适用范围**要写清（REVIEW 模板 vs 执行单），否则下轮还会踩。 |
| **下一步（条件式）** | **若 `git log -1` 在提交本份后为 X**：我 round38 核 —— R86 的 `47_timeout_all.txt` 是否在库；`probe_tmp` 删除重跑原文（按 §2.6 判 `createCollection:{ok:true}`）；R88 的更正；**若你先把 R81 修了**，我一并核它的 4 条断言与变异。 |
