# round56 · 自驱动巡检（自动化轮次 · 2026-09-20 03:02–03:4x）

> 执行方：自驱动自动化（WorkBuddy）。仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`。
> 本轮性质：**与一个活跃的并发写入方同场**（它不是 InsCode —— 见 §2）。
> 本轮定位 = **补上一个真守卫缺口（禁用词表零守卫）+ 独立变异回灌 + 并发方产出复核**，不抢写。

## 1. 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | SQLite：`inflight_turn` 无行；`message_count=1465`（与 r51/52/53/55 **五连持平**）；`idle_sec=129439`(35.96h)；末条审批 `approved_once` 非 pending | **idle** ⇒ 不投喂（8 批已收官，无批次 8） |
| dsh | hwnd 855322，`rect[0]=-32000` ⇒ 最小化 | **不可用（第 10 轮）** ⇒ 不投递 |

证据：`review/evidence/selfdrive_20260920_r56/probe_agents_r56.txt`

### 1.1 dsh 根因（纯只读，未动 GUI）

- `/` 与 `/v1/models` → 200（**SPA 兜底，无效信号**）；`/api/sessions` `/api/health` → **全 404**
- `https://api.deepseek.com` → **401** ⇒ 上游可达仅缺鉴权 ⇒ **排除「断网 / 额度耗尽」**
- `.dsh/web.log` mtime `09-17 02:59:56` ⇒ **72.12h 前**；dsh 进程 `CreationDate=20260917030702` ⇒ uptime **72.0h**
  ⇒ `web.log` mtime ≈ 进程 uptime：**该实例自启动起零业务写入**（round52 判据⑤，比「现在不动」强一档）
- `storages/session_projcache.json` `17.77h` 静止
- ⇒ 结论：长跑进程内部会话加载超时。**方案 D（允许重启 dsh web）** 证据继续加固；无人值守仍未动手。
- 不投递的第二条独立理由：当前会话上下文与餐饮小程序仓库**非同一主题**（投递＝上下文污染）。

## 2. 🔴 并发写入方：**本轮轮中出现，且它不是 InsCode**

- 03:07 首次 `git status`：**tracked 改动为零**（上轮 round55 的 25 个他人 `M` 已被其自行提交）。
- 03:23 变异跑完后第二次 `git status`：冒出 **7 个我没动过的 `M`**
  （`app.wxss` / `pages/month/input.wxml` / `input.wxss` / `result.js` / `tools/selftest_batch8b.js` / `utils/api.js` / `utils/paywall.js`，103 增 36 删）。
- mtime 链条：`03:10:34 → 03:16:14 → 03:17:09 → 03:17:34 → 03:21:21 → 03:22:20 → 03:31:52`（terms.js 双副本）。
  ⇒ **在我作业全程持续写入**，且 03:31:52 仍在写（距今 1 分钟）。
- **归属判定（三条独立证据）**：
  ① 探针在 03:02 与 03:24 两次均 `inflight=0`、`message_count=1465` **未涨** ⇒ **不是 InsCode**；
  ② 我的 sed 目标只有 `terms.js`×2 / `pages/index/index.wxml` / `index.js`，与这 7 个文件**零交集**，且全部已 `git checkout` 还原；
  ③ git 警告 `LF will be replaced by CRLF` ⇒ 这 7 个文件当前是 LF、由**外部工具写入**（与 round53 观察到的并发方特征一致）。
- ⇒ 判定：**另一会话（AI 类，逐轮 Edit、无常驻进程）**。按 §0.7 全程降级**只读旁观**：
  不点 GUI、不跑 `cli`、不 `git add -A`，**只路径级提交我方文件**，不代修不代提交他人产出。

## 3. 🟢 本轮核心：补上「禁用词表零守卫」这个真缺口（round55 点名的待办 ⑥）

### 3.1 缺口复核（round55 结论是否正确？—— 我方也按「不采信上一轮」复扫）

- `grep -rln "forbidden" tools/ specs/dev-specs/prototype/` ⇒ **零命中**；SUITES 无术语套件
  ⇒ round55 的判断**成立**：`TERMS.forbidden` 6 条 13 个关键词**没有任何机器判据在查**。
- 但 round55 设想的判据「只扫 wxml 可见文案」**方向不够**（本轮实扫证伪）：
  裸扫 `pages/*.wxml` 14 个文件只有 **1 处「付费」**，且它在 `pages/month/index.wxml:27` 的 **HTML 注释**里；
  **「盈利」零命中** —— 因为本仓 wxml 已全面走 `{{t.xxx}}` 数据绑定，真文案躺在 `miniprogram/i18n/terms.js`。
  ⇒ **只扫 wxml = 扫了个空壳**。这是本轮对上一轮方案的**实质性更正**。

### 3.2 新守卫 `tools/check_terms_forbidden.js`（13 条 / 段 9，已挂 SUITES 第 68 项）

- **扫描面 A（文案源）**：递归收集 `TERMS.*` + `ERROR_MESSAGES.*` 的叶子字符串（447 条，纳入扫描 423 条）。
  排除两项，且**每项都写明理由**：`TERMS.forbidden` 子树（判据本体，扫它恒红）、`*.internal`（术语双轨的内部术语）。
- **扫描面 B（硬编码）**：`pages/**/*.wxml` 剥 `<!-- -->` 注释后的可见文案（含属性值）⇒ 守「页面文案不得硬编码」。
- **三档处置**：`EXEMPT`（有拍板依据）/ `DEFERRED`（真实冲突、我方无权自决，**打印 ⚠️ 不判红**）/ 其余 = 硬违规判红。
  每条豁免**必须带 by/date/reason**，缺一即红（T7）⇒ 防「静默放宽」。
- **双向防腐（T6）**：`EXEMPT ∪ DEFERRED` 中**没有对应实际命中**的条目也判红（僵尸豁免）
  ⇒ 命中集合 ≡ 处置集合，两边都动不得。这是「豁免显式且不腐」的机械保证（思路沿用 round53 的 `comm -23` 双向 diff）。
- **T4c 排除项的前提也守**：`*.internal` 被排除的前提是「页面从不渲染 internal」——
  实证 `grep -rn "\.internal" pages/ admin-h5/` 零命中（页面只用 `.display`/`.subtitle`/`.navTitle`，见 `pages/index/index.js:11-16`）。
  ⇒ **排除项必须连它的前提一起守**，否则「排除」就是开后门。

### 3.3 实扫真值：「缺守卫」与「已违规」是两件事

- 对外可见文案层面**当前零真正违规**。
- 但有 **6 处真实冲突待李老师裁决**（已全部在 T8 段明示，不判红）：
  1. `auditSafe.disclaimer` <<投资>>：官方免责话术「不构成任何投资…建议」与 forbidden[4] 字面冲突，改词会削弱免责效力；
  2/3/4. `m2.redAlert` / `sandboxResult.redAlert` / `ERR.M2_RED_ALERT` <<盈利>>：「无法盈利 / 难以盈利」是**否定式**风险提示，与 forbidden[3] 的 reason「收益承诺」实质不符；
  5. `pay.subscribeTip` <<订阅>>：微信官方「订阅消息」能力名，非付费订阅；
  6. `exp.switchHint` <<付费>>：否定式「不会触发任何付费弹窗」，非付费入口。
- `admin-h5/index.html:226` 有 1 处「付费」⇒ **显式声明为范围外**（内部后台，不进小程序审核），不静默放过也不误报。

### 3.4 变异回灌（6 组，全如期；还原一律 `git checkout`）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| M1 | `terms.js` 双副本注入「躺赚」到 freeHint | T5 红 | ✅ RC=1，`❌ T5 … 3 处`（另 T1b 因 sed 字节差同时红，已还原） |
| M2 | 判据本体抽掉（`forbidden` → `forbiddenX`） | T2 红（fail-closed） | ✅ RC=1，`❌ T2 forbidden 是数组且非空 · undefined` |
| M3 | `DEFERRED` 加一条无对应命中的僵尸条目 | T6 红 | ✅ RC=1，`❌ T6 … TERMS.zzzNoSuchKey <<盈利>>` |
| M4 | `pages/index/index.wxml` 硬编码「躺赚神器」 | T4b 红 | ✅ RC=1，`❌ T4b … pages/index/index.wxml:29 <<躺赚>>` |
| M5 | **反向**：同上但写进 `<!-- -->` 注释 | T4b **仍绿** | ✅ RC=0，`✅ T4b … 0 命中`（证明剥注释不是把判据改窄） |
| M6 | 页面改渲染 `.internal`（破 T3 排除项的前提） | T4c 红 | ✅ RC=1，`❌ T4c … pages/index/index.js:11` |

还原后复跑 RC=0 / 13 通过 0 失败。

## 4. 🟡 顺带复核并发方对 `tools/selftest_batch8b.js` 的「放宽判据」（未提交，进行中）

- 它把 A1 判据从「锁 `label: '运营'` 等展示文案」改为「在 expense 块内按 `category` 判定」⇒ **改对了**：
  `category` 是后端契约锚点，label 是展示文案；锁展示文案会「逼得人不敢改显示文案」，且挡不住 category 被改名这种真回归。
- 它把 E1 判据从「锁 `incomeHint` 原文 = 收入按当月实际到账金额填写」改为「字段存在且渲染 + ≥10 字」，
  并**新增一条口径守卫**：收入必须是权责发生制（须含「出了餐就算」、不得含「按当月实际到账金额填写」）。
- **我方独立验证它这个理由是否成立**：用 HEAD 版（锁旧原文）跑当前工作树 ⇒ **失败**；
  工作树新版 ⇒ **49 通过 / 0 失败 RC=0**。
  ⇒ **它的理由成立**：旧判据锁死了**一条违反规范 A.0-1 权责发生制的错误原文**
  （`specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md:12`），
  谁去修正错误口径守卫就红谁 ⇒ **旧守卫是错误口径的保护伞**。放宽 + 补口径守卫 ⇒ 综合强度不降反升。
- 🟡 **判据强度评审（§0.3 ⑤⑥）**：新版 E1 的「≥10 字」是**写死的弱判据**（填 10 个数字也能过）。
  但有口径守卫兜底（口径退回即红）⇒ **综合合格，不要求改**；仅登记为已知弱点。
- ⚠️ 该改动**尚未提交且仍在进行中**（03:31:52 还在改 terms.js）⇒ **不代修、不代提交、不代做变异**，
  待其落定后按「队列清空≠无活」定式复核（见 §6 待下轮）。

## 5. 门禁

- `node verify_all.js`：套件数 **67 → 68**。
  - 首次接入时我的套件被 **R66 判「T3 段标题下零断言」** ⇒ 属技能 §0.10 明写的**预期红**（R92/R66 两条自校验现场生效），
    修法 = T3 段补一条当场打印的 `check()`（扫描面非空且两个文案源都覆盖到），不是改判据迎合。
  - `[terms-forbidden] ✅ PASS (✅ 13 条 / 段 9)`。
- `node specs/dev-specs/prototype/check_error_codes.js`（A–L）：**RC=0**。
- ⚠️ **本机与已推版本会不一致**：本机工作树含并发方 7~9 个未提交改动，
  `batch8b-features` 在 03:30 那一跑是红的（并发方新增口径守卫、terms.js 尚未改完），03:32 复跑已转绿。
  ⇒ **该红归属并发方中间态，我方未做任何「改代码迎合守卫」的动作**（铁律：守卫红先判真伪，不许迎合）。

## 6. 待下轮

1. 🔴 **李老师裁决 6 项禁用词冲突**（§3.3）：否定式表述是否整体豁免 / 词表是否收窄（投资→投资回报、订阅→订阅会员）。
2. 🔴 **dsh 四选一仍未定**（A 放开写+node / B 改只读判据 / C 退场 / **D 允许重启 dsh web**）⇒ 已 **10 轮**不可用，round39 等 5 份 NOTE 复审仍悬。
3. 🟡 **并发方 7~9 个未提交改动待复核**（`app.wxss` / `pages/month/*` / `utils/api.js` / `utils/paywall.js` / `tools/selftest_batch8b.js` / `terms.js` 双副本）
   —— 按「队列清空≠无活」定式：落定后 `git diff` 逐批复核 + 独立变异回灌（本轮因它仍活跃未做）。
4. 🟡 **`c24e0a2` 守卫改语义级**（round55 待办 ⑦：绑死 `inventorySwitch|amortizeSwitch` 旧 key 名）仍未动。
5. 🟡 建 prod 时提醒：重走 R86 定值与回读 + 替换 `ENV_MAP.prod` 占位符；隐私政策按 **6 处**填（旧清单会漏 2 项）。
6. 🟢 1000+ 张并发方过程 PNG（`review/evidence/r86_timeout_20260919/`）仍待李老师定夺（不代提交不代删）。

## 7. 回执

（见文末「回执」小节，提交前写入）
