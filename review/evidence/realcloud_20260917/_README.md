# 真云三验 · 验一（`smokeTest` 探针）· 执行证据

> 执行：2026-09-18 01:2x +0800 · 执行人：WorkBuddy（键鼠代点，李老师在场）· 环境：云开发控制台 v2.0.3 (2.0.34@707916636)
> 执行单：`review/REVIEW_2026-09-15_round34-realcloud-sheet.md` §2
> 判读口径：**逐字提取**自返回 JSON 原文（`01_smokeTest.json` / `_clip_raw.txt`），不采信截图转述。

---

## 0 · 环境门禁（跑之前先确认，控制台手点是不受 `!/prod/` 代码门禁约束的）

| 项 | 实测 | 判定 |
|---|---|---|
| 下拉列表里的环境数 | **1 个**（`我的环境（餐饮店算）`） | ✅ **不存在 prod 环境** |
| 环境别名 / 标签 | `cloud1` / **免费开发环境** | ✅ 与 dev 环境 ID 前缀一致 |
| 环境 ID（下拉第 2 行） | **`cloud1-d4gphpoxy337f2a25`** | ✅ 与单源 `cloudfunctions/initDb/config.json::DEV_ENV_ID` **逐字符一致** |
| 返回 JSON 里的 `env` | `cloud1-d4gphpoxy337f2a25` | ✅ 服务端自报同一个值 |

留证：`00_console_now.png`（控制台现场）、`02_env_dropdown_win.png` + `02b_env_list_放大.png`（下拉列表 2× 放大，肉眼可读）。

> ⚠️ 教训：第一次想点环境下拉时按"窗口显示宽度"估算坐标，点到了标题栏空白处（**截图 md5 未变**才发现的）。
> 参见 `skills/win-desktop-control` 的 P9 类坑：**坐标必须由 OCR / 像素实测给出，不能目测带宽换算**。

---

## 1 · 关键新发现（两条，都改变了执行单的假设）

### 🔴 发现 A：`smokeTest` **首次（冷启动）必撞 3 秒超时**

| 次数 | 入参 | 结果 | 运行时间 |
|---|---|---|---|
| 第 1 次（冷启动） | `{}` | **`{"errorCode":-1,"errorMessage":"Invoking task timed out after 3 seconds","requestId":"b17b75c6-…","statusCode":433}`** | 3000 ms |
| 第 2 次（热启动） | `{}` | ✅ 正常返回完整 JSON | **724 ms**（`Coldstart: 561ms` 属首次） |

- 控件上「测试结果：成功」是**调用成功**，与函数是否跑完无关；判读要看 `返回结果` 里的 `errorCode`。
- 留证：`08b_after_run_14s.png` / `08d_resultband.png`（超时原文）、`09b_rerun_result.png` / `09c_rerun_band.png`（重跑成功）。
- ⇒ **`SMOKETEST_RUNBOOK.md` §「右键 smokeTest → 测试 → 入参 {} → 运行」缺一条硬前置**：函数默认超时 3s，冷启动（561ms）+ 全量探针（约 10 次串行 DB 往返）会超；**必须先把超时调到 ≥10s，或直接重跑一次（热启动 724ms 稳过）**。
- 这一条正是"**没实测过的路径写进文档 = 下次必踩**"的又一例（同族 R82/R84）。

### 🔴 发现 B：**线上部署件落后于仓库** —— `fsDiag` 缺 `hasCommonFile` / `commonShape`

- 线上 `fsDiag` 键集 = `{root, hasCommonDir, common, cwd}`（**4 个**）。
- 仓库 `cloudfunctions/smokeTest/index.js` 的 `fsDiag` 键集 = `{root, hasCommonFile, hasCommonDir, common, commonShape, cwd}`（**6 个**）。
- 时间线（`git log` 实测）：两字段由 `2a46b09`（2026-09-16 02:41）加入；而控制台显示 `smokeTest` **最后更新时间 = 2026-09-15 08:47:38** ⇒ **部署件早于仓库 1 天**。
- 后果：执行单 §2 判据「`fsDiag.commonShape` = `flat-file(common.js)`」**在当前部署件上读不到这个字段** —— 判据本身没法执行。
  - 该事实**仍可用旁证成立**：`root` 数组里**有 `common.js`、没有 `common` 目录**，`hasCommonDir:false` ⇒ 扁平形态成立（R29 结论未被推翻，只是探针没把结论字段带上去）。
- ⇒ 需 `cli cloud functions deploy` 重发 `smokeTest` 后重跑，才能让执行单那条判据**可执行**。

---

## 2 · 逐字段判读（对照执行单 §2 期望表）

| 字段 | 执行单期望 | 实测（原文） | 判定 |
|---|---|---|---|
| `env` | 非空 = `cloud1-d4gphpoxy337f2a25` | `cloud1-d4gphpoxy337f2a25` | ✅ |
| `requireCommon.ok` | `true` | `true` | ✅ |
| `requireCommon.exports` | 含 `assertShopOwner` 等 | 13 个：`errors, ERROR_CODES, ok, fail, utilTime, money, dataAdapter, auth, resolveAuth, assertShopOwner, idempotency, rateLimit, audit` | ✅ **R29 扁平化修法在真云成立**（`require('./common')` 可解析） |
| **`docGet.hasDataField`** | **`true`** | **`true`**（`topLevelKeys:["data","errMsg"]`，`dataKeys:["_id","k","is_deleted","created_at"]`） | ✅ **A1/A2 修法在真云成立，不回退**（最关键翻案点） |
| `docGetMissing.behavior` | `resolve` 或 `reject` 均算契约明确 | `reject`（`document.get:fail … does not exist`） | ✅ 契约明确（A1 的 try/catch **确有必要**） |
| `createIndex.typeof` / `.call` | `function` / `OK`（A7 已定案不支持，此处只复核） | `typeof: "undefined"`（`call` 字段不存在 ⇒ 未进入调用分支） | ✅ **复现 A7 结论**（SDK 无 `createIndex`，与 `index.js`/`index.d.ts` 静态零命中一致） |
| `uniqueEnforce.result` | 含「报错（符合预期）」 | 含「**未报错**」 | ⚠️ **不作判据** —— 见下 §3 |
| `assertShopOwner` | `RESOURCE_NOT_FOUND` | `{code:"RESOURCE_NOT_FOUND", msg:"RESOURCE_NOT_FOUND", data:{}}` | ✅ A1 落点在真云成立（未抛异常、非恒 `FORBIDDEN`） |
| `createCollection` | `{ok:true}` 或 `ok:false` 且 msg 含「已存在」 | `ok:false`，msg 含 `[ResourceUnavailable.ResourceExist] Table exist` / `DATABASE_COLLECTION_ALREADY_EXIST` | ✅ 属预期（`probe_tmp` 是**前次运行遗留**，非本次新建） |
| `dataAdapterGet` | `liveIsDoc:true` **且** `deadIsNull:true` | `liveIsDoc:true` / `deadIsNull:true` | ✅ **A2 在真云成立，不回退** |
| `fsDiag.commonShape` | `flat-file(common.js)` | **字段不存在**（见 §1 发现 B） | ⛔ **不可判读**（部署件陈旧） |

**净结论**：**10 条可判读判据 → 9 ✅ + 1 ⚠️（零证明力，见 §3）+ 1 ⛔（部署件陈旧，字段缺失）**。
**A1 / A2 / A7 / R29 四条先前的静态结论全部在真云上得到正面确认，无一条需要回退。**

---

## 3 · `uniqueEnforce` 为什么不算数（round36 用户裁定，此处只是执行）

- 原文：`"uniqueEnforce":{"result":"未报错 → unique 索引可能未生效（A7 判定为「索引不可用」）"}`。
- 机制事实：`createIndex` 在真 SDK 是 `undefined` ⇒ **`idx_probe_k` 这条唯一索引从来没在 `probe_tmp` 上被创建过** ⇒ 插两条同 `k` **当然不报错**。
- ⇒ 这个字段报什么都不构成"唯一索引是否生效"的证据，**零证明力**。
- ⇒ **不得据此升级 A6（唯一约束可用）、也不得据此回退任何东西**。
- 真云唯一索引是否**生效**这件事，只能靠**已建成索引的集合**去验（见执行单 §3 的「手工复制三元组应被拒」），**不能靠本探针**。

---

## 4 · 留证清单（全部在本目录）

| 文件 | 内容 |
|---|---|
| `01_smokeTest.json` | 结构化证据：返回 JSON 解析结果 + 调用指标（`duration_ms:724` / `coldstart_ms:561`） |
| `_clip_raw.txt` | **剪贴板原文**（3204 字符）：含入参 `{}`、返回 JSON、请求 ID、摘要、`Init/START/Event/Response/END/Report` 全段日志 |
| `00_console_now.png` | 跑之前控制台现场（数据库页） |
| `02_env_dropdown_win.png` / `02b_env_list_放大.png` | **环境门禁证据**（列表只有 1 个环境、ID 逐字符可读） |
| `04_function_list.png` | 云函数列表（只有 `smokeTest` / `initDb`，均"已部署"；含最后更新时间 = 判"部署件陈旧"的原始出处） |
| `05_cloudtest_page.png` | 云端测试面板（入参编辑器 + 运行测试按钮） |
| `07d_after_paste.png` | 入参已改为 `{}`（粘贴后回读确认，不在界面 OCR 上赌） |
| `08b_after_run_14s.png` / `08d_resultband.png` | **发现 A 证据**：冷启动 3s 超时原文 |
| `09b_rerun_result.png` / `09c_rerun_band.png` | 热启动重跑成功的返回结果 |
| `11_db_page.png` / `12_db_page2.png` | 数据库集合列表（可见 `probe_tmp` 存在，供清理项对照） |
| `scripts/cdb.py` | 键鼠驱动公共层（窗口原点换算 / 点击生效性校验 md5 / 截图） |
| `scripts/parse_result.py` | 剪贴板原文 → 结构化证据（JSON 解析失败即抛，fail-closed） |

### 方法要点（下次复用）
1. **文字一律走剪贴板回读，不 OCR**：OCR 对这段 JSON 出现 `-501001`→`一501991`、整行丢失等**稳定误读**，无法作原文证据。
2. **复制返回结果 = 点进文本框 → `Ctrl+A` → `Ctrl+C`**（实测拿到 3204 字符全文）；**那个"复制图标"点不动**（4 次不同坐标均无效），别再在图标上耗。
3. **每次点击后比 md5**：`verify_click` 用「点前/点后截图 md5 是否变化」判定点击是否真的生效 —— 否则会把"没点中"读成"界面没反应"。
4. 坐标由 **OCR 给中心点**（如 `云端测试` → png(1477.9, 387.6)），**屏幕坐标 = png + 窗口原点 (60,0)**（`rect()` 每次现取，不缓存）。

---

## 5 · 清理状态（未完成，故意留着）

| 项 | 状态 | 理由 |
|---|---|---|
| `probe_tmp` 集合 | **仍存在**（`12_db_page2.png` 可见） | 若按 §1 发现 B 重发 `smokeTest` 后重跑，探针会**再次用到**它 ⇒ 等重跑完再删，避免删两遍 |
| `smokeTest` 函数 | 保留 | 同上（重跑还要它） |

> 删除动作（控制台手删 `probe_tmp`）**属不可逆的云侧操作**，且在本人"逐字确认"清单内 ⇒ **未自行执行**，待李老师一句话。


---

## 6 · 重发与重跑（2026-09-18 03:2x）—— 发现 B 闭合 + 修掉探针自印的旧结论

> 承接 §1 发现 B：必须重发部署件后重跑，才能闭合 `fsDiag.commonShape` 判据。本节记录闭合过程与结果。

### 6.1 通道路径：用**微信开发者工具自带 CLI**，不要用腾讯云 `tcb`

| 通道 | 命令 | 结论 |
|---|---|---|
| 腾讯云 `@cloudbase/cli`（`tcb`） | `tcb login` → device-flow | ❌ **未采用**：需人工在浏览器点授权（授权页在本机**渲染空白**，见 `22b_cliauth_reload.png`），且授权后是**主账号级凭据落到本机 `~/.cloudbase/`** ⇒ 与最小权限纪律冲突 |
| **微信开发者工具自带 CLI** | `cli cloud functions deploy --project <repo> --env <envId> --names smokeTest -r` | ✅ **采用**：`cli islogin` → `{"login":true}`（**复用 IDE 已登录会话**），零新凭据、零授权页 |

- IDE server 由 CLI 自行拉起：`√ IDE server has started, listening on http://127.0.0.1:35237`。
- `--env` 的值**不写死**：从单源 `cloudfunctions/initDb/config.json` 的 `envVariables.DEV_ENV_ID` 现读（避免第四份副本）。
- `-r` = 云端安装依赖（`wx-server-sdk`）；旁证 = 重跑后 `fsDiag.root` 里出现 **`node_modules`**。

### 6.2 变更前后对照（部署两次，均 `success=true` / 12 文件）

| 次序 | 结果 | 说明 |
|---|---|---|
| ① | `filesCount=12 packSize=14.0 KB`（19.4s） | 让线上 = 仓库（此时仓库尚未改探针文案） |
| ② | `filesCount=12 packSize=14.5 KB`（18.5s） | 含 §6.4 的探针文案修正（包体变大 = 内容确实变了） |

**发现 B 闭合的证据链**：
- `30_info_before.txt`：部署前 `cli cloud functions info` → `smokeTest | Active | timeout=3 | Nodejs16.13`（**这就是发现 A 的配置层证据**）
- `32_info_after.txt`：`info` 字段不含更新时间 ⇒ **单靠它证不了"已更新"**，故另取控制台函数列表的「最后更新时间」：`35_function_list2.png` = **`2026.09.18 02:29:24`**（旧值 `2026.09.15 08:47:38`）⇒ 部署件**不再落后于仓库**。
- 重跑返回（`46_result_raw_fixed.txt`）的 `fsDiag` 已含 **`hasCommonFile:true`** + **`commonShape:"flat-file(common.js)"`** —— 旧件这两个键**根本不存在** ⇒ **判据闭合**。

### 6.3 「同一判据两版输出」对照（可证伪）

| 字段 | 旧（09-15 部署件） | 新（09-18 重发） |
|---|---|---|
| `uniqueEnforce` | `{"result":"未报错 → unique 索引可能未生效（A7 判定为「索引不可用」）"}` | `{"result":"未报错（预期内）","proof":"none","note":"本集合无该 unique 索引 ⇒ 不报错是必然；不得据此判定 A6/A7"}` |
| `fsDiag.commonShape` | **键不存在** | `flat-file(common.js)` |
| `env` / `requireCommon` / `createIndex` / `docGetMissing` / `assertShopOwner` / `dataAdapterGet` | — | **逐字 SAME** |
| `fsDiag.root` | 13 项 | **13 项全等**（含 `node_modules`） |
| `docGet` | — | 仅 `_id` 不同（每次新插文档，**预期内**） |

> 判读口径：两份原文都在本目录（`40_result_raw.txt` = 旧件、`46_result_raw_fixed.txt` = 新件），逐字段用 Python 比对，**不靠肉眼**。

### 6.4 🔴 本轮新发现 C：**探针把已作废的判据当结论印出来**

- 旧文案 `"未报错 → unique 索引可能未生效（A7 判定为「索引不可用」）"` 与 round36 裁定**直接冲突** —— 该字段零证明力，而它却以"结论"口吻印在探针输出里（**上一轮判读就是被它带偏的**）。
- 已改 `cloudfunctions/smokeTest/index.js` 三处：输出改带 `proof:"none"` + `note`；报错分支 `proof:"partial"`；文件头注明"**本探针不答 A6**"。
- 并同步四处文档：`SMOKETEST_RUNBOOK.md` 的 `:14`/`:21`/`:22`、重启键 `:89`/`:92`/`:107`、执行单 `:52`。
- 教训入册：**探针输出是最上游的事实源**，它印错结论 = 又一个误导源；"改了文档却没改产结论的代码"是同族漂移。

### 6.5 🟡 A6 待重判（本轮不自行改结论）

| 项 | 内容 |
|---|---|
| 原结论 | A6「首建档非原子」→ **升级为「可能重复账号」** |
| 原唯一依据 | 探针 `uniqueEnforce` 报「未报错」 |
| 该依据现状 | **已作废**（零证明力） |
| 另一前提现状 | 线上 **40 条索引（含 10 unique）已于 2026-09-17 建成** ⇒ 「无唯一约束」不再成立 |
| 处置 | unique 冲突重试**保留为防御性措施**；是否仍属**必需**，**待执行单 §3「在真集合手工插入重复三元组被拒」验证后再定** |

### 6.6 守卫侧顺带处置（R85 短语表防腐）

- `check_stale_claims.js` 的 S4 报 WARN：短语 `不支持代码建索引` 在活文档 **0 命中**（该说法已被清除）。
- 处置：**不删条目**（删了就丢掉防回潮能力），改加 `REVIVAL_WATCH` 名单，显式登记"0 命中属设计内"。
- **变异回灌 5/5**（`review/evidence/guard_replays/replay_r85.py`，本轮新增 M5）：把"本平台不支持代码建索引"塞回活文档 ⇒ **转红**（证明 0 命中的条目**仍有鉴别力**）；恢复后 md5 逐字节一致。
- 该守卫通过数 2 → **3**；`verify_all` 仍 **58/58 rc=0**。

### 6.7 本轮新增留证

| 文件 | 内容 |
|---|---|
| `30_info_before.txt` / `32_info_after.txt` | 部署前后 `cli cloud functions info`（含 **`timeout=3`**） |
| `31_deploy_out.txt` / `42_deploy2_out.txt` | 两次部署的完整 stdout/stderr |
| `40_result_raw.txt` | **旧件**重跑原文（未修文案前，含旧 `uniqueEnforce`） |
| `46_result_raw_fixed.txt` | **新件**重跑原文（文案修正后，`proof:"none"`） |
| `35_function_list2.png` | 云函数列表（**最后更新时间 = 2026.09.18 02:29:24**，判"部署件已更新"的原始出处） |
| `22b_cliauth_reload.png` | 腾讯云 `tcb` device-flow 授权页在本机**渲染空白**（说明为何不走该通道） |
| `44_run1.png` / `45_run2.png` | 本轮重跑（两次均成功；**本次未复现冷启动超时** —— 函数刚部署是热态，与发现 A 不矛盾） |

> `_debug/`（21 张过程截图）只是过程留痕，**判定链不依赖它**；移出主清单是为了让"该看哪几张"一眼可辨。

### 6.8 清理状态更新（§5 的延续）

| 项 | 状态 | 理由 |
|---|---|---|
| `probe_tmp` 集合 | **仍存在** | 执行单 §3「手工重复三元组」还要用它；**手删属不可逆云侧操作，等李老师逐字确认** |
| `smokeTest` 函数 | 保留 | 同上 |
| `~` 下的 `tcb` 凭据 | **不存在**（未走该通道） | `tcb login` 已自行超时退出，未产生 `~/.cloudbase/` |
