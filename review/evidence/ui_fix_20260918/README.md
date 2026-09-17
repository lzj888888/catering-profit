# UI 走查修复（六处）· 独立核验证据

**日期**：2026-09-18
**对象**：`pages/month/result`、`pages/month/amortize`、`pages/month/index`、`pages/month/input`、`pages/mine/index` 六处 UI 缺陷
**修复方**：InsCode（快马）
**核验方**：WorkBuddy（我）—— **不采信修复方自述，全部独立复跑**

---

## 1. 核验结论

| # | 编号 | 缺陷 | 核验手段 | 结果 |
|---|------|------|---------|------|
| 1 | F1 | `month/result` 无账本/接口失败时**永久显示「加载中…」** | 模拟器实拍 + 断言 | ✅ 显示空态文案 + 「去录入」按钮；**全页不含「加载中」** |
| 2 | F2a | `month/amortize` 「当月摊销合计」只有 ¥ 无数值 | 模拟器实拍 + 断言 | ✅ 渲染 `¥0.00`（`data.totalYuan="0.00"`） |
| 3 | F2b | `month/index` 「月份」行空值无占位 | 模拟器实拍 + 断言 | ✅ `curMonth=""` 时显示「暂无账本」 |
| 4 | L1 | `month/input` 「食材消耗合计（元）」出现两次 | 模拟器实拍 + 断言 | ✅ 小节标题「食材消耗」/ 字段标签「食材消耗合计（元）」，**叶子节点计数 = 1** |
| 5 | L2 | `month/index` 单 tab 渲成满宽橙色像横幅 | 模拟器实拍 + 断言 | ✅ `.tabs` class = `tabs single`、`.tab` 数 = 1、wxss 规则命中 |
| 6 | L3 | `mine` 注销按钮用内联样式 | 模拟器实拍 + 断言 | ✅ `class="btn danger"`、`style="null"` |

**汇总：6 / 6 通过**（`verify_after.json`）

## 2. 门禁独立复跑（我方，非修复方自述）

| 命令 | 结果 |
|------|------|
| `node specs/dev-specs/prototype/check_error_codes.js` | **A–L rc=0** |
| `node verify_all.js` | **59/59 套件通过 rc=0**（含新增 `[batch8-ui-fix] ✅ PASS (✅ 27 条 / 段 10)`） |
| `node tools/selftest_ui_fix.js` | **27 通过 / 0 失败** |
| K11 双副本 | `miniprogram/i18n/terms.js` 与 `specs/dev-specs/i18n/terms.js` **md5 相同**（`ba27677a92e5786e8ea448b2487f3662`） |
| 受保护区 | `git status --porcelain cloudfunctions/` **为空** |

## 3. 两处「指令与仓库纪律冲突」的裁定（我方查证）

修复方改了两个**我没授权但仓库纪律强制要求**的文件，均已逐条查证为**必须**：

1. **`specs/dev-specs/i18n/terms.js`** —— 我原指令禁改 `specs/`。但 `check_error_codes.js:533` 的 **K11** 断言强制两份 `terms.js` 逐字一致（"以后者为准同步"）⇒ 新增 i18n 文案**必须**同改两处。实测 md5 相同 ⇒ **做对了**。
2. **`verify_all.js`** —— 我原指令只许改 `pages/**`。但 **R67** 要求"新增自测文件必须同时挂进 SUITES"（否则整文件静默不跑而全闸全绿）⇒ 必须登记 `batch8-ui-fix` 并把头部计数 58 → 59。

⇒ **这是我指令的缺陷，不是修复方的越界**。教训已记入技能。

## 4. 套件数三处人工面同步（我方维护）

`verify_all.js`（R59 机器守）已由修复方改为 59；**重启键两处人工面由我同步**：

- `★知识存储点_2026-09-10.md` §1.1「一键校验入口」行：**58 → 59**
- 同文件 §1.3「套件数会漂」行：**现 58 → 现 59**

⚠️ 已显式消歧：本批套件名叫 `batch8-ui-fix`，**但它不是"投喂第 8 批"** —— 投喂 8 批 = 0~7 已收官，本批是 UI 缺陷修复。

## 5. 文件清单

| 文件 | 说明 |
|------|------|
| `verify_after.json` | 六项断言结果（6/6，含每项的期望/实际） |
| `verify_ui_fix.js` | 核验脚本（可复现：`NODE_PATH=<mpauto> node verify_ui_fix.js <out> ws://127.0.0.1:9420`） |
| `v1_result.png` | F1 修复后（空态 + 去录入） |
| `v2_amortize.png` | F2a 修复后（¥0.00） |
| `v3_month_index.png` | F2b + L2 修复后（暂无账本 + tab 收窄） |
| `v4_input.png` | L1 修复后 |
| `v5_mine.png` | L3 修复后 |
| `inscode_report.md` | 修复方交付报告原文（**仅对照用，不构成证据**） |

## 6. 复现前提（重要）

- 核验走**微信开发者工具自动化通道**：`cli auto --auto-port 9420` + `miniprogram-automator`（ws `ws://127.0.0.1:9420`）。
- dev 环境**大部分云函数未部署** ⇒ 页面接口调用失败 ⇒ 恰好触发 F1/F2a 的**空态/兜底路径**，因此这两项在此环境下可稳定复现（这也是它们当初被走查发现的原因）。
- ⚠️ 我方核验脚本首版有两个**自身**缺陷（`page.screenshot` 应为 `mp.screenshot`；文本计数把父节点聚合文本重复计入）⇒ 首轮报 4/6 属**误报**，已修正后重跑得 6/6。留此为戒：**核验脚本本身也会骗人**。
