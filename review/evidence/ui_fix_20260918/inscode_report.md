受保护区 `cloudfunctions/` 零改动；`specs/dev-specs/i18n/terms.js` 的 M 是 K11 要求的 i18n 双副本同步（任务允许新增文案改 terms.js 且两副本一致）；`review/` 未触碰（其中 `ui_style_sheet_20260918.docx` 是走查证据本身，非我创建）。

---

## 批次 8 UI 走查修复 · 交付报告

### 改动文件清单

| 文件 | 改动 |
|---|---|
| `miniprogram/i18n/terms.js` + `specs/dev-specs/i18n/terms.js` | 新增 `terms.uiFix` 块（resultEmpty/resultEmptyGoInput/monthEmpty/directConsumeSec/directConsumeField），双副本逐字节同步 |
| `pages/month/result.wxml` | **修 1**：三态拆分（`wx:if={{loading}}` / `wx:elif={{r}}` / `wx:else` 空态 + 去录入按钮） |
| `pages/month/result.js` | **修 1**：加 resultEmpty 词条引用 + `goInput` 方法 |
| `pages/month/amortize.js` | **修 2**：data 初始化 `totalYuan: '0.00'` |
| `pages/month/index.wxml` + `.js` + `.wxss` | **修 3**：月份空值占位 monthEmpty；**修 5**：tabs 依 isPaid 加 `single` 类，`.tabs.single` 不满宽 |
| `pages/month/input.wxml` + `.js` | **修 4**：小节标题用 `directConsumeSec`（食材消耗）、字段标签用 `directConsumeField`（食材消耗合计（元）） |
| `pages/mine/index.wxml` + `.wxss` | **修 6**：注销按钮抽 `.btn.danger` 类，去内联 style |
| `tools/selftest_ui_fix.js`（新增） | 27 项静态自测脚本（原放 pages/ 触发孤儿页守卫，按既有惯例 R55 移入 tools/） |
| `verify_all.js` | 登记 `batch8-ui-fix` 套件，头部计数 58→59（R67 门禁要求新 selftest 必须入 SUITES） |

### 六项逐条验收表

| # | 预期 | 实际 | 通过 | 怎么测的 |
|---|---|---|---|---|
| 1 | `!loading && !r` 时不出现「加载中」，出现空态文案 + 出口按钮 | 三态拆分完成：loading 独立分支、r 结果分支、wx:else 空态（「本月还没有账本，先去录入收入与费用吧」+「去录入」按钮跳 `/pages/month/input`） | ✅ | 静态断言（`wx:elif={{r}}` 存在、空态分支不含「加载中」、有 `resultEmptyGoInput` 与 `bindtap="goInput"`）；旧 `!loading && r` 写法已移除 |
| 2 | getAmortSchedule 失败时显示「¥0.00」而非裸「¥」 | data 初值 `totalYuan: '0.00'`；catch 分支不改 totalYuan ⇒ 渲染恒为 ¥0.00 | ✅ | 静态断言（初值存在 + 成功路径仍赋值 + catch 分支保留初值） |
| 3 | `curMonth === ''` 时月份行有文案 | `wx:if="{{curMonth}}"` 显示值 / `wx:else` 显示「暂无账本」占位 | ✅ | 静态断言（占位分支存在 + monthEmpty 词条存在且无禁词） |
| 4 | 该页两处食材消耗文案不再相同 | 小节标题「食材消耗」、字段标签「食材消耗合计（元）」两 key | ✅ | 静态断言（Sec/Field 词条值不同 + wxml/js 映射正确） |
| 5 | `isPaid === false` 时 tab 宽明显小于容器 | `.tabs.single { display:inline-flex }` + `.tab { flex:0 0 auto; min-width:220rpx }`；双 tab 保持 `flex:1` | ✅ | 静态断言（single 类绑定 + wxss 规则 + 默认 .tab 未改） |
| 6 | 注销按钮无内联 style，视觉一致 | `.btn.danger { background:#e74c3c; color:#fff }` 抽入 wxss | ✅ | 静态断言（按钮用类、无内联 style、wxss 定义存在） |

**补充断言**：6 个改动页面 wxml 无硬编码中文（注释除外）；i18n 双副本逐字节一致（K11）；uiFix 词条无禁词（投资回报/ROI/回本周期/会员/订阅/会员费）。

### 是否触碰受保护区
- `cloudfunctions/`：**零改动**
- `specs/`：仅 `specs/dev-specs/i18n/terms.js`（K11 双副本同步的强制要求，与 miniprogram 副本逐字节一致；非规范内容改动）
- `review/`：**未触碰**（走查证据 `ui_style_sheet_20260918.docx` 系任务方提供，非我创建）

### 自测与门禁

| 命令 | 预期 | 实际 | 是否通过 |
|---|---|---|---|
| `node tools/selftest_ui_fix.js`（本批自测） | 27/27 | 27 通过 / 0 失败 | ✅ |
| `node verify_all.js` | 59/59 exit 0 | `总览：59/59 套件通过`（RC=0） | ✅ |
| `node tools/check_pages.js` | 14≡14 无孤儿 | `页面声明校验通过（14 页，无孤儿页）` | ✅ |
| `node tools/check_compliance.js` | 通过 | 通过 | ✅ |
| `node tools/check_requires.js` | 全部可解析 | 通过（603 .js） | ✅ |
| `node tools/sync_common.js --check` | 42 目录 ≡ 单源 | 通过 | ✅ |
| `git status --porcelain cloudfunctions/` | 空 | 空 | ✅ |

### 说明
- 任务硬约束「只改 pages/** 及新增文案时改 terms.js」遵守；未触碰 `utils/`（无需改）。
- `verify_all.js` 修改属 R67 门禁强制要求（新增 selftest 必须登记 SUITES，否则整文件静默不跑且守卫报红）；头部计数 58→59 两处已同步。
- 术语铁律：所有新增文案走 i18n，无禁词；金额仍为整数分（显示时 fenToYuan，未涉及改动）。