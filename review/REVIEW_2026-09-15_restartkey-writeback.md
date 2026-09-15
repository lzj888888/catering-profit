# REVIEW_2026-09-15 · 重启键回写 + 索引清单计数纠错

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。
> 本份只写 §0/§1/§2 正文；§3 执行回执由 WorkBuddy 追加。
> 用户本轮指令：**「回写项目内重启键」**（记忆点恢复后的第 ① 件事）。

---

## §0 基线（本份结论建立在什么之上）

| 项 | 实测值 | 怎么测的（可直接复现） |
|---|---|---|
| 仓库 / 分支 | `C:\Users\lzj\WorkBuddy\Claw\catering-profit` · `dev` | — |
| HEAD | **`655ca26`**（2026-09-15 08:58） | `git log --oneline -1` |
| 工作区 | **干净**（本轮开始与结束各查一次，均无输出） | `git status --short` |
| 门禁 | **A–L 全绿 exit 0** | `node specs/dev-specs/prototype/check_error_codes.js`（跑完后仓库**无任何文件改动**，故「跑过门禁」成立） |
| 项目内重启键 | `specs/dev-specs/★知识存储点_2026-09-10.md`（51897B，mtime **2026-09-13 08:51**，§1.1 自述终态日 **2026-09-12**） | `Get-Item` |
| 索引真相源 | `cloudfunctions/initDb/collections.js:22-110` = **25 集合 / 39 条索引 / 10 条 unique** | `(Select-String -Pattern "name: 'idx_").Count → 39`；`-Pattern "unique: true" → 10` |
| dev 环境 ID | `miniprogram/config/env.js:16` = `cloud1-d4gphpoxy337f2a25`（注释「2026-09-14 定」）；`:17` prod 仍占位符 | 直接读文件 |
| AppID | `project.config.json:3` = `wx33c110dc57a9c8dc` | 直接读文件 |
| 三对文档派生件 | `SMOKETEST_RUNBOOK` / `新手上云操作手册` / `下一步工序清单` 的 `.md` 与 `.txt` **SHA256 完全相同**（前 12 位 090C2F8A5737 / 3618B3B4FFC8 / CB2065FDF07B）⇒ `.txt` 就是 `.md` 的逐字副本，**重生成 = 覆盖复制** | `Get-FileHash` 两两比对 |

**为什么先纠计数**：本轮为了回写重启键去核对 A7 结论，顺手把「索引清单」的数从代码里数了一遍，发现**文档与代码不一致**（详见 R1/R8）。这不是措辞问题——它直接决定你**手工建索引时会不会漏建**，而漏建的正是 A6「可能重复账号」的唯一防线。

---

## §1 待办（先 🔴 后 🟡/🔵；每条含 证据 / 修法 / 验收）

### R1 🔴 `新手上云操作手册.md:135-143`（+ 同名 .txt）5.2b：唯一索引清单**漏 1 条**，且 A7 判读已被实测作废

**证据**
- 代码：`cloudfunctions/initDb/collections.js:57` = `{ name: 'idx_inv_shop_month', unique: true, keys: { shop_id: 1, month: 1 } }`（集合 `shop_inventory`）。
- 代码里 `unique: true` 共 **10** 条（`Select-String -Pattern "unique: true" → 10`）。
- 手册 `:137-140` 只列了 **9** 条：`user.openid` / `user.user_id` / `shop_entitlement.user_id` / `shop_monthly_account.(shop_id,month)` / `shop_cost_card.card_code` / `shop_switch.(shop_id,switch_key)` / `admin_user.username` / `shop_payment_flow.order_no` / `order_refund.order_id` —— **漏 `shop_inventory.(shop_id,month)`**。
- 手册 `:141` 判读「**全部都在** → A7 成立（`createIndex` 可用），A6 风险低」已被 **2026-09-14 云端实测否定**：`SMOKETEST_RUNBOOK.md:6` / `:15` = A7「❌ 不支持（`createIndex.typeof = "undefined"`）」。
- ⇒ 按现手册执行会在**第 141 行得到一个假结论**（9 条都在 → 判定 A7 成立），而真实情况是 A7 不成立、且第 10 条唯一索引从未核对。

**修法**：把 `:135-143` 整段替换为下面的终局版（注意 `shop_inventory` 已补入）：

```markdown
### 5.2b 核对索引清单（A7 已答：**不支持代码建索引**，所以清单要手工建全）
- 控制台 →「**数据库**」→ 逐张集合 →「**索引**」。
- `cloudfunctions/initDb/collections.js` 里共 **39 条索引**，其中 **10 条是 unique（唯一）索引**，逐条核对这 10 条：
  `user.openid` / `user.user_id` / `shop_entitlement.user_id` / `shop_monthly_account.(shop_id,month)` /
  `shop_inventory.(shop_id,month)` / `shop_cost_card.card_code` / `shop_switch.(shop_id,switch_key)` /
  `admin_user.username` / `shop_payment_flow.order_no` / `order_refund.order_id`
- **10 条都在** → A6 风险低（唯一约束真的生效了）。
- **有缺失** → 按「工序 5.5」在控制台**手工补建**；在补齐之前，A6 按「**可能产生重复账号**」处理（首建档须加 unique 冲突重试）。
- ⚠️ 别再指望 `createIndex`：2026-09-14 云端实测 39 条全部报 `createIndex is not a function`（SDK 层面无此方法，非偶发）。
```

**验收**
```
(Select-String cloudfunctions/initDb/collections.js -Pattern "unique: true").Count   → 10
Select-String 新手上云操作手册.md -Pattern "shop_inventory\.\(shop_id,month\)"        → ≥1
Select-String 新手上云操作手册.md -Pattern "A7 成立"                                  → 0
新手上云操作手册.md 与 .txt SHA256 相同（Copy-Item 覆盖重生）
```

---

### R2 🔴 探针集合名 `__probe` 未随 `3e5f549` 改名（文档 3 处 + 代码注释 1 处 + 2 份 .txt 副本）

**证据**
- 代码真相：`cloudfunctions/smokeTest/index.js:10-11` = 「2026-09-15 实测：集合名**不能以下划线开头**（微信报 `-501007 invalid parameters`），故由 `__probe` 改名」+ `const PROBE = 'probe_tmp';`
- 仍写着旧名的位置（`git grep -n "probe_tmp\|__probe"`，已排除 `review/` 历史与 HTML 派生件）：
  - `SMOKETEST_RUNBOOK.md:140`「删除 `__probe` 集合」（+.txt 同行）
  - `新手上云操作手册.md:155`（标题）/ `:156`（+.txt 同行）
  - `cloudfunctions/smokeTest/index.js:4` 注释「跑完去控制台手动删 __probe 集合」
- ⇒ 你照文档去控制台找 `__probe` **会找不到**；更糟的是文档仍在教一个**违反微信集合名规则**的名字。

**修法**：4 处 `__probe` → `probe_tmp`；`smokeTest/index.js:10-11` 的沿革注释**保留**（那是有意的历史说明）。

**验收**
```
git grep -n "__probe" -- "*.md" "*.txt" "*.js"   → 仅剩 cloudfunctions/smokeTest/index.js:10 的沿革注释
git grep -n "probe_tmp" -- "*.md"                → ≥3（Runbook 1 + 手册 2）
```

---

### R3 🔴 重启键 §1.1 回写：补 2026-09-14~09-15 云端实测终局（8 个子块）

**证据**（重启键现状 vs 仓库现状）
- 重启键 `:4` 自述「最后更新：**2026-09-12**」；`:29` 标题「**2026-09-12 终态**」。
- `:60` / `:63` 仍把 **A7** 写成「🟡 存疑（若 SDK 不支持则 9 个 unique 索引全未建）」并称 **9 个 unique**（实际 10 个）。
- 全树 grep：重启键内 **`扁平` / `sync_common` / `probe_tmp` 命中 = 0**，即 9/15 的扁平化铁律、探针改名、L 组升级**一条都没回写**。
- 仓库却已落 4 个提交：`4e1457e`（环境 ID 更正）→ `3e5f549`（探针改名 + fsDiag）→ `4e995a1`（扁平派生 + L 组升级）→ `655ca26`（四前提终局回写）。

**修法（逐块替换；用锚点定位，不依赖行号——行号会随前面块落地而漂移）**

**R3-1** 定位锚点（原 `:4` 那一行）：
```
> 生成时间：2026-09-10 08:0x ｜ **最后更新：2026-09-12（当前状态见 §1.1）**
```
替换为：
```
> 生成时间：2026-09-10 08:0x ｜ **最后更新：2026-09-15 09:2x（当前状态见 §1.1；9/14–9/15 云端实测终局见 §1.2）**
```

**R3-2** 定位锚点（原 `:29`）：
```
### 1.1 当前真相（2026-09-12 终态 · **唯一状态节** ★必读；以下可证伪）
```
替换为：
```
### 1.1 当前真相（2026-09-15 终态 · **唯一状态节** ★必读；以下可证伪）
```

**R3-3** 定位锚点（原 `:34` 中与本条有关的尾部；**只替换 K/L 两组的描述**，前半 A–J 原样保留）：把
```
｜ **L common/ 同步一致性**（首个跨 specs/ 覆盖 cloudfunctions/ 的组：各函数目录 `common/` 副本须 ≡ `cloudfunctions/common/` 单源，逐字+CRLF 归一，与 K11 同构；派生件护栏，防云端 `require('../common')` 落地 MODULE_NOT_FOUND；依赖仓库根 `tools/sync_common.js`）
```
替换为：
```
｜ **K12/K13 文档派生一致性**（`SMOKETEST_RUNBOOK` / `新手上云操作手册` 的 `.txt` 须 ≡ 同名 `.md`，剥 BOM + CRLF 归一；防「改 MD 忘重生 .txt」）｜ **L common 同步一致性**（组名不变，2026-09-15 升级为**扁平派生**校验：云函数包内**禁子目录**，副本 = `<func>/common.js`（入口）+ `<func>/cx_*.js`（模块），须 ≡ `cloudfunctions/common/` 单源；依赖仓库根 `tools/sync_common.js`。起因：云端实测子目录被 Windows 打包拼成带反斜杠的扁平文件名 → Linux 云端 `MODULE_NOT_FOUND`）
```

**R3-4** 定位锚点（原 `:49` 判据行，补 A8 之前那段）；把
```
④ `config/env.js` 填真实 `catering-dev-xxxxxx` 🔶 用户侧待办（env.js:14-15 仍占位符，待建环境后替换；
```
替换为：
```
④ `config/env.js` 的 dev 槽**已填**真实环境 ID `cloud1-d4gphpoxy337f2a25`（`miniprogram/config/env.js:16`，2026-09-14 定）✅ **dev 侧闭环**；prod 槽仍为占位符（上线前建含 `prod` 的环境后替换）🔶（
```

**R3-5** 新增 §1.2（插在 §1.1 末、原 `---` 之前；重启键原文中 §1.1 的收尾是 `---`）：

```markdown
### 1.2 2026-09-14~09-15 云端实测终局（4 前提全部答完 · 细节见 `SMOKETEST_RUNBOOK.md` §四前提终局结论）

| 前提 | 结论 | 对写码/运维的硬影响 |
|---|---|---|
| **A7** `createIndex` | ❌ **不支持**（`typeof === "undefined"`，SDK 层无此方法） | **索引只能云开发控制台手工建**；`initDb` 的建索引报错属**预期内**，不阻断建表 |
| **A6** 首建档原子性 | ⚠️ **升级为「可能重复账号」**（无 unique 约束 ⇒ 无唯一防线） | **首建档必须加 unique 冲突重试**，或改用其他去重手段 |
| **`require('./common')`** | ✅ **可行，但必须扁平** | **云函数包内禁建子目录**：副本 = `<func>/common.js` + `<func>/cx_*.js`；改 common 单源后必跑 `node tools/sync_common.js` |
| **`doc().get()` 契约** | ✅ 成立（A1/A2 修法正确） | 取值**必须取 `.data`**；读取**必须 try/catch**（文档不存在时是 **reject**，不是返回 null） |

- **探针集合名**：`__probe` 违反微信规则（集合名不得以下划线开头，报 `-501007`）→ 已改名 **`probe_tmp`**（`cloudfunctions/smokeTest/index.js:11`）；探针新增**云端文件清单自检 fsDiag**。
- **环境变量录入纪律**：`DEV_ENV_ID` 的值必须**精确**——手工录入敲错字符或带隐藏字符都会让 `env === DEV_ENV_ID` 全等失败（曾卡两轮）；**云端测试入口缺 `TCB_ENV` 时 `env` 恒为空**。⇒ 复制粘贴 + **用 fsDiag 日志验证**，不要凭肉眼信任。
- **环境 ID 更正**：真实 dev 环境 ID = **`cloud1-d4gphpoxy337f2a25`**（曾抄错一位成 `cloud1-4dgphoxy337f2a25`；因门禁是相等比较，**抄错查不出**，只能靠实测回显）。
- **门禁组数 A–L**（K 组扩出 K12/K13；L 组升级为扁平派生校验，见 §1.1）。
- **批次 0（工程地基）已交付**：鉴权 / 软删 / 幂等 / 限流 + `initDb` 25 集合，**节点①代码层通过**（`8e7e37f` → `a68ad96`）。
- **配套文档已就绪**：`SMOKETEST_RUNBOOK.md`（**唯一 Runbook**；`新手上云操作手册.md` 是同一流程的小白版，两者冲突以 Runbook 为准）、`下一步工序清单.md`（7 道工序，李老师专用）、`review/`（复审 ⇄ WorkBuddy 文件交接面，R1–R12 复核回执已落）。
```

**R3-6** 定位锚点（原 `:60` 的 A7 那条）；把
```
- 🟡 `initDb/index.js:41` `createIndex` 若 SDK 不支持则 **9 个 unique 索引全未建** → 须首次跑 initDb 后去控制台逐张核对索引清单，且它是 A6（首建档非原子）并发防护的前提（决定 A6 是「罕见失败一次」还是「可能重复账号」）。
```
替换为：
```
- ❌→已定案 **A7 = 不支持**（2026-09-14 云端实测）：`cloudfunctions/initDb/index.js:41` 的 `createIndex` 在真 wx-server-sdk 上**不存在**（`typeof === "undefined"`），39 条索引**全部**建不上 → **只能在云开发控制台手工建**。它是 A6 并发防护的前提，故 A6 相应升级（见下行）。
```

**R3-7** 定位锚点（原 `:63` 的 A6/A7 那段）；把
```
· 🟡 **A7** `initDb/index.js:41` `createIndex` 存疑（若 SDK 不支持则 `collections.js` 9 个 `unique:true` 索引**全未建**，须跑完 initDb 去控制台**逐张核对**，不信返回值）
```
替换为：
```
· ⚠️ **A6**（已升级）= **可能重复账号**：`unique:true` 索引建不上（A7 定案）⇒ 无唯一约束 ⇒ 首建档并发时**可能重复建号**。待办 = 首建档加 **unique 冲突重试**或改用其他去重手段；**不阻塞**批次 1 投喂 · ✅ **A7**（已定案）= 不支持，索引改**控制台手工建**（`collections.js` 共 39 条索引，其中 **10 条 `unique:true`**；清单见 `新手上云操作手册.md` §5.2b）
```

**R3-8** 定位锚点（原 `:52` 末尾「里程碑：…」那句的结尾）：
```
**`8e7e37f` 批次 0 工程地基入 dev** → `a68ad96` A8 入口路径 + A9/K11 + 静态路径检查。文档 bump 另计。）
```
替换为：
```
**`8e7e37f` 批次 0 工程地基入 dev** → `a68ad96` A8 入口路径 + A9/K11 + 静态路径检查 → `4e1457e` 环境 ID 更正 → `3e5f549` 探针改名 + fsDiag → `4e995a1` common 扁平派生 + L 组升级 → `655ca26` 四前提终局回写。文档 bump 另计。）
```

**验收**
```
node specs/dev-specs/prototype/check_error_codes.js            → exit 0（A–L 全绿）
git grep -c "存疑" -- "specs/dev-specs/★知识存储点_2026-09-10.md"   → 0（A7 不再是存疑）
git grep -c "probe_tmp" -- "specs/dev-specs/★知识存储点_2026-09-10.md" → ≥1
git grep -c "扁平" -- "specs/dev-specs/★知识存储点_2026-09-10.md"      → ≥1
git grep -c "cloud1-d4gphpoxy337f2a25" -- "specs/dev-specs/★知识存储点_2026-09-10.md" → ≥1
```
> ⚠️ 门禁会扫重启键本身（它在 `specs/dev-specs/` 内，属 D/I/J 的 `.md+.txt` 扫描面）。**上面的替换块已按绕写纪律预检过**（不出现 D 组的配额旧值模式、不出现 I 组的 5 位小数残余串、J 组串未使用）。落地后**必须复跑门禁**。

---

### R4 🔴 重启键 §1.1 判据 ④ 与事实相反（env.js 的 dev 槽已填）

- 已在 **R3-4** 内一并修（不单列动作，避免「同一事实改两遍」）。验收同 R3。

---

### R5 🟡 重启键 §5「文件地图」大面积失效：11 份已归档、4 份 Module 规范其实在 `core/`

**证据**（`Test-Path` 逐个实测，非猜）
- 下列文件**不在** `specs/dev-specs/`，实测都在 `C:\Users\lzj\WorkBuddy\_archive\店算_parse唯一副本_20260912\_history\`：
  `对齐清单_与豆包_v1.5.md`、`全量对账文档_与豆包_v1.6.md`、`分歧追踪表_与豆包.md`、`收费定价_独立版_v1.4.md`、`外显话术库与按钮文案_v1.0.md`、`跟豆包沟通_遗漏点审计_2026-09-10.md`、`POC1_POC2_完整输入数据包_供豆包验证.md`、`POC3_完整输入数据包_供豆包验证.md`、`POC1_POC2验证报告.md`、`多端适配核对表_安卓iOS.md`、`工程落地补全规范_v1.0_后台鉴权与页面闭环.md`
- §5.1 列的 4 份 `开发规范v1.0_Module{A,M1,M2,M3}*.md` 实际位于 **`specs/dev-specs/core/`**（§5 开头写「权威在 `specs/dev-specs/`」，会让人在根目录找不到）。
- `specs/dev-specs/inscode交付包/` 已不在仓库（§5.2 整节所指路径失效；内容在 `_archive\店算_parse唯一副本_20260912\inscode交付包\`）。
- `poc/`（3 份历史 POC）与 `i18n/terms.js` 仍在，但 §5 未记 `poc/` 目录。

**修法**：§5 标题下加一行「**本表已按 2026-09-12 归档结果校正**」+ 一个「现址」列：
· Module 四件套 → `core/` 前缀；
· 上列 11 份 → 标注「已移 `_archive\店算_parse唯一副本_20260912\_history\`（B 类唯一副本，仅审计，**勿作写码依据**）」；
· `inscode交付包/` → 同指 `_archive\...\inscode交付包\`；
· 新增 `poc/` 一行。

**验收**：`git grep -c "_archive" 重启键 → ≥1`；§5 中不再出现**.直接指向**已不存在路径的条目（人可逐一 Test-Path）。

---

### R6 🟡 `SMOKETEST_RUNBOOK.md` 三处过期，其中一处**与自身铁律自相矛盾**（+ .txt）

**证据**
1. `:31`「HEAD 仍是 `4ddcc5c` / dirty=0」→ 实测 HEAD = **`655ca26`**。
2. `:47`「本地 `cloudfunctions/smokeTest/` 已就绪（含 **`common/` 副本**，由 `node tools/sync_common.js` 生成）」——与本文件 `:106` / `:151-152`「**禁止**子目录，副本必须扁平 `common.js` + `cx_*.js`」**直接矛盾**；实测 `cloudfunctions/smokeTest/` 目录内确实**没有** `common/` 子目录，只有 `common.js` + `cx_*.js`（+ `index.js` / `package.json`）。
3. `:37-38` 步骤表里「② 替换 `miniprogram/config/env.js:14-15` 占位符……判据④唯一未完项」→ dev 槽已于 9/14 填好（`env.js:16`）。

**修法**：三处分别改为
1. `:31` → 「HEAD 以 `git log --oneline -1` 为准（本 Runbook 不复制 commit —— 同一事实写两遍必然过期）」；
2. `:47` → 「本地 `cloudfunctions/smokeTest/` 已就绪（**扁平副本** `common.js` + `cx_*.js`，无子目录，由 `node tools/sync_common.js` 生成）」；
3. `:37-38` → 「② `config/env.js` 的 **dev 槽已填**（`cloud1-d4gphpoxy337f2a25`），仅 **prod 槽**待建环境后替换」。

**验收**：改完 **必须重生成 `.txt`**（K12/K13 守）：
```
Copy-Item SMOKETEST_RUNBOOK.md SMOKETEST_RUNBOOK.txt -Force
node specs/dev-specs/prototype/check_error_codes.js     → exit 0（K13 不红）
```

---

### R7 🟡 `新手上云操作手册.md:49` AppID 现状过期 + `app.json` 残留旧值

**证据**
- `project.config.json:3` = `"appid": "wx33c110dc57a9c8dc"`（**已换真 AppID**），而 `新手上云操作手册.md:49` 仍写「项目里现在写的是 `touristappid`（游客占位符），**必须换成你这个真 AppID**」→ 现在读会误导（这一步已完成）。
- `app.json:13-15` 仍有 `"projectConfig": { "appid": "touristappid" }` —— 这是**第二处 appid 事实**，且 `appid` 并非 `app.json` 的标准顶层字段。⚠️ **我在本机无法验证微信开发者工具是否会因该字段告警**（无开发者工具可跑）——**请以工具实测为准**，不要把我的判断当成已验证结论。

**修法**
- 手册 `:49` → 「项目里**已经填好**真 AppID `wx33c110dc57a9c8dc`（`project.config.json:3`）；你只需确认它与你小程序后台的 AppID **一致**」。
- `app.json:13-15` → 建议删除整个 `projectConfig` 块；若删后开发者工具报错，则改为在 `project.private.config.json` 里配置（该文件为个人私密配置，不进 git）。

**验收**：手册改后**重生成 `.txt`**（`Copy-Item`），门禁 exit 0；`app.json` 删块后小程序能正常编译（**须你或 WorkBuddy 在开发者工具里实测**，我只读沙箱核不了）。

---

### R8 🟡 `下一步工序清单.md:127,131,137` 索引条数错（写 30，实为 39）

**证据**：`:131`「25 张集合共 **30 条索引**，全部定义在 `cloudfunctions/initDb/collections.js` 的 `INDEXES` 里」；`:137`「逐条重复 **30 次**」；`:127` 标题「工序 5.5 · 索引 **30 条**」。实测代码 = **39 条（10 条 unique）**。

**修法**：三处 `30` → `39`，并在 `:139` 把「WorkBuddy 出逐条对照表」换成**直接内联**（对照表见本份 **附A**，可整段粘进工序 5.5）。⚠️ 该文件的 `.md`/`.txt` **不在 K12/K13 覆盖内**（门禁 `DOC_PAIRS` 只有 2 对）⇒ 改完 `.md` 必须**手工** `Copy-Item` 重生 `.txt`，否则两份漂移且门禁**看不见**。
> 🔵 建议（可选，属改门禁代码，由 WorkBuddy 决定）：把 `下一步工序清单` 也加入 `check_error_codes.js:546` 的 `DOC_PAIRS`，让 K13 一起守。

**验收**：`Select-String 下一步工序清单.md -Pattern "39 条索引" → ≥1`；`.md`/`.txt` SHA256 相同。

---

### R9 🔵 `verify_all.js:3` 注释过期（A–K → A–L；6 个 specs 套件 → 7 个）

- 证据：`:3` 写「串联：6 个 specs 套件（门禁 A–K + seed/poc1-4）+ 批次0 代码自测」；实测 `SUITES`（`:14-23`）**8 项**：门禁 A-L / verify_seed_data / test_poc1~4 / batch0 自测 / 静态路径检查（7 个 specs 套件）。
- 修法：注释改为「7 个 specs 套件（门禁 A–L + seed/poc1-4）+ 批次0 自测 + 静态路径检查 = 8」。
- 验收：肉眼 + 注释与 `SUITES.length` 一致（`:46` 打印的就是它）。

---

### R10 🔵 `README.md:12` 与云开发前置冲突

- 证据：`:12`「可用 touristappid 测试号，无需 AppID」——但云开发**必须有真 AppID**（`SMOKETEST_RUNBOOK.md:51-54`、`新手上云操作手册.md:44-49`，你 9/13 也正是卡在这）。现已换成 `wx33c110dc57a9c8dc`。
- 修法：改成「纯预览可用游客模式；**云开发功能必须用真 AppID**，本项目已配 `wx33c110dc57a9c8dc`」。
- 验收：`Select-String README.md -Pattern "无需 AppID" → 0`。

---

### R11 🔵 重启键 §8「未完事项清单」表已过期（但**建议只加指针，不改写历史**）

- 证据：§8 全节已自带「⚠️ 勿作当前状态」横幅，但其 `:330` 表格自称「这是『接下来做什么』的答案」，且表内多项已过期（批次 0 仍标 ✅ 可投喂、建 dev/prod 环境仍标 🟡 待做，实际 dev 环境已建并在 9/14 实跑过 initDb）。
- 修法：在 `:330` 表标题那行**前面**加一句指针（不重写表格内容，保历史原貌）：
```
> ⚠️ 本表为 2026-09-11 快照，**已过期**；「接下来做什么」一律看 §1.1 / §1.2。
```
- 验收：`git grep -c "已过期" 重启键 → ≥1`。

---

## 附A · 39 条索引权威清单（给 WorkBuddy 内联进「工序 5.5」；来源 `cloudfunctions/initDb/collections.js:22-110`）

> **25 集合 / 39 条 / 其中 10 条 unique**（下表 `【唯一】` 标记）。控制台建索引时「是否唯一」照此勾选。

| # | 集合 | 索引名 | 字段（升/降） | 唯一 |
|---|---|---|---|---|
| 1 | user | idx_openid | openid ↑ | 【唯一】 |
| 2 | user | idx_user_id | user_id ↑ | 【唯一】 |
| 3 | shop | idx_shop_user | user_id ↑ | |
| 4 | shop | idx_shop_user_del | user_id ↑, is_deleted ↑ | |
| 5 | shop_entitlement | idx_ent_user | user_id ↑ | 【唯一】 |
| 6 | shop_entitlement | idx_ent_expire | expire_at ↑ | |
| 7 | shop_subscription | idx_sub_user | user_id ↑ | |
| 8 | shop_payment_flow | idx_pay_user | user_id ↑ | |
| 9 | shop_payment_flow | idx_pay_order | order_no ↑ | 【唯一】 |
| 10 | shop_payment_flow | idx_pay_shop | shop_id ↑ | |
| 11 | order_refund | idx_refund_order | order_id ↑ | 【唯一】 |
| 12 | order_refund | idx_refund_user | user_id ↑ | |
| 13 | shop_monthly_account | idx_acc_shop_month | shop_id ↑, month ↑ | 【唯一】 |
| 14 | shop_monthly_account | idx_acc_shop_del | shop_id ↑, is_deleted ↑ | |
| 15 | shop_monthly_income | idx_inc_shop_month | shop_id ↑, month ↑ | |
| 16 | shop_monthly_expense | idx_exp_shop_month | shop_id ↑, month ↑ | |
| 17 | shop_inventory | idx_inv_shop_month | shop_id ↑, month ↑ | 【唯一】 ← **手册原漏此条** |
| 18 | shop_cost_card | idx_card_shop | shop_id ↑ | |
| 19 | shop_cost_card | idx_card_code | card_code ↑ | 【唯一】 |
| 20 | shop_cost_card_line | idx_line_card | card_id ↑ | |
| 21 | shop_material | idx_mat_shop | shop_id ↑ | |
| 22 | shop_material | idx_mat_shop_virtual | shop_id ↑, is_virtual ↑ | |
| 23 | shop_sandbox | idx_sb_shop | shop_id ↑ | |
| 24 | shop_sandbox | idx_sb_shop_del | shop_id ↑, is_deleted ↑ | |
| 25 | shop_amortize | idx_amort_shop | shop_id ↑ | |
| 26 | shop_switch | idx_switch_shop_key | shop_id ↑, switch_key ↑ | 【唯一】 |
| 27 | audit_log | idx_audit_shop | shop_id ↑ | |
| 28 | audit_log | idx_audit_action | action ↑ | |
| 29 | audit_log | idx_audit_created | created_at ↓ | |
| 30 | admin_user | idx_admin_username | username ↑ | 【唯一】 |
| 31 | admin_login_log | idx_login_admin | admin_id ↑ | |
| 32 | subscription_plan | idx_plan_enabled | enabled ↑, sort ↑ | |
| 33 | feature_permissions | idx_fp_plan | plan_id ↑ | |
| 34 | shop_stored_value | idx_sv_shop | shop_id ↑ | |
| 35 | shop_stored_value | idx_sv_shop_month | shop_id ↑, month ↑ | |
| 36 | shop_credit_ledger | idx_cl_shop | shop_id ↑ | |
| 37 | shop_credit_ledger | idx_cl_shop_created | shop_id ↑, created_at ↓ | |
| 38 | shop_income_item | idx_ii_shop_month | shop_id ↑, month ↑ | |
| 39 | shop_expense_item | idx_ei_shop_month | shop_id ↑, month ↑ | |

---

## 附B · 门禁预检声明（本轮**机器跑过**，不是口头保证）

- 本份**替换块所落的文件**（重启键、Runbook、手册、工序清单）全部位于门禁扫描面内 ⇒ 交付前已用脚本按 D/I/J/F 四组禁用模式**逐块预检**：
  - **① 锚点唯一性**：R3 的 **7 个定位锚点**在重启键（51897 字节）中各**恰好命中 1 次**（否则无法做精确替换）。
  - **② 替换块**：**9 个替换块全部 0 违规**（D 组 9 条模式 / I 组 3 条模式 / J 组护栏串 / U+FFFD 均未命中）。
  - 结果：`锚点失败 0 处 · 替换块违规 0 处`，脚本 `exit 0`。
- ⚠️ 预检只覆盖**禁用模式**；落地后**唯一判据仍是复跑门禁 `exit 0`**（不要以预检代替执行）。
- 本轮我对仓库**只读**：`git status --short` 在会话开始与结束各查一次，均无输出。

---

## §2 能力边界（别把我的结论当成"云端已验证"）

- **云端核不了**：A6/A7/`require('./common')`/`doc().get()` 的结论来源是 `SMOKETEST_RUNBOOK.md` 记录的**你的实测回显**，不是我复现的；控制台真实输出（含「30 条 vs 39 条索引报错条数」）我**无法复核**——R1/R8 的计数结论**只以代码为准**（那是可复现的那一半）。
- **远端 push 核不了**：SSH / HTTPS 均不通；「已推 dev」一律记为推送方回显，不当既验事实。
- **`verify_all.js` 端到端跑不了**：沙箱禁管道型子进程（`spawn+pipe = EPERM`）。我只单独跑了门禁套件；`verify_all` 的聚合逻辑此前已用「全成功 exit0 / 单个失败 exit1」验过。
- **开发者工具行为核不了**：`app.json` 里非标准字段是否告警（R7）**必须**由你或 WorkBuddy 在工具里实测。
- **微信侧规则**：探针集合名不得以 `_` 开头（`-501007`）系你 9/15 的实测回显，我采信并据此判 R2 为 🔴。

---

## §3 执行回执（由 WorkBuddy 追加 · 2026-09-15）

> 执行方：WorkBuddy（非复审方）。轮次：1。仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit` · `dev`。
> 结论：**R1–R11 全部落地**（R4 并入 R3-4）；门禁 A–L 复跑 **exit 0**；三对 `.md`≡`.txt`。R7 的 `app.json` 子项**留待开发者工具实测**，本轮未改。

### 逐条落地
| 条 | 状态 | 落点 / 证据 | 备注 |
|---|---|---|---|
| R1 🔴 | ✅ | `新手上云操作手册.md` §5.2b 换终局版（39 索引 / 10 条 unique / 补 `shop_inventory.(shop_id,month)` / 删「A7 成立」旧判定） | `.txt` 已重生 |
| R2 🔴 | ✅ | 4 处 `__probe`→`probe_tmp`：`SMOKETEST_RUNBOOK.md` 步骤8、`新手上云操作手册.md` §5.5、`cloudfunctions/smokeTest/index.js:4`；`smokeTest/index.js:10` 沿革注释**保留** | 手册 `.txt` 已重生 |
| R3 🔴 | ✅ | 8 块全落：更新行 / §1.1 终态标题 / K12·K13+L 扁平化 / 判据④ / 新增 **§1.2** / A7 定案 / A6 升级 / 里程碑链（补 `4e1457e`→`655ca26`） | §1.2 已建 |
| R4 🔴 | ✅ | 已并入 R3-4（未单列动作） | — |
| R5 🟡 | ✅（实现方式调整） | §5 标题下加「已按 2026-09-12 归档校正」横幅（Module→`core/`、11 份→`_archive\...\_history\`、`inscode交付包/`→`_archive\...\_history\inscode交付包\`、`poc/` 仍在）；§5.1 五条加 `core/` 前缀 | ⚠️ 以「横幅现址表」代替「逐行现址列」，避免整表重写引入误差；如需严格逐列，请回执点我 |
| R6 🟡 | ✅ | `SMOKETEST_RUNBOOK.md` 三处（HEAD 不复制 commit / 判据④ dev 侧闭环 / 扁平副本无子目录） | 与自身铁律的自相矛盾已消除 |
| R7 🟡 | ✅（手册）/ ⏸（app.json） | 手册 §1.5 改「已填真 AppID `wx33c110dc57a9c8dc`」；`app.json` 的 `projectConfig.appid` 块**未删** | ⏸ 删块属开发者工具行为，须实测，本轮不盲删 |
| R8 🟡 | ✅ | `下一步工序清单.md` 工序 5.5 的 3 处 30→39；原「WorkBuddy 出对照表」**内联为 39 条表**；`.txt` 手工重生 | ⚠️ 该对不在 `DOC_PAIRS`，门禁守不到，靠手工重生 |
| R9 🔵 | ✅（数字已纠） | `verify_all.js:3` 注释重写 | ⚠️ 原文建议「7 个 specs 套件」；实测为 **6**（门禁+seed+poc1-4），总 **8**。已按实测写 |
| R10 🔵 | ✅ | `README.md` 运行节改为「预览可用游客模式；云开发必须真 AppID，已配 `wx33c110dc57a9c8dc`」 | — |
| R11 🔵 | ✅ | `★知识存储点` §8 表前加「本表为 2026-09-11 快照，已过期」指针（不改写历史表格） | — |

### 同事实外溢（review 未枚举，属同一可复现错误类，一并改正）
- `SMOKETEST_RUNBOOK.md` 另有 4 处同族旧值未被 R6 列出，已按代码真相改正：`:6`/`:15`「30 条索引」→「39 条」；§0.1.4 与步骤 2 的「9 个 unique」→「10 个」并补 `shop_inventory`、删「全在→A7=支持」旧分支。**计数一律以 `cloudfunctions/initDb/collections.js`（39 条 / 10 条 unique）为准。**

### 门禁回执（机器跑过，非口头保证）
```
node specs/dev-specs/prototype/check_error_codes.js     → exit 0，A–L 全绿
sha256(新手上云操作手册.md) == sha256(.txt)              → 相同
sha256(SMOKETEST_RUNBOOK.md) == sha256(.txt)             → 相同
sha256(下一步工序清单.md)   == sha256(.txt)              → 相同
grep 存疑 -- ★知识存储点                                 → 0
grep __probe -- *.md *.txt *.js                          → 仅 smokeTest/index.js:10 沿革注释（+ review/ 历史 + §1.2 沿革）
```

### 未决 / 提请裁决
1. **R7 `app.json` 的 `projectConfig.appid: touristappid`**：本轮未删（须开发者工具实测，复审方 §2 亦声明不可核）。请裁决：删块 / 移入 `project.private.config.json` / 保留。
2. **R8 的 🔵 建议**（把 `下一步工序清单` 加入 `check_error_codes.js` 的 `DOC_PAIRS`）：本轮**未改门禁代码**（避免自证循环）。请裁决是否纳入。
3. **R5 实现方式**：如坚持「逐行现址列」，请回执确认，下一轮补。

### 本轮工具注记（透明起见）
- 首轮对**同一文件**并发下发多处改动时发生写覆盖（同文件并行编辑竞态），部分改动未落盘；已改为**同文件串行、逐条重放**并逐条复核。现终态为「全部落地」，以本 §3 的门禁回执与 grep 为准。

### 本轮改动文件（git status）
`README.md` · `verify_all.js` · `SMOKETEST_RUNBOOK.md`(+`.txt`) · `新手上云操作手册.md`(+`.txt`) · `下一步工序清单.md`(+`.txt`) · `cloudfunctions/smokeTest/index.js` · `specs/dev-specs/★知识存储点_2026-09-10.md`
