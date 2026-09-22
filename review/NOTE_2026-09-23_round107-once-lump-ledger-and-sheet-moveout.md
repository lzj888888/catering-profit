# round107 回执 · 「一次性投入」台账化 + 表单搬出底部弹层

- **触发**：李老师 2026-09-23 真机反馈（两句话 + 两张截图），原文：
  > 「摊销 一次性 计入当月，最下面 只有一个框，没有提示，容易被人忽略找不到，点击按月摊销，点编辑，修改数字，**依旧出现透明窗口，无法保存**。我觉得这块你可以考虑如何更好操作以及直观。而且 一开始就出来的是 装修设备，下面是 一次性计入当月，和按月摊销，思考下，直接用装修设备是否最好，毕竟装修 加盟费 等 都有可能摊销，也有可能 **一个月有多次** 的 一次性计入当月。**再好好理顺 思考。找个最佳方案，然后去修改。**」
- **授权级别**：末句 = 出方案并**直接落地**（本轮同时改前端 + 后端契约 + 守卫）。
- **执行方**：WorkBuddy（门禁/守卫/提交/部署）｜**改动面**：`miniprogram/i18n` / `pages/month` / `cloudfunctions` ×5 / `tools` ×5 / `specs` ×4
- **门禁**：`node verify_all.js` → **96/96 套件通过，RC=0**（证据 `review/evidence/gate_96_r107.txt`，193,525 B）
- **变异回灌**：**21 条 / 21 条双向成立**（详见 §6）

---

## 1 四条诉求 → 四个结论

| # | 李老师说的 | 根因 / 结论 |
|---|---|---|
| R1 | 选「一次性计入当月」只出一个框、**没提示**、容易被忽略 | 该分支原来**整块只有一个裸金额框**（round106 补的），既无口径说明也无入口感。⇒ **把表单搬去独立页**，就地只留「口径说明 + 两行摘要 + 一个明确按钮」 |
| R2 | 点编辑、改数字 ⇒ **依旧透明窗口、无法保存** | 🔴 **真因不是底色**（round106 判错了）：是遮罩写了 `inset` **简写**，部分 WebView 内核不支持 ⇒ 整条声明被丢弃 ⇒ `position:fixed` 四向偏移全 `auto` ⇒ 遮罩退回**文档流静态位置**（无全屏深色遮罩、白面板叠在白卡片上 = 「透明窗口」）；再叠加**弹层 × 键盘**（截图 1 面板被键盘整块盖住、截图 2 输入框浮到卡片上）⇒ 看不见、存不了。⇒ **改四向展开 + 表单整体搬出弹层** |
| R3 | 「装修设备」这名字太窄（加盟费/转让费/品牌使用费…都可能摊销） | 段名 **`装修设备` → `一次性投入`**；口径句扩写覆盖「装修、设备、加盟费等」 |
| R4 | 一个月可能有**多次**一次性投入 | 🔴 这是**结构性**问题：原来「一次性计入当月 / 按月摊销」写的是**店铺级** `amortize_switch` ⇒ 结构上排除了「本月既有一笔摊销、又有几笔小额一次算清」。⇒ **怎么进利润表改由「这一行台账」自己决定**（行级 `mode`），两类**可共存**、可多笔 |

## 2 核心设计决定（三条）

### 2.1 「这笔钱怎么进利润表」由这笔钱自己决定 —— 台账行级 `mode`
- `shop_amortize` 每行带 `mode: 'amort' | 'lump'`（缺省/非法一律 `amort`，老数据无字段自动兼容）。
- `saveLedger` 的一次性合计**改为服务端从台账求和**（`shop_amortize` 里 `mode='lump'` 且 `start_month=本月`）⇒ 原 `lump_sum_fen` **前端入参退休**（少一个可变真相源，连带消掉 round106 的 `allowZero` 误传坑）。
- `getAmortSchedule` 把两类**分开返回**：`assets`（摊销）/ `lumps`（本月一次算清）+ `lump_total_fen`。摊销引擎只吃 `mode='amort'` 的行。
- **去互斥**：三副本引擎（`saveLedger` / `getLedger` / `calcMonthlyProfit`）原来的 `amortizeSwitchOn ? 0 : lumpSumFen` 删除。实测（三副本一致）：摊销 50,000 + 一次性 100,000 共存 ⇒ 参考利润 400,000（摊销**不进**参考）、真实利润 350,000、差异 50,000。

### 2.2 表单搬出底部弹层 → 新建独立页 `pages/month/assetEdit`
- 弹层已从 `amortize.wxss` **整体移除**（`.mask` / `.sheet` 一个不留）；新增/编辑/再投一笔/删除一律跳独立页（M3 `pages/card/edit` 已是同款先例）。
- 独立页按 `kind='lump'|'amort'` × `mode='new'|'edit'|'append'` 三态：一次性投入叫「计入月份」、摊销叫「开始月份」；摊销多出「总月数 / 终止月份」；预填**一律回源** `getAmortSchedule`（不靠上一页塞对象）。
- 摊销页改双区块：**① 本月一次算清**（清单 + 合计 + `+ 记一笔`）/ **② 分期摊销**（开关 + 分组卡片 + `+ 再投一笔`），页顶保留「本月摊销合计」。

### 2.3 `inset` 简写全仓清掉（真因修复）
- 全仓仅 2 处（`amortize.wxss` 的 `.mask`、`input.wxss` 的 `.paste-mask`）⇒ 均改四向展开 `top/right/bottom/left`。
- 新守卫**根因级**扫这 5 个含遮罩/面板的 WXSS 的**代码面**（剔注释）。

## 3 落地清单（按文件）

**术语双副本**（`miniprogram/i18n/terms.js` ⇄ `specs/dev-specs/i18n/terms.js`，md5 一致 `ab5a111174129fcfd528fed40462266c`，47,974 B）
- 改：`assetTitle` `② 装修设备` → **`② 一次性投入`**；`assetGo` → `去登记 / 管理`；`assetHint` 扩写；`amortizePage.title` → `一次性投入`；`scopeHint` 重写。
- 删（8 个）：`assetOnce` / `assetOnceDesc` / `assetOnceField` / `assetOnceFieldHint` / `assetAmortize` / `assetAmortizeDesc` / `assetCount` / `assetEmpty`。
- 新增：`assetLumpSum` / `assetAmortSum` / `assetSumEmpty`、`lumpSection*` / `amortSection*` / `edit*` / `f*`（表单字段）等。

**前端**（仓根 = 小程序根）
- 新增：`pages/month/assetEdit.{js,wxml,wxss,json}`；`app.json` 注册（第 **15** 页）。
- 重写：`pages/month/amortize.{js,wxml,wxss}`（双区块，删弹层与全部表单 state）。
- 改：`pages/month/input.{js,wxml}`（删二选一卡片 / 删 `lumpSumYuan` state 与 `onLumpSum` / 删提交里的 `lump_sum_fen` / `loadAssetCount` 改两行摘要 / `onPickMethod` 去掉 amortize 分支）、`pages/month/input.wxss`（`inset` → 四向）。

**后端（5 函数 8 文件）**
- `saveAsset/validate.js`：新增 `mode`（缺省 `amort`）+ **删除分支**（只认 `asset_id + delete:true`）。
- `saveAsset/index.js`：新增删除（软删不可复活）+ **台账归档锁**（与 `saveLedger` 同一把 `ARCHIVED_LOCKED`）+ 写 `mode`。
- `getAmortSchedule/index.js`：拆 `assets` / `lumps` + `lump_total_fen` + `is_archive`。
- `saveLedger/index.js`：台账求和（`effectiveLumpSumFen = ledgerLumpSumFen`）+ 删死函数 `num0`（入参退休后无调用）。
- `saveLedger/validate.js`：删 `lump_sum_fen` 入参解析与回传。
- 三副本引擎（`saveLedger` / `getLedger` / `calcMonthlyProfit` 的 `service.js`）：去「与摊销互斥」。

**守卫（5 个套件）** —— 只重写、不删除，条数不变
- `selftest_batch8b`：B1 年月 picker 换宿主 `assetEdit`；A9-① 从「底色」改**根因级**（`inset` 简写）；A9-②③④⑤ 改为「独立页 + 反转腿（不得再有 `lumpSumYuan` / `lump_sum_fen`）」；A9-⑩ 改两行摘要；A9-⑯ **反转为「可共存」**。
- `selftest_batch8c`：H1 组 6 条换宿主/换 handler 名（`onEdit` → `onEditAsset`），其中「编辑保留组归属」反转为「**不回写**组键」。
- `check_data_contract`：C5 守点从已退休入参**平移**到 `saveAsset.mode` 缺省语义 + 删除分支；**新增 C6 组 3 条**守台账行级 `mode` 契约。
- `selftest_ui_fix`：`核算方式单源` 锚点 a 改**语义级**（不绑 handler 名、不绑 `data-kind` 取值）。
- `selftest_r85`：A15 时机关卡**第 4 次**登记（新增 `saveAsset/`；**不放宽成全豁免**）。

**陈述面同步**（`specs`）
- `上线材料_提审材料包_v1.md`：§4 登记第 15 页 `pages/month/assetEdit`（审核材料缺页 = 真缺陷）；§1/§3 页数 14 → 15；静态自检段去掉**无法复现**的「19 处」，换成可用命令复现的定性结论。
- `core/10_云函数清单与接口契约.md`：5 行（`saveLedger` 入参退休 / `getAmortSchedule` 两类出参 / `saveAsset` `mode`+删除 / `getLedger` 出参 / `calcMonthlyProfit` 引擎参数说明）。
- `★知识存储点` + `core/13`：**历史陈述保留原数字**（14 页），加「此前」明示其为历史快照（改数字 = 伪造历史）。

## 4 两类红点的处置（纪律：先判真缺陷 vs 陈旧断言，不许改代码迎合）

**首跑 88/96，8 个红套件分成两类：**

### 4.1 真缺陷（2 个，其中 1 个是我自己引入的）
1. 🔴 **`js-syntax`：`pages/month/amortize.js:198` 语法错** —— 我重写时把三元表达式写坏：
   `.map((g) => (g.key === key ? Object.assign({}, g, { expanded: !g.expanded })) : g)` ——
   `:` 被关在箭头函数体的括号**外**。对照 HEAD 版确认原写法是 `... } ) : g))`，是我打错的括号。
   **该守卫在首跑当场抓到** —— 这本身就是「前端语法零覆盖区补上了」的最强证据（R122 的根因就是同一类错误曾让小程序起不来而门禁全绿）。
2. 🔴 **`page-manifest`：第 15 页未登记进提审材料 §4** —— `pages/month/assetEdit` 加了页面却漏登记 = **审核材料缺页**（审核问询面）。补登记 + 页数 14 → 15（当前态 4 处 + 弱面 1 处）。

### 4.2 陈旧断言（6 个套件，守的是本已被李老师否决的 round106 旧设计）
- **旧设计三宗罪**：① 二选一写的是**店铺级**开关 ⇒ 结构上排除两类共存；② 一个月只能记**一笔**；③ 表单在弹层里 × 键盘 = 操作死结。
- ⇒ 这 6 个套件里的相关断言**前提已废**，逐条重写为「守新契约 + 反转腿（防旧实现照搬回来）」，**覆盖面只增不减**：
  - `selftest_ui_fix`（1 条）、`selftest_batch8b`（7 条）、`selftest_batch8c`（6 条）、`check_data_contract`（3 条）
  - `selftest_r85`：A15 **时机关卡**（第 4 次），按白名单**显式登记**（`by=WorkBuddy / date=2026-09-23 / reason=round107 授权拆台账行级 mode`）
  - `suite-assert-counts`：**连带**（套件 rc≠0 时解析不到通过数）⇒ 源头修完全绿

**证据**：`selftest_batch8b` 的「A9-⑦⑧⑨⑫⑬⑭」（留存数据 `progressOf` / 引擎同源 / 页面零硬编码）**全程未红** —— 说明重写只动了「旧设计那部分」，真守卫没被顺手删掉。

## 5 自我纠正（本轮推翻的既往判断）

| # | 既往结论 | 本轮纠正 | 依据 |
|---|---|---|---|
| ① | round106：透明窗口的**主因是底色**（`.sheet` 与 page 同值） | **不是底色**，主因是 `inset` 简写被内核丢弃 ⇒ 遮罩丢定位 | 两张真机截图 + 全仓只有那 2 处用 `inset`、恰好就是出问题的遮罩 |
| ② | round106：一次性投入**与摊销互斥**（防同一笔算两遍） | **互斥是错的** —— 它会把「既摊着装修、又买了个小东西」里的后者**悄悄丢掉**（不报错、利润虚高） | 李老师真机反馈 + 三副本实测 |
| ③ | 弹层 + 5 字段「能用」（round106 只改了底色） | **结构性死结**，必须搬出弹层 | 截图 1 面板被键盘盖住、截图 2 输入框浮到卡片上 |
| ④ | 提审材料「19 处页面跳转」 | 用现有算法复现不出该数字（实测 22 调用点 / 27 字面量 / 唯一目标 15） | 不猜：换成可用命令复现的定性结论（越界 0 / switchTab 0） |

## 6 变异回灌（21 条，全部双向成立）

做法：**逐条独立**变异 → 只跑对应套件 → 判「该条是否转红且命中期望文案」→ **立即还原** → 复跑确认复绿。
自动脚本（含 `try/finally` 强制还原 + 残留哨兵扫描：`lumpX` / `ARCHIVED_UNLOCKED_X` / `assetAmortLine107` 等 7 个串，实测残留 **0** 处）。

| # | 变异（把行为改回错误写法） | 期望转红 |
|---|---|---|
| 1 | `.paste-mask` 改回 `inset: 0` | A9-① |
| 2 | `amortize.wxss` 加回 `.mask { position: fixed }` | A9-② |
| 3 | `input.js` 加回 `lumpSumYuan: ''` | A9-③ |
| 4 | 提交里加回 `lump_sum_fen: 0` | A9-④ |
| 5 | `assetEdit.js` 的 `mode` 写死 `'lump'` | A9-⑤ |
| 6 | 两行摘要删一行 | A9-⑩ |
| 7 | 引擎加回 `amortizeSwitchOn ? 0 : lumpSumFen` | A9-⑯ |
| 8 | 开始月 picker 退回手输 `<input>` | B1 |
| 9 | 再投一笔不写 `group_id` | b8c 组归属 |
| 10 | 编辑期回写 `group_id`（旧写法回退） | b8c 反转腿 |
| 11 | handler 名回退 `onEditAsset` → `onEdit` | b8c 每笔操作 |
| 12 | 三态标题退化为单态 | b8c 表单标题 |
| 13 | `saveLedger/validate.js` 出参复活 `lumpSumFen` | C5-1 |
| 14 | `saveAsset` 的 `mode` 缺省语义失灵（`mode = a.mode`） | C5-2 |
| 15 | 删除分支失效（`false && a.delete`） | C5-3 |
| 16 | `saveLedger` 侧 `'lump'` 契约字面量改 `'lumpX'` | C6-1 |
| 17 | `getAmortSchedule` 两类不分（`assets = rows`） | C6-2 |
| 18 | `saveAsset` 摘掉 `ARCHIVED_LOCKED` | C6-3 |
| 19 | 去「一次性投入」页的入口指向不存在的页 | ui_fix |
| 20 | 提审材料 §4 删掉第 15 行 | manifest Q4-② |
| 21 | 改一个**非豁免**云函数（`getMonthList`） | r85 A15 |

（另有 1 条**天然回灌**：`js-syntax` 首跑即抓到我引入的括号错 —— 见 §4.1。）

## 7 未闭环 / 待李老师

1. **真机验证**：门禁全绿 ≠ 真机能跑（本仓铁律「三层绿≠真云能跑」）。本轮已出预览码，**待李老师在真机上点一遍**：登记一笔一次算清 + 一笔摊销 ⇒ 看两行摘要与「本月摊销合计」是否对、编辑/删除是否可用、不再有透明窗口。
2. **部署**：`saveAsset` / `getAmortSchedule` / `saveLedger` / `getLedger` / `calcMonthlyProfit` 需部署（一次一个、必带 `-r`）。
3. 遗留单列项（非本轮范围）：P5 规范 3 字段落库 / P6 打包费（等外卖结算图）/ D6 链式重算 / F3 复现（本轮已由 `inset` 根因部分解释，待真机回归确认）。
4. 仓根 + `review/evidence/` 下约 40 个历轮未跟踪临时脚本，**等李老师点头再清理**。

---

*回执生成：2026-09-23（本机 git 提交时间与 `new Date()` 均为 09-23；系统提示注入的 09-21 为过时值，已按硬证据校正）*
