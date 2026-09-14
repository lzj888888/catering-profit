# 店算 · 云端探针部署 Runbook（批次 1 前置）

> 用途：在真 wx-server-sdk / 真云数据库上一次性答完 4 个本地从没验证过的前提（A6 / A7 / require('./common') / doc().get() 契约）。
> 跑完这个再投喂批次 1，比「先投喂、后建环境」省一个来回。

> 🔬 **2026-09-14 晚实测已答一项（A7）**：在 dev 环境 `cloud1` 上真跑 `initDb`，30 条索引**全部**报 `db.collection(...).createIndex is not a function` ——
> 即 wx-server-sdk **压根不存在这个方法**（不是"调用失败"，是"没有这个接口"）。
> ⇒ **A7 = 不支持，且坐实为 SDK 层面缺失**（非偶发）→ 索引**只能云端控制台手工建**；按本 Runbook §五的既定判读，**A6 相应升级为「可能重复账号」**，首建档须加 unique 冲突重试（或改用其他去重手段）。
> 余下三项（A6 实测行为 / `require('./common')` / `doc().get()` 契约）仍待 `smokeTest` 探针答题。

> 配套代码已落盘：`cloudfunctions/smokeTest/`（index.js + package.json + 已 sync 的 common/ 副本）。本 Runbook 是给你在控制台照做的纸质流程。
> ⚠️ **本文件是【唯一 Runbook】**。若见 `SMOKEST_RUNBOOK.*`（漏 `ET` 的手误副本）属历史残留，已删除，请勿再使用。
> 本文件是【**权威操作流程**】。`新手上云操作手册.md` 是同一流程的**小白友好版**（面向没用过开发者工具的人）；
> 两者若冲突，**以本文件为准**。

---

## 一、一句话结论与顺序

- **不要从头重跑本地 8 套件**：HEAD 仍是 `4ddcc5c` / dirty=0，同一棵树跑同一批套件只会得到同一结果（仪式不是验证）。本地层鉴别力已逐项用变异证明过。
- **唯一该跑的是云端探针**：它一次答完 4 个前提，其中 `doc().get()` 返回形状有翻案能力（决定 A1/A2 是否修反）。
- **建议顺序：先做①建环境，后③投喂**（①未知量最大；「hello 能否 require('./common')」实测会反哺后面所有函数代码放置，虽写法已定为 require('./common')，但机制是否成立要云端实测）。①③ 互不阻塞，可并行。

| # | 事 | 为什么只有你能做 |
|---|---|---|
| ① | 云环境：dev = 现有免费环境 `cloud1`（ID `cloud1-4dgphoxy337f2a25`，走 `DEV_ENV_ID` 白名单放行）；prod 待建（上线前）→ 部署 initDb 到 dev → 控制台核对 25 集合 + 索引清单 | 需你的微信账号与云开发控制台；一次性问清 A7 / A6 / require 三悬案 |
| ② | 替换 `miniprogram/config/env.js:14-15` 占位符为真实环境 ID | 建完环境才有真值（判据④唯一未完项） |
| ③ | 投喂批次 1（从 `specs/dev-specs/delivery/` 取 .md / 8 个 .txt / .html，勿用 Desktop 副本） | 从仓库权威源取，避免派生件落后 |

---

## 二、详细操作步骤

### 步骤 0 · 准备
- 确认你有微信公众平台 / 小程序账号，且已开通**云开发**（微信开发者工具 → 云开发按钮）。
- 本地 `cloudfunctions/smokeTest/` 已就绪（含 `common/` 副本，由 `node tools/sync_common.js` 生成）。

### 步骤 0.1 · 投喂前硬前置与阻塞清单（缺一项就别开跑）

0.1.1 【硬前置】真实 AppID —— 没有它云开发根本不可用
- 现状：`project.config.json` 的 `appid` 是 `"touristappid"`（微信开发者工具的**游客模式占位**）。
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
- 核对 `cloudfunctions/initDb/collections.js` 声明的 **9 个 unique 索引**是否真的建上：
  `user.openid` / `user.user_id` / `shop_entitlement.user_id` / `shop_monthly_account.(shop_id,month)` /
  `shop_cost_card.card_code` / `shop_switch.(shop_id,switch_key)` / `admin_user.username` /
  `shop_payment_flow.order_no` / `order_refund.order_id`
- 判读：**全在** → A7=支持，A6（首建档非原子）风险=偶发失败一次，可缓；
        **有缺失** → A7=不支持（`createIndex` 不可用）→ 索引须控制台手工建，且 A6 **升级**为
        「可能产生重复账号」（须给首建档加 unique 冲突重试）。

0.1.5 外部上线阻塞（不挡写码/投喂/建环境，但别误以为「能跑=能上线」）
营业执照 → 微信支付商户号 → 隐私政策正文+URL → 小程序类目(工具>记账) → 审核测试账号。
现状：`enable_real_payment=false`，走私域手动发权益；运营流程（谁发/怎么发/怎么对账）尚无文档 → 待补。

### 步骤 1 · 云环境（dev / prod）
- 微信开发者工具打开本小程序项目 → 顶部「云开发」→「环境」→「新建环境」。
- **推荐做法**：环境名称含 `dev` / `prod` 字样（门禁 H 组判据：`!/prod/` 恒效、`dev` 白名单放行）。
- **例外（本项目已采用）**：微信侧默认**免费环境**（名如 `cloud1`，**不含 dev 字样**）**也可以当 dev 用**——环境门禁留有 `DEV_ENV_ID` **精确白名单**分支（见 `cloudfunctions/initDb/collections.js` 的 `gate()`）：把该环境 ID 填进 `cloudfunctions/initDb/config.json` 的 `DEV_ENV_ID` 即被放行。
- **本项目当前状态（2026-09-14 定）**：
  - dev = 微信侧免费环境 `cloud1`，环境 ID **`cloud1-4dgphoxy337f2a25`**；`initDb/config.json` 已配好 `DEV_ENV_ID`。
  - prod **暂未建**——写码阶段用不到，等上线前再建一个名含 `prod` 的环境即可。
- ⚠️ 每个账号可免费建 **2 个**环境（当前已用 1 个，剩 1 个）；且官方规则为「环境注销需**超过 1 个月**才能再免费创建」→ **绝不要删掉 cloud1**，否则可能 1 个月内建不了新环境。
- 在 dev 环境开通数据库（默认已有，确认「数据库」标签页可见）。

### 步骤 2 · 部署 initDb（核对 25 集合）
- 右键 `cloudfunctions/initDb` → 「上传并部署：云端安装依赖」。
- 上传完成后 → 右键 initDb →「测试」→ 入参 `{}`（或触发 `initDb` 的 `main`）→ 运行。
- 预期：`created.length === 25` 且 `blocked === undefined`（dev 门禁放行）。
- 去「数据库」标签页核对：**集合数 = 25**（若不是 25，截图给我，可能涉及 A6 严重度）。
- 索引清单：门禁 A7 关注 9 个 unique 索引；initDb 是否建索引由代码决定，本探针第②条专门验 createIndex 能力。

### 步骤 3 · 部署 smokeTest（含 common 副本）
- 右键 `cloudfunctions/smokeTest` →「上传并部署：云端安装依赖」（wx-server-sdk 会云端 npm 安装）。
- 上传时把本地 `smokeTest/common/` 副本一并打进包（微信打包本函数目录自身内容，副本就在目录内 → 这正是机制成立的关键）。
- 若上传后控制台报「找不到模块 ./common」→ **机制失效信号**（见结果判读 ①）。

### 步骤 4 · 控制台触发 smokeTest，取 JSON
- 右键 smokeTest →「测试」→ 入参 `{}` → 运行。
- 把返回的 **完整 JSON** 复制下来（贴回本窗口给我判读）。

### 步骤 5 · 结果判读（逐字段 → 结论）
| 返回字段 | 期望 | 若为否则 → 行动 |
|---|---|---|
| `env` | 非空、等于你的 dev 环境 ID（咱们是 `cloud1-4dgphoxy337f2a25`；**不含 `dev` 字样属正常**，因走 `DEV_ENV_ID` 白名单放行） | 空/ERR → 环境初始化有问题，先修环境 |
| `requireCommon.ok` | `true` | `false` → **机制失效**：全部云函数返工（改为云端公共层或 npm file: 方案） |
| `requireCommon.exports` | 含 `assertShopOwner` 等 | 缺关键导出 → 同步脚本漏文件，重跑 sync |
| `docGet.hasDataField` | `true`（返回 `{data:{...}}`） | `false` → **A1/A2 修反了，立刻回退**（最关键翻案点） |
| `docGetMissing.behavior` | `resolve`（且 `data:null`）或 `reject` 都算「契约明确」 | 哪种都正确；决定 A1 的 try/catch 是必需还是防御性冗余（不影响结论） |
| `createIndex.typeof` / `call` | `function` 且 `OK` | `undefined` 或 THROW → A7：createIndex 不可用 |
| `uniqueEnforce.result` | 含「报错（符合预期）」 | 含「未报错」→ unique 索引未生效，A6 升级为「可能重复账号」，需给首建档加 unique 冲突重试 |
| `assertShopOwner` | `RESOURCE_NOT_FOUND`（code 字段） | 抛异常或恒 `FORBIDDEN` → A1 修复在真云上不成立，需重议 |
| `createCollection` | `{ok:true}`，或 `ok:false` 且 msg 含「已存在」 | 其余 msg → 建集合失败，先修环境/权限再重跑 |
| `dataAdapterGet` | `liveIsDoc:true` **且** `deadIsNull:true` | `deadIsNull:false` → **A2 在真 SDK 上不成立，须回退**；`THROW` → adapter 契约待议 |

### 步骤 6 · 替换 env.js 占位符（判据④）
- 打开 `miniprogram/config/env.js`，把第 14–15 行的占位符换成步骤 1 记下的真实环境 ID。
- **当前状态（2026-09-14）**：dev 那行**已填** `cloud1-4dgphoxy337f2a25`；prod 那行仍是占位符（prod 环境尚未建）。
- 这是判据④唯一未完项；prod 环境建好并替换后，batch0 自测的「点4 未完成」会变 ✅。

### 步骤 7 · 投喂批次 1
- 取 `specs/dev-specs/delivery/inscode喂投包_8批_自包含完整版.md`（或 `批次1_提示词_可直接复制.txt` / `inscode喂投包_8批_一键复制.html`）。
- **勿用 Desktop 派生副本**（A–K 门禁守不到那层，旧值风险）。
- 投喂给 InsCode（从仓库单源取，保证与门禁一致）。
- 回来后我按三件核：`node verify_all.js`（8 套件）/ 读 POC3 引擎确认整数分落库+口径锁 directCost+待结算不进利润 / 变异 bizRefProfitFen+1 看 test_poc3 15 条转红。

### 步骤 8 · 清理
- 去云开发控制台「数据库」→ 删除 `__probe` 集合（**SDK 不能 drop collection，只能控制台手动删**）。
- 删除 `smokeTest` 云函数（可选；探针使命结束）。

---

## 三、术语速查（新手会卡的点）

- **云开发 / 云函数 / 云数据库**：微信提供的后端托管。云函数 = 一段部署在微信服务器的 Node.js 代码；云数据库 = 微信托管的 MongoDB 风格库。
- **`wx-server-sdk`**：云函数里操作数据库/存储的官方 SDK，`cloud.init({env})` 初始化，`cloud.database()` 拿库句柄。
- **`DYNAMIC_CURRENT_ENV`**：让云函数自动用「当前所在环境」，避免硬编码环境 ID。
- **`require('./common')` vs `require('../common')`**：`./` 指本函数目录内的副本（云端能找到）；`../` 指兄弟目录 `cloudfunctions/common/`（云端打包不含兄弟目录 → MODULE_NOT_FOUND）。这正是本机制的命门。
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
- **何时开新窗口**：只有当你并行起一个**无关**工作流（如另开 InsCode 草稿、写别的文档）时才开；新窗口若需接手，先让它读 `specs/dev-specs/★知识存储点_2026-09-10.md` §1.1 + `.workbuddy/memory/2026-09-13.md` 即可桥接（记忆每会话自动注入项目画像）。
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
① 喂批次包 → ② inscode 产出（分支 `batchN` 或暂不提交）→ ③ WorkBuddy 落三件交付物 + `node verify_all.js`（8 套件）→ ④ 复审方核判据 + 独立变异 → ⑤ **过了才进 dev**。
批次 0 已走完这条路（A1/A2/A8 就是第④步在合入前抓的）。把它固化成每批都做，而非只在「批次 0 后 / 批次 3 后」两个抽检点做——每批加一道，成本是一次套件+一次读码+一次变异，收益是 dev 上永远只有过审代码。

### 7.3 每批三件交付物（缺一不受理）
① commit　② `BATCH<N>_DELIVERY.md`：判据→file:line 映射 + 自测结果（含「哪些没做」）　③ 变异证据：对 1–2 条核心断言「回退/注入→必须转红」。
有这三件，复审方不需要问任何人、也不需要你转述。

### 7.4 验收权归属（谁写谁的自测不算证据）
实例：批次 0 生成方自测 21/21 全绿，仍掩盖 A1/A2 两个真 bug（mock 契约与平台不符）。
每批变异必须由**非生成方**执行：inscode 生成 → WorkBuddy 做变异（非生成方）。复审方的变异是「元检查」（查门禁本身是否真能抓错），可选、不替代 WorkBuddy 的每批变异。

### 7.5 部署能力定位（inscode 有，但须排在门禁后）
inscode 一键部署到微信云是**基础设施，不是验收替代**。批次 0 教训：生成方自测全绿仍掩真 bug。
正确顺序：**生成 → 门禁(8 套件) → 复审 → 过了才部署 dev/prod**。
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

