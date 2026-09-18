# 批次 8c · 用户两大诉求 + 批次 8b 独立核验 · 2026-09-18

本轮做了三件事：① 独立核验 InsCode 交付的批次 8b；② 部署 40 个业务云函数到 dev（消 G 根因）；
③ 按用户两条新诉求实现批次 8c（摊销资产多次采购「二次摊销」+ 填表引导口径）。

---

## 一、批次 8b（InsCode 交付）独立核验 —— 全绿

工作树 20 改 + 1 新增（未提交态）时跑全量门禁：

| 命令 | 结果 |
|---|---|
| `node verify_all.js` | **60/60 套件通过**，RC=0 |
| `node specs/dev-specs/prototype/check_error_codes.js`（门禁 A–L） | RC=0 |
| `node tools/check_schema_sync.js` | 64 通过 / 0 失败 |
| `node tools/sync_common.js --check` | 42 目录 ≡ 单源 |
| `node tools/check_requires.js` | 603 个 .js 全可解析 |
| `node tools/check_pages.js` | 14 ≡ 14，无孤儿 |
| `node cloudfunctions/saveLedger/selftest.js` | 27 通过 / 0 失败 |
| K11 i18n 双副本 | md5 相同 `f8453d2b…` |
| `cloudfunctions/common/` | **零改动**（`git status` 空） |
| 新增代码硬编码中文扫描 | 页面侧 0 命中（新增行仅注释含中文） |

模拟器侧（IDE 自动化 `ws://127.0.0.1:9420`）取证见 `8b_pages_input_after.png`：
录入页已渲染 A2 二级细项结构（堂食▸ / 外卖▸ / 其他业务收入▸ / 费用 运营▸ 人工▸ **营销**▸ 其他▸）
与 E1 引导句（收入/费用各一句），证明「营销」大类与细项机制确实生效。

> ⚠️ 诚实留档：`8b_firstpass_scratch.json` 是**我第一版核验脚本的失败输出**，其中
> 「A2 大类可展开 未命中 / A2 大类行可点展开 timeout」是**脚本自身缺陷**（正则只匹「细项|展开」，
> 没考虑折叠态只渲染 `▸` 标记；且一次 tap 超时后同连接后续页面全部 `rawPath null` 时序错位）。
> 以「每页独立连接」重写后，页面真实文本证明 A2/A1 均已生效 —— 教训：**核验脚本也会骗人**。

## 二、云函数部署（dev `cloud1-d4gphpoxy337f2a25`）—— 42 ≡ 42

之前 dev 只部署了 `initDb` + `smokeTest`（= 走查报告里 G 类缺失的根因：**代码在仓库里、云端没有**）。
本轮按用户授权把 40 个业务函数全部部署：

```
$ cli cloud functions deploy -e <dev> --project <repo> --names <批次 5 个> -r
```

- 首轮普遍报 `FailedOperation.UpdateFunctionCode: 当前函数处于Creating状态` —— **创建与改码竞态**，
  属瞬时错误：函数已在创建、代码更新被拒。重试即好（脚本按「5 个一批 + 失败重试」推进）。
- 末次核验（`cloud_functions_list.txt`）：**云端 42 ≡ 本地 42，双向差集为空**
  （40 业务 + `initDb` + `smokeTest`）。
- 收尾对 8c 改过的两个函数做了增量重传：`saveAsset`、`getAmortSchedule`（均 deploy success）。
- ⚠️ 遗留：`initDb` 的目标超时值（建议 ≥20s；`smokeTest` ≥10s、导出类 60s）**只能人在控制台改**，
  命令行改不了（云侧配置），`config.json` 内写 `timeout` 不被采纳（前面轮次已实测证伪）。

## 三、批次 8c 实现（本轮自研，非 InsCode 交付）

> 起因：InsCode 桌面端窗口本轮**不接受任何注入输入**（SetCursorPos 生效但 mouse_event 点击、
> Ctrl+V 键入均不触发 UI 变化，hover 无高亮，PostMessage 直投 render widget 亦无效）——
> 用户已授权「全权推进、不打断」，故本轮由我按同一套门禁纪律直接实现。

### H1 ·「二次摊销」= 同一资产多次采购，新增采购也单独摊

用户原话口径：固定资产不是一次买完的（装修先投 30 万，半年后又追加 8 万；设备分批采购），
**每一次采购都是一笔独立投入，从各自采购月起、按各自月数独立起摊**。

实现（**零改动摊销引擎**，用「一行资产 = 一笔采购」承载）：

| 文件 | 改了什么 |
|---|---|
| `cloudfunctions/saveAsset/validate.js` | 新增可选 `group_id`（归组键）/ `batch_seq`（组内第几笔，≥1 整数）；缺省 `''`/`1`；拒 `batch_seq` 的非整数/字符串/0；拒 `group_id === asset_id`（自指） |
| `cloudfunctions/saveAsset/index.js` | 新增/追加分支落库带 `group_id`/`batch_seq`；**编辑分支仅在 group_id 有值时覆盖**（编辑单笔/报废单笔不把多笔拆散） |
| `cloudfunctions/getAmortSchedule/index.js` | 读台账归一（老数据 → `''`/`1`）并透传给前端 |
| `pages/month/amortize.js` | `buildGroups()` 按 `group_id \|\| asset_id` 聚组；`onToggleGroup()` 展开看每笔；**`onAppend()` 追加采购**（沿组名、起摊月默认当前月、`batch_seq = count+1`）；编辑/报废保留组归属 |
| `pages/month/amortize.wxml` | 组卡片：`共 N 笔采购` + `合计原值` + `本月摊`；展开后每笔 `第 N 笔` 各自 编辑/提前报废；新增 `+ 追加采购` 按钮；表单标题区分 新增/追加采购/编辑 |
| `pages/month/amortize.wxss` | 分组明细样式（`.batch` / `.batch-title` / `.batch-head` / `.scope-hint`） |

**为什么这样最稳**：现有引擎本就是「每个资产独立算当月摊销 + 独立末月尾差倒挤、绝不合并」，
多笔 = 多行 ⇒ 天然满足「新增采购也单独摊」，且**三份引擎副本（`calcAmortize/service.js`、
`getAmortSchedule/service.js`、`saveLedger/service.js`）一个字节都不用改**。
自测里为此加了硬护栏：三份副本内出现 `group_id`/`batches` 即判红。

### H2 · 填表引导：每类「包括 / 不包括」+ 顶部「填写口径」

| 文件 | 改了什么 |
|---|---|
| `miniprogram/i18n/terms.js`（+ specs 双副本） | 新增 `incomeScope`（堂食/外卖/其他，各一句「包括…；不包括…」）、`expenseScope`（运营/人工/营销/其他）、`fillGuideTitle`、`fillGuide` 5 条 |
| `pages/month/input.js` | `initGroups()` / `rebuildFromItems()` 给每类挂 `scope`；新增 `fillGuideOpen` 状态与 `onToggleFillGuide()` |
| `pages/month/input.wxml` | 顶部「填写口径」折叠块（默认收起）+ 每类口径句 `{{g.scope}}` |
| `pages/month/input.wxss` | `.fill-guide*` / `.scope` 样式 |

要点：外卖/团购佣金明确「不要在收入里扣，记到费用·营销」；会员充值预收「没消费不算收入」；
食材采购不计费用（走库存倒轧）；设备/装修/**加盟费**金额大走摊销资产（与 H1 咬合）；
口径 5 条含「同一笔钱只填一次」。

### 8c 门禁（`gates_8c.txt`）

| 命令 | 结果 |
|---|---|
| `node verify_all.js` | **61/61 套件通过**，RC=0（新增 `batch8c-amort-batches`） |
| `node tools/selftest_batch8c.js` | **56 通过 / 0 失败** |
| 门禁 A–L / schema / pages / compliance / selftest-shape / sync_common / requires / idempotency / stale-claims | 全 RC=0 |
| `saveAsset` / `getAmortSchedule` / `calcAmortize` selftest | 43、7、57 通过 / 0 失败 |
| K11 双副本 | 逐字一致（md5 `498924867d7d1a9f71f342a09b8d8678`） |
| `cloudfunctions/common/` | 零改动 |
| 套件计数同步 | `verify_all.js` 头注释 + `★知识存储点` 两处 60 → **61** |

## 四、模拟器视觉复核（2026-09-18 12:2x 补做 · 已闭环）

李老师把开发者工具与 InsCode 桌面端都打开后，本轮补完 8c 的视觉复核。此前卡住的原因已定位，
并留下两条可复用的交付纪律。

### 4.1 环境恢复（做对了才通）

| 现象 | 处置 |
|---|---|
| IDE / InsCode 窗口 `GetWindowRect` = `-32000` | **只是被最小化**（不是进程死亡）；`ShowWindow(hwnd, SW_RESTORE)` 即恢复 |
| 首屏 `settings.json` 未保存弹窗 | 点「**不保存**」（不写用户磁盘） |
| `cli auto --project … --auto-port 9420` 回显 `√ auto` 但 9420 **无监听** | 加 **`--trust-project`** 后 9420 正常监听 ⇒ **交付纪律：auto 要带 `--trust-project`** |
| `cli close --project` 之后截图黑/空 | 项目窗口关闭会**重建窗口 ⇒ 句柄会变**（7738478 → 3151442）⇒ 截图脚本必须每次重新枚举 |

### 4.2 新发现的工具坑（automator「写后读」必超时）

| 操作类型 | 实测 |
|---|---|
| 读：`reLaunch` / `currentPage` / `screenshot` / `$$`+`text` | 单连接内连续 40+ 次稳定 |
| 写：`element.tap()` / `page.setData()` | **紧随其后的下一次调用必 `timeout waiting for automator response`**（≈12s），并连带污染同连接后续 `$$`（`rawPath null`） |

**对照实验（防误判，必做）**：写一个「**不点击**」的对照组，结果**同样**在第二次调用超时
⇒ 属**通道/模拟器侧行为**，与「点击把页面弄崩」**无因果**。
（此前一版曾把「展开后回首页 + 系统异常 toast」读成产品缺陷，已由该对照实验证伪。）
对照实验原始输出存 `ctrl/`：`guide_probe_TAP.json`（点击组）、`guide_probe_NOTAP.json`（不点击组）、
`guide_probe_TAP2.json`（第二次点击组），三组均在 screenshot 之后的第二次调用超时。

同源另两条坑：
- `page.data()` 在本模拟器恒报 `page is not on top of page stack` ⇒ 改用 `mp.evaluate(getCurrentPages())`；
  且其栈顶**有时与 `currentPage()` 不一致**，两者不可互相印证。
- **断开连接后页面会重置回 `pages/index/index`** ⇒ 任何截图必须在**保持连接期间**完成。

### 4.3 取证方法：automator 触发 + 真实窗口截图（本轮定式）

1. 脚本内完成「连接 → reLaunch → 注入 / 点击」；
2. **不断开连接**，`await sleep(N)` 保持会话；
3. 期间用 `win_gui` 截**真实 IDE 窗口**（已验证：模拟器渲染的正是 automator 控制的那个实例）；
4. 需看更靠下的内容时，用 `mp.evaluate(() => wx.pageScrollTo(...))` 滚动（写操作会超时，但**滚动已执行**）。

脚本随证据入库：`verify_8c_all.js`（只读断言）、`hold_action.js`、`scroll_bottom.js`、
`append_probe.js`、`inject_probe.js`、`shot_ide.py`。

### 4.4 取证结果

**A. 机器断言（automator 只读，13 条全过）**
录入页可达 / 「填写口径」标题 / 收入·费用·堂食·外卖·运营·其他六条口径句 / 费用含「营销」大类 /
折叠体默认不渲染（收起）/ 摊销页可达 / 摊销页含「追加采购」入口 / 摊销页含「每笔从各自的采购月起单独摊销」。

**B. 保持连接期间的真实窗口截图（8 条，机器采集 + 人工判读）**

| 图 | 覆盖断言 |
|---|---|
| `h2_input_real_render.png` | 录入页真实渲染：堂食 / 外卖 / 其他业务收入、运营 / 人工 / 营销 每类「包括…；不包括…」 |
| `h2_input_guide_open.png` | 点开后折叠体 5 条：同一笔只填一次 / 单位「元」 / **食材采购不计入费用**（走库存倒轧）/ **设备、装修、加盟费走「摊销资产」分期摊，可分多次采购分别摊** / 佣金统一记「费用·营销」 |
| `h1_amortize_group2.png` | 「装修 **[共2笔采购]**」· **合计原值 ¥380000.00** · **第1笔** ¥300000.00 / 2026-01·36月 / ¥83.34 · **第2笔** ¥80000.00 / 2026-07·24月 / ¥33.34 · 每笔各有「编辑 / 提前报废」· 顶部口径句「同一资产以后又追加投入，点『追加采购』再记一笔，每笔从各自的采购月起单独摊销」 |
| `h1_amortize_append_btn.png` | 组内「**+ 追加采购**」按钮 + 底部「新增资产」 |
| `h1_append_form.png` | 追加表单：标题「追加采购」、提示「同一资产再次投入请用『追加采购』，不要另建同名资产，否则会重复计一遍」、资产名称自动带出「装修」、开始月份默认当前月 `2026-09` |

> OCR 对本机模拟器小字不可靠（实测把「共2笔采购」读成「共2采的」）⇒ **B 组不作为机器判据**，
> 按「截图机器采集 + 人工判读」登记，不计入自动化口径。

**C. 追加模式的运行态（机器证据，`mp.evaluate` 直取）**

```json
{"path":"pages/month/amortize","showForm":true,"appendGroup":"amort_x","appendSeq":3,"formName":"装修"}
```

⇒ 追加动作确实**沿原组**、记为**第 3 笔**、并带出组名（与 `saveAsset` 的 group_id / batch_seq 设计一致）。

**D. 日期控件复查（对应用户「还有日期等等」）**
全仓 `grep 'mode="date"'` = **2 处**，均在 `pages/month/amortize.wxml:95/106`（起摊月、终止月，
`fields="month"` 年月选择器）；**已无手输月份**（唯一 `YYYY-MM` 命中是行内注释）。
另有 `picker`：`pages/month/index.wxml`、`pages/card/edit.wxml`。

### 4.5 本轮仍未覆盖（如实登记）

1. 摊销页分组用的是 **`setData` 注入的合成数据**（本地 dev 库暂无摊销资产），属**渲染路径核验**，
   非端到端；补法：在页面真实新增一笔 → 再用「追加采购」加第二笔 → 复核分组。
2. **「保存资产」的落库路径本轮未点**（会写云库），留待真实数据核验时一并做。
3. `initDb` 超时值仍需人在控制台改（见 §二）。

### 4.6 教训登记（别再犯）

- 释放自动化端口**不要**用 `cli quit`；正确做法是 `cli close --project …` + `cli open --project …`。
- `cli auto` 要带 `--trust-project`；`cli` 是单通道。
- 窗口最小化 ≠ 进程死了：先 `SW_RESTORE` 再判断。
- **automator 的读/写要分开设计**：断言尽量只用读操作；交互类核验走「保持连接 + 外部截图」。
- 环境异常时**必须做对照组**再下结论，否则容易把工具缺陷写成产品缺陷。
