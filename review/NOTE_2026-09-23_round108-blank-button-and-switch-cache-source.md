# round108 回执 · 「空白按钮」与「开关关不上」——两个静默缺陷的根因定位

- **触发**：李老师 2026-09-23 真机反馈，原文：
  > 「分期摊销  启用分期摊销  关掉后 下面登记的摊销资产不计入利润  ，这个启用分期摊销 开关 **关不上，会自动调整为打开状态**。再投一笔  下面 按钮 现在是 **纯蓝色 上面没有文字**。整个设计思路非常好，给你点赞。」
- **授权级别**：两处**真机缺陷** ⇒ 直接定位根因并落地修复（含守卫防复发）。
- **执行方**：WorkBuddy（门禁/守卫/提交/部署）｜**改动面**：`pages/month` ×2 / `pages/card` ×1 / `cloudfunctions` ×1 / `tools` ×3 / `specs` ×2 / `verify_all.js`
- **门禁**：`node verify_all.js` → **97/97 套件通过，RC=0**（证据 `review/evidence/gate_97_r108.txt`）
- **变异回灌**：**9 条 / 9 条双向成立**，残留 0（详见 §6）
- ⚠️ **本轮一个显著特征：零术语改动**。`terms.js` **一个字节都没动**（双副本 md5 不变）—— 缺陷在**引用侧**（页面没把已有的术语映射进来），不在定义侧。

---

## 1 两条诉求 → 两个根因

| # | 李老师说的 | 根因 |
|---|---|---|
| R1 | 「启用分期摊销」开关**关不上，会自动弹回打开** | 🔴 摊销页从 **`app.globalData.switches`（前端缓存）** 读开关，而该缓存**只在 `getShopContext` 时写一次**、保存开关后**没有任何人刷新它** ⇒ 保存后 `load()` 重拉时**读回旧值 `true`** ⇒ 开关自己弹回。**口径本身没错**（「关掉 ⇒ 摊销不计入利润」引擎里实现着），错的是**入口的真相源** |
| R2 | 「再投一笔」下面按钮**纯蓝色、没有文字** | 🔴 `amortize.js` 的 `t` 块写的是 `amortAdd: TERMS.amortizePage.amortAdd`，而 `terms.js` 里**根本没有 `amortAdd` 这个键**（术语本体是 `amortizePage.add` =「新增摊销资产」）⇒ `undefined` ⇒ WXML 把 `{{t.amortAdd}}` **静默渲染成空串**。**不报错、不崩、只是变空** |
| R3 | 「整个设计思路非常好，给你点赞」 | 非任务项 —— 确认 round107 的方向（台账化 + 表单搬出弹层 + `inset` 真因修复）被接受 |

## 2 根因一：WXML 对 `{{undefined}}` **不报错**，静默渲染成空（**同族病第 27 例**）

### 2.1 为什么「96 个套件全绿」也照样漏

这是本仓「**页面这一层没有任何套件读它**」的第 3 例，与前两例完全同型：

| 轮次 | 症状 | 当时的套件为什么抓不到 |
|---|---|---|
| round100 | WXML 属性泄漏（真机渲染出英文属性串） | 没有套件读 WXML 属性面 ⇒ 后补 **R123** `check_wxml_structure` |
| round107 | 我把 `.map` 三元括号写坏 | **R122** `check_js_syntax` 只验「能不能编译」 |
| **round108** | **术语键漏映射 ⇒ 空白按钮 / 空白文案 / 空白 placeholder** | **R122 只验编译、R123 只验属性有没有错成文本；没有任何套件检查「页面引用的术语键是否真的存在」** ⇒ 本轮补 **R124** `tools/check_page_terms.js` |

### 2.2 同族 grep：一次抓出 6 处同类（均已修）

| 文件 | 缺失的映射 | 真机症状 |
|---|---|---|
| `pages/month/input.js` | `scopeShow` | 口径引导文字「怎么填？点开看口径」**空白** |
| `pages/month/input.js` | `scopeHide` | 「收起口径」**空白** |
| `pages/month/input.js` | `classTotalSuffix` | 小计后缀消失（「食材合计」变成「食材」） |
| `pages/month/input.js` | `presetHintPrefix` | 预设项提示前缀消失（「还没加的有：」变成裸清单） |
| `pages/month/input.js` | `dmChannelPh` / `dmAmtPh` | 堂食分项的渠道名/金额 **placeholder 空白** |
| `pages/card/edit.js` | `dishNamePh` | 菜品名输入框 placeholder「如 宫保鸡丁」**空白** |

> 说明：这些键在 `terms.js` 里**一直存在**，只是页面没映射进来 —— 属于「定义侧没问题、引用侧漏了」。

### 2.3 反查型守卫的锚定坑（本轮踩到）

`src.indexOf('t: {')` 会**误命中** `saveAsset({ asset: {` 里的伪 `t: {`
⇒ 必须锚定**行首缩进**：`/^[ \t]*t[ \t]*:[ \t]*\{/m`。
（首版探针因此报了 34 处候选，修正后收敛到 **9 处**真候选。）

## 3 根因二：前端缓存当真相源 ⇒ 开关「关不上」

### 3.1 改前：本仓三层的开关真相源现状

| 消费点 | 来源 | 判定 |
|---|---|---|
| 录入页库存开关 | `getLedger` 出参 `sw.inventorySwitchOn` | ✅ 正确 |
| 月度首页 | `d.switches \|\| app.globalData.switches` | 🟡 可接受（有出参兜底） |
| **摊销页** | **只有 `app.globalData.switches`** | 🔴 **缺陷：把缓存当唯一来源** |

### 3.2 修法（与既有正确范式一致）

**让渲染本页的那次云函数调用把权威值放进自己的出参**：

- `cloudfunctions/getAmortSchedule/index.js` 新增出参 `amortize_switch_on`
  （服务端读 `shop_switch.amortize_switch`）；
- `pages/month/amortize.js` 的开关值改认 `d.amortize_switch_on`，
  **删掉**对 `globalData.switches` 的读取与回写。

**纪律**：真理只有一个，而且**必须由"渲染这一次"的调用带出来**。
跨页共享的 `globalData` 缓存**只配当兜底、不配当真相源**。

### 3.3 连带：给这条口径腿补上行为级断言

界面上写着「关掉后，下面登记的摊销资产不计入利润」，而在此之前
**没有任何断言**看这条腿 —— 谁把它删掉都无人报警，而且**失败是静默的**（数字悄悄变大/变小）。
⇒ 新增 **`selftest_batch8b` A9-⑰**（三副本一致性 + 双向数值）。

## 4 落地清单（按文件，共 11 个）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/getAmortSchedule/index.js` | 新增出参 `amortize_switch_on`（服务端权威开关） |
| `pages/month/amortize.js` | ① 删缓存读取 ② 开关认 `d.amortize_switch_on` ③ `amortAdd` 错键 → `TERMS.amortizePage.add` |
| `pages/month/input.js` | 补 5 个从未映射的术语键（`scopeShow`/`scopeHide`/`classTotalSuffix`/`presetHintPrefix`/`dmAmtPh`，另 `dmChannelPh` 同批核对） |
| `pages/card/edit.js` | 补 `dishNamePh` 映射 |
| `tools/check_page_terms.js` | **新增**（R124，8 断言） |
| `tools/check_data_contract.js` | 新增 **C7 组 3 条**（开关「谁是真相源」契约） |
| `tools/selftest_batch8b.js` | 新增 **A9-⑰**（177 → **178**） |
| `tools/selftest_r85.js` | A15 时机关卡**第 5 次触发**登记（沿用既有白名单条目，不新增豁免面） |
| `verify_all.js` | 挂载第 97 套件 + 头部注释同步（96 → 97） |
| `specs/dev-specs/★知识存储点_2026-09-10.md` | 套件数 96 → **97**（5 处口径同步） |
| `specs/dev-specs/core/10_云函数清单与接口契约.md` | `getAmortSchedule` 出参补 `amortize_switch_on` |

## 5 新增守卫 `tools/check_page_terms.js`（R124，8 断言）

两条腿 + 四条护栏：

- **腿①（反查 terms）** `P1-1` 全仓 `TERMS.<组>.<键>` 引用均可解析（零悬空引用）— 解析 **509** 处，全部命中
- **腿②（反查页面）** `P2-1` 每个页面 wxml 用到的 `t.<键>` 都在同页 `t:{}` 里（零静默空白）— 核对 **371** 处用法 / **15** 个页面
- `P2-2` 用了 `t.` 的页面都能静态解析出 `t` 块 ／ `P2-3` `t` 块花括号必须配平
- **自失效护栏**：`S1` 扫描面 `.js` ≥ 20 个（实测 **29**，首版设 ≥40 会红 ⇒ 按实测下调，**不放宽真实判据**）；
  `S2` `TERMS.` 命中 ≥ 400（509）；`S3` `t.` 用法 ≥ 300 且带 `t` 块页面 ≥ 8（371/15）；`S4` 四个锚点文件（含事故现场 `amortize.js`、`input.wxml`）必在扫描面内

## 6 证据

- **门禁**：`node verify_all.js` → **总览：97/97 套件通过**，RC=0（`review/evidence/gate_97_r108.txt`）
  - 关键套件实测：`page-terms` **8/0**、`data-contract` **25/0**（含 C7-1/2/3）、`batch8b` **178/0**（含 A9-⑰）
- **变异回灌 9 条 / 9 条双向成立、残留 0**（逐条转红 → 还原 → 复绿）：
  | ID | 变异 | 期望转红的套件 |
  |---|---|---|
  | M1 | 把 `amortAdd` 改回**不存在的键**（原缺陷） | `page-terms` |
  | M2 | 删掉 `input.js` 里 `scopeHide` 的映射 | `page-terms` |
  | M3 | 删掉 `card/edit.js` 里 `dishNamePh` 的映射 | `page-terms` |
  | M4 | 把新守卫扫描面写窄（去掉 `pages`） | `page-terms`（S1/S4） |
  | M5 | 摊销页改回从前端缓存读开关 | `data-contract` |
  | M5b | **保留**出参引用、但额外读一次前端缓存 | `data-contract`（**单独**证「禁读缓存」这条腿） |
  | M6 | `getAmortSchedule` 出参不再给权威开关 | `data-contract` |
  | M7 | 引擎去掉「关掉 ⇒ 摊销归 0」的口径腿 | `data-contract` + `batch8b` |
  | M8 | 把 `getAmortSchedule` 从 A15 白名单摘掉 | `selftest_r85`（证明时机关卡仍在守） |
- 🔴 **本轮两次自我纠正（如实记）**：
  1. **M2 首跑锚点命中 0 次** —— `input.js` 是 **CRLF**，而回灌脚本按 `\n` 写锚点。
     ⇒ 脚本改为**运行时按目标文件自身行尾替换**（并加 `--dry` 锚点预检，避免白跑 1.5 分钟）；
  2. **C7-2 判据自伤** —— 判据裸扫 `globalData.switches`，而我在 `amortize.js` 里写的**解释性注释**
     （「不再读 `app.globalData.switches`」）正是这串 token ⇒ 把**正确的修复**判成缺陷。
     ⇒ 判据**剔注释**后再扫（round107 的 batch8b A9-② 同款，**第二次踩**）。

## 7 待李老师真机验证（4 处）

1. 摊销页「启用分期摊销」开关 —— **能关上、且不自动弹回**（本轮核心）；
   关上后下面登记的摊销资产**不计入利润**（口径不变）。
2. 「再投一笔」下面那个按钮 —— **有文字**了（「新增摊销资产」）。
3. 录入页 —— 口径引导「怎么填？点开看口径」/「收起口径」文字恢复；
   小计后缀（「食材合计」的「合计」）、预设项提示前缀（「还没加的有：」）恢复；
   堂食分项的渠道金额 placeholder（「填金额（元）」）恢复。
4. 菜品卡编辑页 —— 菜品名输入框 placeholder「如 宫保鸡丁」恢复。
