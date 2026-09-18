# 功能完整性走查报告 · 规划 vs 实现

- **日期**：2026-09-18
- **方法**：以 `specs/PRODUCT_PLAN.md`、`core/02_模拟测试数据集.md`（22 项验收）、`core/04_核对清单.md`、`core/开发规范v1.0_ModuleA/M1/M2/M3` 为**基准**，对 `pages/`（14 页）、`miniprogram/i18n/terms.js`（320 条术语）、`cloudfunctions/`（42 函数）做逐项差集。
- **取证纪律**：每一项都给 **命令式证据**（`file:line` 或全仓 grep 结果），不给结论不给分。
- **结论**：共 **7 类缺失 + 1 个根因**。其中 🔴3 类为**规格明确要求但实现缺失**，会直接导致验收挂网。

---

## 〇、先纠三处「以为丢了其实没丢」

| 用户疑问 | 实际情况 | 证据 |
|---|---|---|
| 收入合计有吗？ | ✅ **有**，但字面叫「**营业收入**」，不是「收入合计」 | `pages/month/index.wxml:45` `{{t.totalRevenue}}` = `terms.js:138` `'营业收入'`；`pages/month/result.wxml:33` 同 |
| 费用合计有吗？ | ✅ **有**（但两个页面叫法不同） | `result.wxml:37` `{{t.expense}}` = `terms.js:302` `'费用合计'`；`month/index.wxml:49` `{{t.totalExpense}}` = `terms.js:139` `'总费用'` |
| 经营双视角体现在哪？ | ✅ **有，且是两处** | ① 月度经营页双 tab：免费「经营参考估算」/付费「真实利润」 `month/index.wxml:28-31`；② 结果页双利润卡 `result.wxml:18-28` |
| 加盟费 | ✅ **按设计覆盖了** —— 规划明写「转让费、品牌使用费、进场费按同一摊销模型，`shop_amortize` **无资产类型枚举，按名称自由录入**」 | `ModuleM1.md:56`；实现为 `amortize.wxml:42` 自由文本输入框 |
| 保本点/目标利润/日均 | ✅ **全有** | `pages/sandbox/index.wxml:69-82` 保本月营业额/保本日均/目标月营收/目标日均 |

> ⚠️ 但由此发现一个**新问题**：同一概念「费用合计」在两页叫法不同（`费用合计` vs `总费用`），属术语不统一，见 C 类。

---

## 🔴 A 类（最严重）：收入/费用**二级细项完全不存在**

**这是"费用的明细""少了很多东西"的根本答案。**

规划要求费用是**四大类 + 二级细项**（`core/02_模拟测试数据集.md` 场景 S1）：

```
门店运营费 10,300（房租6,000/物业1,000/水电1,800/耗材1,500/宽带100）
人工总成本 15,000（工资12,000/社保1,500/宿舍800/员工餐500/工装200）
营销推广费  7,240（外卖佣金3,600/配送费1,200/活动补贴1,500/配送补贴300/推广费400/团购佣金240）
其他支出      300
                                    → 费用合计 32,840
```

**实际实现（`terms.js:183-188`）只有 4 个扁平项，且分类还错了：**

```js
expense: [
  { category: 'rent',    label: '房租租金' },
  { category: 'labor',   label: '人员工资' },
  { category: 'utility', label: '水电物业' },
  { category: 'other',   label: '其他杂费' },
],
```

**四方证据：**

| # | 证据 | 命令/位置 |
|---|---|---|
| 1 | `subItem`（细项）术语键**存在但页面不渲染** | `pages/month/input.js:21` 把它塞进 data，但 `input.wxml` 全文无 `subItem` ⇒ 死 key |
| 2 | 后端**全仓无 `sub_item`** | `grep -rn "sub_item" cloudfunctions/` → **0 命中** |
| 3 | 录入表单只有一层循环 | `input.wxml:17-21` `wx:for="{{t.expense}}"` 仅一层，无展开/折叠/跳转 |
| 4 | 配置表 `shop_income_item`/`shop_expense_item` **建了但没用** | 集合已在 `collections.js:15` 声明并有索引(`:116/:119`)，但**无种子数据、无任何云函数读取**（`grep -rl` 仅命中 `collections.js` 自身）⇒ 04清单要求的"配置化"未兑现，仍是硬编码 |

**直接后果（会导致验收挂）：**
- ❌ **验收项 #2**「费用各子类自动汇总 门店10,300/人工15,000/**营销7,240**/其他300/全部32,840」→ **当前 UI 根本录不出营销类**，连录入入口都没有。
- ❌ **04 核对清单 阶段 2**「团购与外卖佣金**分列**（不合并）」→ 无二级项，无从分列。
- ❌ **验收项 #1**「收入三分法汇总」虽有大类，但同样**无细项**（如外卖拆平台/自营）。

---

## 🔴 B 类：**全仓没有任何日期控件**

用户提到"还有日期等等" —— 属实且比想象严重。

- 全仓 `picker` 仅 **2 处**：`pages/card/edit.wxml`（物料选择）+ `pages/month/index.wxml`（月份选择），**无一处 `mode="date"`**。
- 摊销资产的月份是**纯文本手输**：`amortize.wxml:50` `placeholder="2026-01"`、`:58` 终止月同 ⇒ 用户可输成 `26/01`、`2026.1`，格式错误风险全靠后端兜。
- 规划明确要求：**时间字段 Unix 毫秒 / 年月 `YYYY-MM` 字符串**（04 清单阶段 0）、**表单做日期格式校验**（清单壁垒 7）。

---

## 🔴 C 类：「我的」页过硬 + 三个 0 引用术语

`pages/mine/index.wxml` **全文仅 5 块**：店铺名 / 隐私开关 ×2 / 两段说明 / 注销按钮。

| 缺失 | 规划依据 | 术语是否已有 | 引用情况 |
|---|---|---|---|
| **版本号 / 关于** | 常规 + 排障必需 | 无 | 页面上不显示 App 版本（`app.json` 仅 `pages,window,style,lazyCodeLoading`） |
| **客服入口** | **04 核对清单 AD-16「客服入口」要求加「意见反馈」按钮**（现为 ☐ 未勾） | `terms.js:360` `contactService: '联系客服开通'` | 仅 `pages/pay/orders.js` 用，**无常驻入口** |
| **免责声明** | 审核合规惯例（投资/经营建议类） | `terms.js:156` `disclaimer: '本工具计算结果仅供参考，不构成任何投资、经营决策建议…'` | **0 引用**（幽灵文案） |
| 导出 / 清除缓存 | 批次 7 §2.4 | `exportScopeM1` 等 | 0 引用 |

---

## 🟡 D 类：结果页**无下钻明细**

`result.wxml` 全部 cell 均为静态文本，除导出按钮外**无任何可点击行**：

```
result.wxml:32-47  收入/费用合计/毛利/毛利率   ← 静态
result.wxml:52-67  食材/真实消耗/摊销/口径差异  ← 静态
result.wxml:70     导出按钮                    ← 唯一交互
```

用户点了「费用合计」看不到构成 ⇒ 与 A 类叠加，是"明细按钮缺失"的直接体感。

---

## 🟡 E 类：填表引导文案严重不足

用户："填表的引导字，比如收入包括哪些" —— 属实。

全仓 `pages/month/input.wxml` 只有 **1 处** hint：
- `:30` `{{t.directConsumeHint}}` = 「关闭了库存核算时，直接填本月食材消耗总额。」

**缺失**：收入区无「营业额应包括哪些 / 平台到账 vs 流水」说明；费用区无任何引导；「冰柜号/睡工」等易混项无解释。

---

## 🟡 F 类：74 条术语「幽灵化」

`terms.js` 共 320 条，**74 条从未被任何前端文件引用**（`_` 脚本：`_gui/terms_keys.js`）。
其中业务功能类（非 ERR.* 动态查表）真缺失 15 条：

```
netMargin 净收益占比      breakeven 保本点          paybackPrefix/Suffix 回本周期
disclaimer 免责声明       grossMarginRate 毛利率     intro / conclude
syncPrice2 同步至最新价   calcReverse 反算售价       addAsset 新增摊销资产
inputs/outputs 你的输入/测算结果                     exportScopeM1/M3 导出范围
privacyNeed               unlockAll 开通完整功能
```

> ⚠️ 但需诚实区分：其中 `breakeven`、`calcReverse`、`syncPrice2` 的功能**实际已实现**，只是用了**另一个键**（`breakEvenMonthly`、`copyVersion` 等）。
> 真正的"有文字无功能"是 **`disclaimer`（免责声明）** 和 **`unlockAll`/`paybackPrefix`（回本周期）**。

---

## 🔴 G 类（根因之一，非代码缺陷）：**dev 环境只部署了 2 个云函数**

```
cli cloud functions list -e cloud1-d4gphpoxy337f2a25
→ 仅 initDb、smokeTest
```

仓库里有 **42 个**可部署业务函数（含 `getLedger`/`getShopContext`/`getMonthList`/`calcMonthlyProfit`…）。
⇒ 所有页面调 `"云函数不存在"` ⇒ 全显示空态 ⇒ **加剧"少了很多东西"的观感**。

> ⚠️ 部署属**云侧操作**，且 `initDb` 当前 `timeout=3`（铁律要求 60s）。**需您先拍板超时目标值**，并确认是否授权我把业务函数部署到 dev。

---

## 📋 汇总：需要 InsCode 修的功能清单

| 编号 | 优先级 | 内容 | 验收依据 |
|---|---|---|---|
| **A1** | 🔴 P0 | 费用改**四大类**（运营/人工/**营销**/其他），补上营销类 | `02` 场景 S1；04清单阶段2 |
| **A2** | 🔴 P0 | 收入/费用**二级细项**（sub_item）UI + 后端字段，`sub_item` 入 `shop_monthly_expense/income` | 验收 #1/#2；`04` 阶段2「团购与外卖佣金分列」 |
| **A3** | 🟡 P1 | 落地 `shop_income_item`/`shop_expense_item` 配置表（04清单要求交配置化，非硬编码） | `core/01` §2.4 B 类表 |
| **B1** | 🔴 P0 | 摊销资产的**开始月/终止月改日期 picker**（`mode="date"` 或年月选择器），去手输 | 04清单阶段0/壁垒7 |
| **C1** | 🔴 P0 | 「我的」页补：**版本号**、**客服/意见反馈入口**（AD-16）、**免责声明** | AD-16；`terms.js:156/360` 已有文案 |
| **D1** | 🟡 P1 | 结果页「费用合计」「收入」行**可点下钻**到二级细项明细 | 依赖 A2 |
| **E1** | 🟡 P1 | 录入页补引导文案：收入/费用区各一句"应包括哪些" | 用户体验 |
| **F1** | 🟡 P2 | 清 P2：统一术语（`费用合计` vs `总费用` 两页不一致）；清理 74 条幽灵术语或补渲染 | 一致性 |

---

## 附：本次取证命令（可复现）

```bash
# 术语使用差集
node _gui/terms_keys.js                 # 74/320 未引用
# 二级细项是否存在
grep -rn "sub_item" cloudfunctions/     # 0 命中
grep -rn "subItem" pages/               # 仅 input.js:21 注入，wxml 不渲染
# 日期控件
grep -rc "picker" pages/*/*.wxml        # 仅 card/edit:3、month/index:2，无 mode="date"
# 已部署云函数
cli.bat cloud functions list --project <repo> -e cloud1-d4gphpoxy337f2a25
```
