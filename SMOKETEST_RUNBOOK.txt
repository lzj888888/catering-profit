# 店算 · 云端探针部署 Runbook（批次 1 前置）

> ⚠️ 本文档为**派生件**：同名 `.txt` / `.docx` / `.pdf` 均由本 `.md` 生成，**冲突一律以 `.md` 为准**（勿手改派生件）。

> 用途：在真 wx-server-sdk / 真云数据库上一次性答完 4 个本地从没验证过的前提（A6 / A7 / require('./common') / doc().get() 契约）。
> 跑完这个再投喂批次 1，比「先投喂、后建环境」省一个来回。

> 🔬 **2026-09-14 晚实测已答一项（A7）**：在 dev 环境 `cloud1` 上真跑 `initDb`，39 条索引**全部**报 `db.collection(...).createIndex is not a function` ——
> 即 wx-server-sdk **压根不存在这个方法**（不是"调用失败"，是"没有这个接口"）。
> ⇒ **A7 = 不支持，且坐实为 SDK 层面缺失**（非偶发）→ **SDK 里建不了索引**；
> ⚠️ 但**「只能靠人在控制台一条条填」这半句已于 2026-09-17 证伪**：SDK 无方法 ≠ 平台无接口 ——
> 官方 HTTP API `POST /tcb/updateindex` 可脚本化（见 `tools/apply_indexes.js`，需 AppSecret），
> 无密钥时亦可 GUI 键鼠全量建（已实证 40/40）。⇒ 索引**不是只能手填**，只是**不能用 wx-server-sdk 建**。
> ⚠️ **2026-09-18 更正**：原写「A6 相应升级为『可能重复账号』」—— 该升级的**唯一依据**（探针 `uniqueEnforce` 的「未报错」）经复核裁定为**零证明力**（`idx_probe_k` 在 `probe_tmp` 上从未建成，不报错是**必然**）；且线上 **40 条索引（含 10 条 unique）已于 2026-09-17 全部建成** ⇒ 「无唯一约束」这一升级前提**不再成立**。首建档的 unique 冲突重试**保留为防御性措施**；它是否仍属**必需**，待执行单 §3「在真集合手工插入重复三元组被拒」验证后再定。
> ✅ **2026-09-15：四项前提全部答完（smokeTest 探针 v3 真云端实跑）**，见下表。**批次 1 前置全部解除。**

### 🏁 四前提终局结论（2026-09-15 云端实测，真 wx-server-sdk）

| 前提 | 结论 | 云端实测证据 | 对后续代码的影响 |
|---|---|---|---|
| **A7**（`createIndex` 是否可用） | ❌ **不支持** | `createIndex.typeof = "undefined"`（旧附证「插入重复值**未报错**」**已作废**，见步骤 5 附注） | **SDK 建不了索引** ⇒ `initDb` 的 39 条索引属预期内失败（39 = 2026-09-14 历史快照，勿改）；**但可用官方 HTTP API 脚本化建**（见 `tools/apply_indexes.js`） |
| **A6**（首建档是否原子） | ⚠️ **依据已作废、待重判**（2026-09-18 更正，详见下行） | ~~探针 `uniqueEnforce`「未报错」~~ → 该字段**零证明力**；线上 40 条索引（含 10 unique）**已于 2026-09-17 建成** | unique 冲突重试**保留为防御性措施**；是否仍属**必需**，待执行单 §3「手工重复三元组被拒」验证后再定 |
| **`require('./common')`** | ✅ **可行，但必须扁平化** | 子目录方案 `MODULE_NOT_FOUND`（云端 `fsDiag.hasCommonDir=false`，子目录被拼成 `common\xxx.js` 扁平怪名）；改 `common.js` + `cx_*.js` 后 `ok:true`，13 项导出齐 | **云函数包内禁用子目录**；改 common 单源后必跑 `node tools/sync_common.js` |
| **`doc().get()` 契约** | ✅ **成立（A1/A2 未修反）** | `topLevelKeys=["data","errMsg"]`、`hasDataField=true`；文档不存在时 **`behavior:"reject"`** | 取值**必须取 `.data`**；读取**必须 try/catch**（不存在会抛，不是返回 null） |
| A1 落点（`assertShopOwner`） | ✅ 正确 | 不存在的店铺返回 `{code:"RESOURCE_NOT_FOUND"}`，**非抛异常、非恒 FORBIDDEN** | A1 修法确认无误 |
| A2 落点（`dataAdapter.get`） | ✅ 正确 | `liveIsDoc:true`（未删返回文档）、`deadIsNull:true`（软删返回 null） | A2 修法确认无误 |

> 配套代码已落盘：`cloudfunctions/smokeTest/`（index.js + package.json + 同步派生的 `common.js` + `cx_*.js`）。本 Runbook 是给你在控制台照做的纸质流程。
> ⚠️ **本文件是【唯一 Runbook】**。若见 `SMOKEST_RUNBOOK.*`（漏 `ET` 的手误副本）属历史残留，已删除，请勿再使用。
> 本文件是【**权威操作流程**】。`新手上云操作手册.md` 是同一流程的**小白友好版**（面向没用过开发者工具的人）；
> 两者若冲突，**以本文件为准**。

---

## 一、一句话结论与顺序

- **不要从头重跑本地套件**：HEAD 以 `git log --oneline -1` 为准（本 Runbook 不复制 commit —— 同一事实写两遍必然过期），同一棵树跑同一批套件只会得到同一结果（仪式不是验证）。本地层鉴别力已逐项用变异证明过。
- **唯一该跑的是云端探针**：它一次答完 4 个前提，其中 `doc().get()` 返回形状有翻案能力（决定 A1/A2 是否修反）。
- **建议顺序：先做①建环境，后③投喂**（①未知量最大；「hello 能否 require('./common')」实测会反哺后面所有函数代码放置，虽写法已定为 require('./common')，但机制是否成立要云端实测）。①③ 互不阻塞，可并行。

| # | 事 | 为什么只有你能做 |
|---|---|---|
| ① | 云环境：dev = 现有免费环境 `cloud1`（ID `cloud1-d4gphpoxy337f2a25`，走 `DEV_ENV_ID` 白名单放行）；prod 待建（上线前）→ 部署 initDb 到 dev → 控制台核对 25 集合 + 索引清单 | 需你的微信账号与云开发控制台；三悬案已于 2026-09-14~09-15 云端实测答完（见本文件「四前提终局结论」，第 11 行起） |
| ② | `config/env.js` 的 **dev 槽已填**（`cloud1-d4gphpoxy337f2a25`），仅 **prod 槽**待建环境后替换 | 建完 prod 环境才有真值（判据④ dev 侧已闭环） |
| ③ | 投喂批次 1（从 `specs/dev-specs/delivery/` 取 .md / 8 个 .txt / .html，勿用 Desktop 副本） | 从仓库权威源取，避免派生件落后 |

---

## 二、详细操作步骤

### 步骤 0 · 准备
- 确认你有微信公众平台 / 小程序账号，且已开通**云开发**（微信开发者工具 → 云开发按钮）。
- 本地 `cloudfunctions/smokeTest/` 已就绪（**扁平副本** `common.js` + `cx_*.js`，无子目录，由 `node tools/sync_common.js` 生成）。

### 步骤 0.1 · 投喂前硬前置与阻塞清单（缺一项就别开跑）

0.1.1 【硬前置】真实 AppID —— 没有它云开发根本不可用
- 现状：`project.config.json` 的 `appid` **已是真值** `wx33c110dc57a9c8dc`（`project.config.json:3`）；若哪天它退回 `touristappid` 才需要替换。
- 必须：去微信公众平台注册/登录小程序，取得**真实 AppID**，替换该字段，并用该 AppID 在开发者工具打开本项目。
- 判据：`appid` 不等于 `touristappid`，且「云开发」面板可正常打开。

0.1.2 25 张集合权限 = 仅管理端可读写（`core/15_集合权限矩阵` 口径）
- 位置：云开发控制台 → 数据库 → 逐张集合 → 权限设置 → 选「仅管理端可读写」。
- 为什么：控制台默认是「仅创建者可读写」，**不是本项目口径**；本项目前端不直连数据库（一律走云函数），对客户端全关最安全。
- 工作量：25 张逐张设置，建议一次做完。判据：25 张全部为「仅管理端可读写」。

0.1.3 【待定·开跑前先决定】seedDemo 来源未定
- 现状：仓库内**没有** `cloudfunctions/seedDemo/`（批次 0 只生成 `initDb`）。
- 三选一：(a) 手工把 `specs/dev-specs/prototype/seed_demo.js` 包成云函数目录（+`package.json`，依赖 wx-server-sdk）；
  (b) 由某个批次生成；(c) 批次 0 阶段先不灌演示数据（不影响建库与投喂）。
- ⚠️ 无论哪种：**严禁部署到 prod**（会写 demo 数据 + 永久权益进真实业务库）。

0.1.4 索引清单核对（答悬案 A7）—— 这是步骤 2 最重要的一步
- 位置：云开发控制台 → 数据库 → 逐张集合 → 索引。
- 核对 `cloudfunctions/initDb/collections.js` 声明的 **10 个 unique 索引**是否真的建上：
  `user.openid` / `user.user_id` / `shop_entitlement.user_id` / `shop_monthly_account.(shop_id,month)` /
  `shop_inventory.(shop_id,month)` / `shop_cost_card.card_code` / `shop_switch.(shop_id,switch_key)` /
  `admin_user.username` / `shop_payment_flow.order_no` / `order_refund.order_id`
- 判读（A7 已于 2026-09-14 定案 = **不支持**）：**本条已闭环** —— 线上 **40/40 条索引（含这 10 条 unique）已于 2026-09-17 全部建成**。
  ⇒ **A6a（重复账号）已有兜底**（`user::idx_openid` + `shop_entitlement::idx_ent_user`）。
  ⚠️ **但不要把"索引齐了"读成"A6 全消"**：**A6b（同一 user 建出重复 shop）仍无任何兜底** —— `shop` 的两条索引**都不是 unique**（R90，2026-09-18 更正）。
  未建成时的补建首选 `tools/apply_indexes.js`；A6a 与 A6b 的分工与判据见 `★知识存储点 §1.1` A6 行。
  ⚠️ 本 Runbook 顶部已定案 `createIndex` 不可用 ⇒ 此处**不得**再出现「索引全在 → A7=支持」这类推断（旧分支已废）。

0.1.5 外部上线阻塞（不挡写码/投喂/建环境，但别误以为「能跑=能上线」）
营业执照 → 微信支付商户号 → 隐私政策正文+URL → 小程序类目(工具>记账) → 审核测试账号。
现状：`enable_real_payment=false`，走私域手动发权益；运营流程（谁发/怎么发/怎么对账）尚无文档 → 待补。

0.1.6 🔴【硬前置】云函数 `timeout` —— 不先改它，**`initDb` 有"建到一半"的风险**（R86，2026-09-18 实测）
- 实测：线上 dev **只部署了 2 个函数**（`initDb` / `smokeTest`），**两个都是 `timeout=3`**（平台默认值；证据 `review/evidence/realcloud_20260917/47_timeout_all.txt`）。
- 为什么是阻塞：`initDb` 要建 **25 集合 + 40 索引 + 种子**，3 秒内跑不完 ⇒ 可能**建到一半被杀**，留下"部分建库"现场。
  ⚠️ 这是**按风险处理**：`initDb` 已初始化过，"已存在即拒绝"的前置会把重跑拦下 ⇒ **无法用重跑测时长**，所以**不得**写成"已经会失败"。
- **怎么改（路径已定，2026-09-18 05:2x 实测）**：只能去**控制台**改 —— **云函数 → `smokeTest` → 版本管理 →「配置」→ 高级配置 → 执行超时（±秒）→ 确定**（取值范围 **1–300 秒**）。
  ① **定值**：`smokeTest` ≥10s；`initDb` ≥20s（建议）；导出类（`adminExport`/`exportData`）对齐 `core/06:410` 的 **60s 铁律**。  ② 改完**回读复核**。  ③ 把最终值补回 `core/13_上线前查缺补漏…§5`。
- ❌ **别试 `config.json`（已证伪，2026-09-18）**：给 `cloudfunctions/smokeTest/config.json` 加 `{"timeout":20}` 后重发，
  文件确实**随包上传**（`fsDiag.root` 出现 `config.json`）、部署确实**生效**（「最后更新时间」`03:34:55 → 05:24:52`），
  **但 `cli cloud functions info` 与「高级配置 → 执行超时」两处读到的都仍是 3 秒** ⇒ **该字段不被采纳**。实验文件已删除还原。证据：`review/evidence/realcloud_20260917/47_timeout_all.txt §F`。
- 判据：`cli cloud functions info` 的 **`timeout` 列**（界面「测试结果：成功」只表示**调用**成功，与函数是否跑完无关）。

### 步骤 1 · 云环境（dev / prod）
- 微信开发者工具打开本小程序项目 → 顶部「云开发」→「环境」→「新建环境」。
- **推荐做法**：环境名称含 `dev` / `prod` 字样（门禁 H 组判据：`!/prod/` 恒效、`dev` 白名单放行）。
- **例外（本项目已采用）**：微信侧默认**免费环境**（名如 `cloud1`，**不含 dev 字样**）**也可以当 dev 用**——环境门禁留有 `DEV_ENV_ID` **精确白名单**分支（见 `cloudfunctions/initDb/collections.js` 的 `gate()`）：把该环境 ID 填进 `cloudfunctions/initDb/config.json` 的 `DEV_ENV_ID` 即被放行。
- **本项目当前状态（2026-09-14 定）**：
  - dev = 微信侧免费环境 `cloud1`，环境 ID **`cloud1-d4gphpoxy337f2a25`**；`initDb/config.json` 已配好 `DEV_ENV_ID`。
  - prod **暂未建**——写码阶段用不到，等上线前再建一个名含 `prod` 的环境即可。
- ⚠️ 每个账号可免费建 **2 个**环境（当前已用 1 个，剩 1 个）；且官方规则为「环境注销需**超过 1 个月**才能再免费创建」→ **绝不要删掉 cloud1**，否则可能 1 个月内建不了新环境。
- 在 dev 环境开通数据库（默认已有，确认「数据库」标签页可见）。

### 步骤 2 · 部署 initDb（核对 25 集合）
- 右键 `cloudfunctions/initDb` → 「上传并部署：云端安装依赖」。
- 上传完成后 → 右键 initDb →「测试」→ 入参 `{}`（或触发 `initDb` 的 `main`）→ 运行。
- 预期：`created.length === 25` 且 `blocked === undefined`（dev 门禁放行）。
- 去「数据库」标签页核对：**集合数 = 25**（若不是 25，截图给我，可能涉及 A6 严重度）。
- 索引清单：门禁 A7 关注 10 个 unique 索引；initDb 是否建索引由代码决定，本探针第②条专门验 createIndex 能力。

### 步骤 3 · 部署 smokeTest（含 common **扁平**副本）
- 推荐命令行部署（服务端口已开）：
  ```bat
  "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions deploy ^
    --env cloud1-d4gphpoxy337f2a25 --names smokeTest ^
    --project "C:\Users\lzj\WorkBuddy\Claw\catering-profit" --remote-npm-install
  ```
  或右键 `cloudfunctions/smokeTest` →「上传并部署：云端安装依赖」。
- 🔴 **副本必须是扁平的**（`common.js` + `cx_*.js`），**不能是 `common/` 子目录**——2026-09-15 云端实测：子目录会被 Windows 打包拼成 `common\xxx.js` 这种带反斜杠的扁平文件名，Linux 云端不认它是目录 → `MODULE_NOT_FOUND`。
  ⇒ 上传前跑 `node tools/sync_common.js`（它已改为扁平派生）；若用旧版脚本生成了 `common/` 子目录，须先删掉再同步。
- 若上传后控制台报「找不到模块 ./common」→ **机制失效信号**（见结果判读 ①）。

### 步骤 4 · 控制台触发 smokeTest，取 JSON

**① 先看「最后更新时间」够不够新**（2026-09-18 踩过）：云函数列表的「最后更新时间」若**早于** `cloudfunctions/smokeTest/index.js` 的最后一次提交 ⇒ 就是**部署件落后于仓库**，跑出来的字段会缺（实测缺 `hasCommonFile`/`commonShape`）⇒ 先重发一次再跑。

**② 🔴 先把超时调大 —— 这是硬前置，不是可选项（R86）**：**线上实测 `timeout=3` 秒**（= 平台默认值，本仓**没有任何单源钉住它**；证据 `review/evidence/realcloud_20260917/47_timeout_all.txt`），而本探针是 ~10 次串行 DB 往返，**冷启动（实测 561ms）叠加后必撞超时**：
```
第 1 次（冷启动）：{"errorCode":-1,"errorMessage":"Invoking task timed out after 3 seconds","statusCode":433}  → 3000 ms
第 2 次（热启动）：正常返回完整 JSON                                                                          →  524~724 ms
```
- ⚠️ 界面上「**测试结果：成功**」指的是**调用**成功，**与函数是否跑完无关** —— 判读一定要看 `返回结果` 里的 `errorCode`，别看到绿色就以为过了。
- ✅ **正确做法**：云函数 → `smokeTest` → **版本管理 →「配置」→ 高级配置 → 执行超时**，调到 **≥10 秒**；改完用 `cli cloud functions info` 的 **`timeout` 列回读确认**（这是唯一能证明"已生效"的判据）。
  ⚠️ **别用 `config.json` 设 `timeout`** —— 2026-09-18 实测该字段**不被采纳**（重发后两处读到的都仍是 3 秒），详见步骤 **0.1.6**。
- ⏳ **临时绕法**（仅在确实不动配置时用，且**回执里必须写明"这是绕过的"**）：直接**再点一次「运行测试」**，热启动 524~724ms 稳过。
  ⚠️ **"重跑一次能过" ≠ "超时没问题"**：它只证明**这次**是热态。`initDb`（要建 25 集合 + 40 索引 + 种子）**没有"重跑一次"这条退路** ⇒ 详见 **步骤 0.1.6（R86）**。

**③ 触发**：云函数 → `smokeTest` → 右侧「云端测试」→ 入参编辑器清空后填 **`{}`** →「运行测试」。
> 入参编辑器是代码框：先点进框内，`Ctrl+A` → `Delete` → 粘贴 `{}`。⚠️ 若框里出现「查找」小面板，说明焦点跑到查找框了，按 `Esc` 关掉再重来。

**④ 取原文（别 OCR）**：点进「返回结果」文本框 → `Ctrl+A` → `Ctrl+C` → 贴回本窗口。
> 🔴 「返回结果」标题旁那个**复制图标点不动**（2026-09-18 换 4 个坐标实测均无效）；`Ctrl+A`+`Ctrl+C` 实测可取到**全文**（3204 字符，含入参/返回/请求 ID/摘要/`Init…Report` 全段日志）。
> 🔴 **绝不要用 OCR 读这段 JSON**：实测 `-501001` 被读成 `一501991`、还整行丢 —— 只能当"看一眼"，**不能当原文证据**。

### 步骤 5 · 结果判读（逐字段 → 结论）
| 返回字段 | 期望 | 若为否则 → 行动 |
|---|---|---|
| `env` | 非空、等于你的 dev 环境 ID（咱们是 `cloud1-d4gphpoxy337f2a25`；**不含 `dev` 字样属正常**，因走 `DEV_ENV_ID` 白名单放行） | 空/ERR → 环境初始化有问题，先修环境 |
| `requireCommon.ok` | `true` | `false` → **机制失效**：全部云函数返工（改为云端公共层或 npm file: 方案） |
| `requireCommon.exports` | 含 `assertShopOwner` 等 | 缺关键导出 → 同步脚本漏文件，重跑 sync |
| `docGet.hasDataField` | `true`（返回 `{data:{...}}`） | `false` → **A1/A2 修反了，立刻回退**（最关键翻案点） |
| `docGetMissing.behavior` | `resolve`（且 `data:null`）或 `reject` 都算「契约明确」 | 哪种都正确；决定 A1 的 try/catch 是必需还是防御性冗余（不影响结论） |
| `createIndex.typeof` / `call` | `function` 且 `OK` —— **但 2026-09-18 真云实测 = `typeof:"undefined"`（无 `call` 字段）⇒ A7 已定案「SDK 无 createIndex」，此处只作复核** | 若哪天变成 `function`+`OK` ⇒ **A7 结论被推翻**，索引可脚本化，须重议 |
| `uniqueEnforce.result` | **本字段零证明力，不作判据**（2026-09-18 真云实测 + 复核裁定）| 见下方 🔴 |
| `assertShopOwner` | `RESOURCE_NOT_FOUND`（code 字段） | 抛异常或恒 `FORBIDDEN` → A1 修复在真云上不成立，需重议 |
| `createCollection` | `{ok:true}`，或 `ok:false` 且 msg 含「已存在」 | 其余 msg → 建集合失败，先修环境/权限再重跑 |
| `dataAdapterGet` | `liveIsDoc:true` **且** `deadIsNull:true` | `deadIsNull:false` → **A2 在真 SDK 上不成立，须回退**；`THROW` → adapter 契约待议 |
| `fsDiag.commonShape` | **`flat-file(common.js)`**（R29 真判据） | `ABSENT(common 未打进包)` → common 没打进包，重跑 `node tools/sync_common.js` 后再部署；`dir(common/)` → 打包成了子目录（**必坏**）。⚠️ 若返回里**根本没有 `commonShape` 字段** ⇒ **部署件陈旧**，先去控制台看「最后更新时间」是否晚于该文件的最后一次提交 |

### 🔴 步骤 5 附注 · `uniqueEnforce` 为什么**不能**当判据（2026-09-18 更正）

- 原文（真云实测）：`"uniqueEnforce":{"result":"未报错 → unique 索引可能未生效（A7 判定为「索引不可用」）"}`。
- 机制事实：`createIndex` 在真 SDK 上是 `undefined`（本表上一行已复现）⇒ **`idx_probe_k` 这条唯一索引从来没有在 `probe_tmp` 上被创建过** ⇒ 往里插两条同 `k` **当然不报错**。
- ⇒ 这个字段报什么都不构成「唯一索引是否生效」的证据 —— **零证明力**。
- 🔴 **两条禁令**：① **不得**据「未报错」升级 A6（"唯一约束不可用"）；② **不得**据任何取值回退既有结论。
- 真云唯一索引是否**真的生效**，只能拿**已经建成唯一索引的集合**去验（例如 `shop_cost_card` 上手工复制已有三元组提交 ⇒ **必须被拒**）。**别再用本探针代答这个问题。**
- 历史提醒（防再次漂移）：本表此前的写法是「含『未报错』→ unique 索引未生效，A6 升级…」，**该判据已作废**，2026-09-18 更正。

### 步骤 6 · 替换 env.js 占位符（判据④）
- 打开 `miniprogram/config/env.js`，把 **prod 槽（第 17 行）**的占位符换成步骤 1 记下的真实环境 ID（dev 槽已在第 16 行填好）。
- **当前状态（2026-09-14）**：dev 那行**已填** `cloud1-d4gphpoxy337f2a25`；prod 那行仍是占位符（prod 环境尚未建）。
- 判据④ 现**仅剩 prod 这一项**（dev 侧已闭环）；prod 环境建好并替换后，batch0 自测的「点4 未完成」会变 ✅。

### 步骤 7 · 投喂批次 1
- 取 `specs/dev-specs/delivery/inscode喂投包_8批_自包含完整版.md`（或 `批次1_提示词_可直接复制.txt` / `inscode喂投包_8批_一键复制.html`）。
- **勿用 Desktop 派生副本**（A–K 门禁守不到那层，旧值风险）。
- 投喂给 InsCode（从仓库单源取，保证与门禁一致）。
- 回来后我按三件核：`node verify_all.js`（套件数与结果**看 `node verify_all.js` 末行**；本文件**不写死数字**——写死就是第三份必然过期的副本）/ 读 POC3 引擎确认整数分落库+口径锁 directCost+待结算不进利润 / 变异 bizRefProfitFen+1 看 test_poc3 15 条转红。

### 步骤 8 · 清理
- 去云开发控制台「数据库」→ 删除 `probe_tmp` 集合（**SDK 不能 drop collection，只能控制台手动删**）。
  - ⚠️ **顺序**：若这一轮还要按「步骤 4 ①」重发 `smokeTest` 再重跑，**先别删** —— 探针会再创建它，删两遍纯浪费。**等最后一次重跑完再删**。
  - ⚠️ 集合列表里**看到 `probe_tmp` 是常态**（历次运行都会留），别据此以为"有脏数据"；它只被探针读写。
  - 🔴 这是**不可逆的云侧操作** ⇒ 动手前按团队规矩**逐字确认**一次。
- 删除 `smokeTest` 云函数（可选；探针使命结束）。

---

## 三、术语速查（新手会卡的点）

- **云开发 / 云函数 / 云数据库**：微信提供的后端托管。云函数 = 一段部署在微信服务器的 Node.js 代码；云数据库 = 微信托管的 MongoDB 风格库。
- **`wx-server-sdk`**：云函数里操作数据库/存储的官方 SDK，`cloud.init({env})` 初始化，`cloud.database()` 拿库句柄。
- **`DYNAMIC_CURRENT_ENV`**：让云函数自动用「当前所在环境」，避免硬编码环境 ID。
- **`require('./common')` vs `require('../common')`**：`../` 指兄弟目录 `cloudfunctions/common/`（云端打包不含兄弟目录 → MODULE_NOT_FOUND）；`./` 指本函数目录内的副本。
  🔴 **2026-09-15 云端实测补一条铁律**：即便是**本函数目录内的子目录**（`<func>/common/`），真云端**依然 MODULE_NOT_FOUND** —— Windows 打包把它拼成 `common\xxx.js`（文件名含反斜杠），Linux 云端不认它是目录（`fsDiag.hasCommonDir=false`）。
  ⇒ **云函数包内禁用子目录**：副本一律扁平为 `<func>/common.js`（入口）+ `<func>/cx_*.js`（模块）。这是本机制真正的命门。
- **createIndex / unique 索引**：给集合字段建唯一索引，重复值写入会报错——用来防重复账号（A6）。
- **`doc().get()` 契约**：A1/A2 修复的依据是「返回 `{data}` 而非文档本体」；本探针③专门验真云返回形状。
- **`blocked` / 门禁 H 组**：部署时 dev 允许、prod 拒绝的逻辑开关；initDb 的 `blocked===undefined` 表示 dev 放行。放行有两条路：环境 ID 含 `dev` 子串（默认正则），**或**配了 `DEV_ENV_ID` 环境变量则精确匹配该 ID（**白名单**，见 `cloudfunctions/initDb/config.json`）；两条路都受 `!/prod/` 恒效约束。
- **25 集合**：initDb 应创建的数据库集合总数（门店/成本卡/明细/摊销/索引表等）。

---

## 四、决策分支汇总（四前提 → 行动）

| 前提 | 若为是 | 若为否 |
|---|---|---|
| ① require('./common') 云端可解析 | 机制成立，继续 | 全部云函数返工（机制失效） |
| ② createIndex 可用 + unique 生效 | A7 通过；A6 维持「罕见失败一次」 | A7 判定索引不可用；A6 升级，需首建档加 unique 冲突重试 |
| ③ doc().get() 返回 {data} | A1/A2 修法正确 | A1/A2 修反，立刻回退 |
| ④ 文档不存在时行为明确 | A1 try/catch 必要性定论 | 同左（无论哪种都正确） |

---

## 五、衔接说明（本窗口 vs 新窗口）

- **本窗口 = 主上下文**：项目记忆、重启键、本次探针设计 rationale 全在这里。批次 1 回来后的三件核 + 所有结果判读，都在本窗口做。
- **控制台机械操作不需要开新窗口**：照本 Runbook 纸质版点即可；遇到不懂的细节（如「云开发控制台在哪」「createIndex 是什么」），**回本窗口问**——我带完整上下文，能直接解释。
- **何时开新窗口**：只有当你并行起一个**无关**工作流（如另开 InsCode 草稿、写别的文档）时才开；新窗口若需接手，先让它读 `specs/dev-specs/★知识存储点_2026-09-10.md` §1.1 + `C:\Users\lzj\WorkBuddy\2026-09-08-22-08-11\.workbuddy\memory\2026-09-13.md`（**工作区记忆目录**的绝对路径；⚠️ 不是 `~\.workbuddy\memory\`——那是云端画像缓存）即可桥接（记忆每会话自动注入项目画像）。
- **回本窗口报结果时**，把步骤 4 的 JSON 整段贴回，我按「结果判读表」逐字段点名 verdict。

---

## 附：smokeTest/index.js（已落盘，供纸质对照）
（代码见 `cloudfunctions/smokeTest/index.js`；要点：① try 包 require('./common') 答机制；② createIndex + 重复写答 A7/A6；③ doc().get() 答 A1/A2；④ 缺文档 get 答契约；⑤ 真云跑 assertShopOwner 答 A1 落点；⑥ `dataAdapterGet` 直验 A2 软删分支——`common.dataAdapter.get()` 对 `is_deleted:true` 文档须返回 `null`。）

---

## 七、三方协作规则（WorkBuddy / 快马 inscode / 复审方）

> 本 Runbook 前面写的是「步骤」，这一章写「谁跟谁怎么交接」。流程骨架不变，但把角色边界、闸门顺序、验收权定死后，你（用户）就从「人肉总线」变成「仓库总线」的旁观裁决者。

### 7.0 角色与硬边界
| 角色 | 只做 | 不得越界 |
|---|---|---|
| 快马 inscode | 按批次包写 `cloudfunctions/` + `miniprogram/` 业务代码 | 🚫 改 `specs/`（规范是输入不是输出）；🚫 自证「我符合规范」 |
| WorkBuddy | 跑门禁/套件、`sync_common`、落交付物、提交 git、维护重启键 | 🚫 自行决定规范口径（只从 `specs/` 读）；🚫 复述他人结论而不实测 |
| 复审方（你） | 只读复核，出 🔴/🟡/🔵 + file:line + 精确修法 + 变异验证 | 🚫 不改文件 |
| 用户 | 云控制台/AppID、决策、批准、裁决 | 不必当技术细节搬运工 |

⚠️ **最重要一条：inscode 绝不改 `specs/`**。那等于「用输出改输入」，会让整套验收（锚点/门禁/判据）变成自证循环。WorkBuddy 每批合并前查 `git diff --name-only` 是否含 `specs/`。

### 7.1 交接面 = 仓库 + 文件，不靠聊天转述
- 输入给 inscode：`specs/dev-specs/delivery/`（批次包，每批自包含）
- 状态给所有 AI：`specs/dev-specs/★知识存储点_2026-09-10.md`（唯一真相源）
- 流程给用户：本 RUNBOOK
- 产物 = dev 上的 commit
- 聊天只传「该看哪个文件」，技术内容以文件/commit 为准。

### 7.2 每批闸门顺序（先审后合，不是两个抽检点）
① 喂批次包 → ② inscode 产出（分支 `batchN` 或暂不提交）→ ③ WorkBuddy 落三件交付物 + `node verify_all.js`（套件数与结果**看 `node verify_all.js` 末行**；本文件**不写死数字**——写死就是第三份必然过期的副本）→ ④ 复审方核判据 + 独立变异 → ⑤ **过了才进 dev**。
批次 0 已走完这条路（A1/A2/A8 就是第④步在合入前抓的）。把它固化成每批都做，而非只在「批次 0 后 / 批次 3 后」两个抽检点做——每批加一道，成本是一次套件+一次读码+一次变异，收益是 dev 上永远只有过审代码。

### 7.3 每批三件交付物（缺一不受理）
① commit　② `BATCH<N>_DELIVERY.md`：判据→file:line 映射 + 自测结果（含「哪些没做」）　③ 变异证据：对 1–2 条核心断言「回退/注入→必须转红」。
有这三件，复审方不需要问任何人、也不需要你转述。

### 7.4 验收权归属（谁写谁的自测不算证据）
实例：批次 0 生成方自测 21/21 全绿，仍掩盖 A1/A2 两个真 bug（mock 契约与平台不符）。
每批变异必须由**非生成方**执行：inscode 生成 → WorkBuddy 做变异（非生成方）。复审方的变异是「元检查」（查门禁本身是否真能抓错），可选、不替代 WorkBuddy 的每批变异。

### 7.5 部署能力定位（inscode 有，但须排在门禁后）
inscode 一键部署到微信云是**基础设施，不是验收替代**。批次 0 教训：生成方自测全绿仍掩真 bug。
正确顺序：**生成 → 门禁(9 套件) → 复审 → 过了才部署 dev/prod**。
- prod 部署：仅在复审通过 + 你明确批准后进行（判据④ env.js 占位符已替换为真值后才可上 prod）。
- dev 环境探针类部署（如 smokeTest、批次 1 的 POC3 若需真云自测）：例外，其目的就是云端实测，本在门禁外，可先部署后判读。
- ⚠️ 切勿让「inscode 已部署」被当成「验收通过」的信号——部署成功只证明代码能上传运行，不证明符合 `specs/` 口径。

### 7.6 指挥机制（澄清误解：WorkBuddy 无 inscode 连接器）
你设想「WorkBuddy 指挥 inscode」，实际总线是 **GitHub + delivery 包**：
- `specs/dev-specs/delivery/` 已备好每批自包含包（.md / 8 txt / .html 同源等价）；
- inscode 侧：你喂包，或它从 GitHub 拉（原方案 = inscode↔GitHub 同步）；
- 它生成代码 → 推 GitHub → WorkBuddy `pull` 分支 → 跑门禁 → 复审 → 过了合 dev。
所以「指挥」= 投喂包质量 + GitHub 桥，**不是实时 API 呼叫**。本会话无 inscode 连接器，未来接上也只改变「喂包」的自动化程度，不改变闸门顺序。

### 7.7 合并前检查
`git diff --name-only <上一批>..HEAD` 不得出现 `specs/`（inscode 越界改规范信号）。出现则整批退回，不合并。

### 7.8 结论回流
云侧实测（A6 / A7 / require / doc().get 契约）结果须回填 ★知识存储点 §1.1，经复审方复核后才可据其改架构决定。

