# 真机 / 模拟器 UI 走查证据（2026-09-18）

**入口**：先看 `report.html`（含结论、逐页截图、源码判据、复现命令）。

## 这是什么
用**微信开发者工具自动化**通道（`cli auto --auto-port 9420` + `miniprogram-automator`），
对 `app.json` 里全部 **14 个页面** 逐页 `reLaunch`，每页：
1. 取模拟器渲染截图（`miniProgram.screenshot()`）；
2. **机器抽取**所有 `<button>` 的文案 / `class` / `disabled`（避免目视 OCR 读错）。

对可疑页追加 **4s / 8s 长等待复测**，并把长等待结果单列一份报告。

## 文件清单
| 文件 | 内容 |
|---|---|
| `report.html` | **主报告**：结论 + 逐页截图 + 源码判据 + 复现方式 |
| `report_run1.json` | 第一轮 14 页：`actualPath` / `buttons[{text,cls,disabled}]` / `dataKeys` |
| `report_run2.json` | 长等待复测：`r1_index` / `r2_month_index` / `r3_month_result` / `r4_month_result_again` |
| `report_run3.json` | 实抽 `curMonth` / `months` / `tab` / `isPaid` + 按钮与可点区域清单 |
| `01..14_*.png`、`r1..r4_*.png` | 页面截图（336×725，iPhone 12/13 模拟器） |

## 结论速览
- 🔴 **F1（中）**：`pages/month/result` 在无账本 / 加载失败时**永久显示「加载中…」**
  —— `result.wxml:1` 的 `wx:if="{{!loading && r}}"` + `:67` 的 `wx:else` 渲染 `{{t.loading}}`，
  `&& r` 让 else 同时承接"加载中"和"r 为空"。**只此一页**（其余 12 页写法正确，已 grep 排除）。
- 🟡 **F2（低）**：两处"数值占位缺失" —— `month/amortize` 只显示孤零零一个「¥」（`totalYuan` 未初始化）；
  `month/index` 的「月份」行空白（`curMonth === ""`、`months === []`）。
- 🔵 **L1~L3**：`month/input` 的「食材消耗合计（元）」因**小标题与字段标签共用同一 i18n key** 而出现两次；
  `month/index` 单 tab 渲成满宽橙色像横幅；`mine/index` 的注销按钮用内联样式。
- ✅ **按钮合规（无需再提）**：14 页按钮文案无禁词；「导出 / 打印」走 `openPaywall('export')` **不是白点**；
  `.btn` 基类无背景色不会误染；归档月只读 `disabled="{{readOnly}}"` 路径存在。

## 已推翻的中间猜测（留痕防回潮）
1. "`/pages/month/index` 会重定向回首页" → **证伪**（首轮是 reLaunch 与读页的时序错位）。
2. "`month/result` 卡在加载" → **改判为 F1**（不是卡住，是兜底分支语义错）。
3. "注销账号红色来自 wxss 样式污染" → **证伪**（是内联样式，`mine/index.wxss` 无 `.btn`）。

## 登记位置
`specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md §7`（写码归快马 `inscode`；验收走本仓套件）。
