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

## 四、遗留 / 未做（如实登记）

1. **8c 的模拟器视觉复核未做**（本轮最大遗留）。原因是**我自己的操作失误**：为释放 9420 端口执行了
   `cli quit`，把开发者工具 GUI 整个关掉了；之后无论怎么试都起不回来：

   | 尝试 | 结果 |
   |---|---|
   | `cli.bat auto --auto-port 9420`（含解除沙箱重跑） | 回显 `√ auto`，但 `netstat` 查 9420 **无监听**，`wechatdevtools.exe` 进程数 **0** |
   | `cli.bat open --project …` | 回显 `√ open`，但只起了 headless server（35237 有监听），GUI 进程仍为 0 |
   | 直接跑 `wechatdevtools.exe`（沙箱内 / 解除沙箱 / 以安装目录为 cwd） | 启动即崩： `[FATAL:url_idna_icu.cc(52)] failed to open UTS46 data with error: U_FILE_ACCESS_ERROR` + `[FATAL:startup_browser_creator.cc(1033)] Failed to load default app` |
   | `cmd //c start` / `explorer.exe` 拉起 | 前者在 Git Bash 下退化成交互 cmd（未执行），后者被安全策略拦截 |

   ⇒ 结论：**GUI 进程必须由人在这台机器桌面会话里打开**（ℹ️ InsCode 桌面端本轮同样注入失灵：
   `SetCursorPos` 生效但 `mouse_event` 点击 / `Ctrl+V` 键入均无任何 UI 响应，hover 无高亮、
   `PostMessage` 直投 `Chrome_RenderWidgetHostHWND` 也无效 —— 推测是完整性/前台焦点策略所致）。
   恢复方式：人工打开微信开发者工具 → 打开本仓库 → `cli.bat auto --auto-port 9420` →
   `node review/evidence/batch8c_verify_20260918/verify_8c.js`（脚本已随证据入库，依赖
   `miniprogram-automator`，见 `C:/Users/lzj/.workbuddy/binaries/node/mpauto/`）。
   当前 8c 的证据强度 = **静态契约 56 条 + 全量门禁 61/61 + 受影响三个云函数自测 43/7/57 全绿**，
   尚缺一帧真机/模拟器截图。

   **教训登记（别再犯）**：释放自动化端口**不要**用 `cli quit`；正确做法是
   `cli close --project …` 再 `cli open --project …`（只关项目窗口，IDE 主进程不动）。
2. `initDb` 超时值仍需人在控制台改（见上）。
3. 摊销页多笔分组的**真实数据**渲染未在模拟器验证（本地 dev 库无摊销资产）；脚本里用 `setData`
   注入两笔做了渲染路径核验，属合成渲染，非端到端。
