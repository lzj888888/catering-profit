# 店算 · 云端探针部署 Runbook（批次 1 前置）

> 用途：在真 wx-server-sdk / 真云数据库上一次性答完 4 个本地从没验证过的前提（A6 / A7 / require('./common') / doc().get() 契约）。
> 跑完这个再投喂批次 1，比「先投喂、后建环境」省一个来回。
> 配套代码已落盘：`cloudfunctions/smokeTest/`（index.js + package.json + 已 sync 的 common/ 副本）。本 Runbook 是给你在控制台照做的纸质流程。

---

## 一、一句话结论与顺序

- **不要从头重跑本地 8 套件**：HEAD 仍是 `4ddcc5c` / dirty=0，同一棵树跑同一批套件只会得到同一结果（仪式不是验证）。本地层鉴别力已逐项用变异证明过。
- **唯一该跑的是云端探针**：它一次答完 4 个前提，其中 `doc().get()` 返回形状有翻案能力（决定 A1/A2 是否修反）。
- **建议顺序：先做①建环境，后③投喂**（①未知量最大；「hello 能否 require('./common')」实测会反哺后面所有函数代码放置，虽写法已定为 require('./common')，但机制是否成立要云端实测）。①③ 互不阻塞，可并行。

| # | 事 | 为什么只有你能做 |
|---|---|---|
| ① | 建 dev/prod 云环境（名称须含 dev/prod）→ 部署 initDb → 控制台核对 25 集合 + 索引清单 | 需你的微信账号与云开发控制台；一次性问清 A7 / A6 / require 三悬案 |
| ② | 替换 `miniprogram/config/env.js:14-15` 占位符为真实环境 ID | 建完环境才有真值（判据④唯一未完项） |
| ③ | 投喂批次 1（从 `specs/dev-specs/delivery/` 取 .md / 8 个 .txt / .html，勿用 Desktop 副本） | 从仓库权威源取，避免派生件落后 |

---

## 二、详细操作步骤

### 步骤 0 · 准备
- 确认你有微信公众平台 / 小程序账号，且已开通**云开发**（微信开发者工具 → 云开发按钮）。
- 本地 `cloudfunctions/smokeTest/` 已就绪（含 `common/` 副本，由 `node tools/sync_common.js` 生成）。

### 步骤 1 · 建 dev / prod 云环境
- 微信开发者工具打开本小程序项目 → 顶部「云开发」→「环境」→「新建环境」。
- **环境名称必须含 `dev` 与 `prod` 字样**（门禁 H 组判据：`!/prod/` 恒效、`dev` 白名单放行；名称不对会导致 env 门禁逻辑判定异常）。
- 记下两个环境的 **环境 ID**（形如 `xxxx-dev-xxx`、`xxxx-prod-xxx`）——步骤 6 要用。
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
| `env` | 非空、含 dev 环境 ID | 空/ERR → 环境初始化有问题，先修环境 |
| `requireCommon.ok` | `true` | `false` → **机制失效**：全部云函数返工（改为云端公共层或 npm file: 方案） |
| `requireCommon.exports` | 含 `assertShopOwner` 等 | 缺关键导出 → 同步脚本漏文件，重跑 sync |
| `docGet.hasDataField` | `true`（返回 `{data:{...}}`） | `false` → **A1/A2 修反了，立刻回退**（最关键翻案点） |
| `docGetMissing.behavior` | `resolve`（且 `data:null`）或 `reject` 都算「契约明确」 | 哪种都正确；决定 A1 的 try/catch 是必需还是防御性冗余（不影响结论） |
| `createIndex.typeof` / `call` | `function` 且 `OK` | `undefined` 或 THROW → A7：createIndex 不可用 |
| `uniqueEnforce.result` | 含「报错（符合预期）」 | 含「未报错」→ unique 索引未生效，A6 升级为「可能重复账号」，需给首建档加 unique 冲突重试 |
| `assertShopOwner` | `RESOURCE_NOT_FOUND`（code 字段） | 抛异常或恒 `FORBIDDEN` → A1 修复在真云上不成立，需重议 |

### 步骤 6 · 替换 env.js 占位符（判据④）
- 打开 `miniprogram/config/env.js`，把第 14–15 行的占位符（如 `your-dev-env-id` / `your-prod-env-id`）换成步骤 1 记下的真实环境 ID。
- 这是判据④唯一未完项；替换后 batch0 自测的「点4 未完成」会变 ✅。

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
- **`blocked` / 门禁 H 组**：部署时 dev 允许、prod 拒绝的逻辑开关；initDb 的 `blocked===undefined` 表示 dev 放行。
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
（代码见 `cloudfunctions/smokeTest/index.js`；要点：① try 包 require('./common') 答机制；② createIndex + 重复写答 A7/A6；③ doc().get() 答 A1/A2；④ 缺文档 get 答契约；⑤ 真云跑 assertShopOwner 答 A1 落点。）
