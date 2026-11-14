# R736 · 摊销相关数值全量清单（会诊底稿）

> 生成时间：2026-11-15
> 用途：把「摊销」在代码里出现的**每一个数值位**列全，供豆包 / DeepSeek 会诊。
> 纪律：只列事实（代码现值 + 数据来源 + 是否受开关影响），不写立场。

---

## 一、底层数据结构

表 `shop_amortize`（资产台账，一行 = 一笔支出）：

| 字段 | 含义 |
|---|---|
| `value_fen` | 这笔支出的总额（分） |
| `start_month` | 开始月份 / 一次性投入的「计入月份」 |
| `total_months` | 摊多少期（lump 行恒为 1） |
| `group_id` / `batch_seq` | 同一项支出多次采购的分组 |
| `asset_kind` | 装修 / 加盟费 / 设备 / 押金 / 其他 |
| `terminate_month` | 提前报废月份 |
| **`mode`** | **`'amort'` = 分期摊销；`'lump'` = 一次算清** |

表 `shop_switch`（店铺级开关，只有两个布尔）：

| 键 | 语义 |
|---|---|
| `inventory_switch` | 食材消耗用「倒轧」还是「直接填」 |
| **`amortize_switch`** | **摊销要不要计入利润** |

---

## 二、三条互不相干的「摊销口径」

| # | 口径 | 数据源 | 是否读 `amortize_switch` |
|---|---|---|---|
| ① | **台账分期摊销** | `shop_amortize` where `mode='amort'`，按 `value/months` 逐月摊 | ✅ 读（关 ⇒ 计入值归 0） |
| ② | **沙盘建店投入折算** | 沙盘页手填「金额 + 年限」，前端折算月均 | ❌ **结构上不读**（沙盘是推演，不连台账） |
| ③ | **一次算清（lump）** | `shop_amortize` where `mode='lump'`，全额进当月 | ❌ 不读（round107 定案：与摊销**不互斥**，两笔不同的钱可共存） |

**引擎实现**（`cloudfunctions/calcMonthlyProfit/service.js`）：

```js
const effectiveAmortizeFen = amortizeSwitchOn ? fenRoundN(amortizeFen) : 0;
const effectiveLumpSumFen  = lumpSumFen;   // round107：取消与摊销的互斥
const operationRefProfitFen  = 收入 − 费用 − 参考消耗 − effectiveLumpSumFen;        // 参考口径，不含摊销
const totalFactorRealProfitFen = 收入 − 费用 − 真实消耗 − effectiveAmortizeFen − effectiveLumpSumFen;
const profitDiffFen = (真实消耗 − 参考消耗) + effectiveAmortizeFen;
```

---

## 三、全部数值展示位（开关关闭时的现值）

### A. 摊销管理页 `subpkg/biz/month/amortize.wxml`

| # | 位置 | 显示什么 | 数据来源 | 关开关后 |
|---|---|---|---|---|
| A1 | 页首大数字「本月摊销合计」 | `shownTotalYuan` | `total_amount_fen`（台账合计） | **¥0.00**（R735 改） |
| A2 | 页首附注 | 「台账每月应摊 ¥X · 开关关闭不计入利润」 | 同上 | 出现 |
| A3 | 「本月一次算清」区块 | 每笔 lump 金额 + 合计 | `lump_total_fen` | 不变（不受开关） |
| A4 | 「分期摊销」区块标题 | 「分期摊销（台账口径 · 本月不计入利润）」 | 开关 | 加后缀 |
| A5 | 开关本体 | 「启用分期分摊」 | `amortize_switch` | off |
| A6 | 组内「资产原值」 | `g.valueYuan` | 台账 | **不变** |
| A7 | 组内**「月摊销」** | `g.monthYuan` | 台账（`value/months`） | **仍显示 ¥4,333.33** ← 用户质疑点 |
| A8 | 组内「剩余未摊 / 摊完月份」 | `progressNote` / `endNote` | 台账 | **不变** |
| A9 | 每笔明细「月摊销」 | `b.amountYuan` | 台账 | **不变** |
| A10 | 页底出口 | 看本月经营结果 / 回月度首页 | — | 不变 |

### B. 月度结果页 `subpkg/biz/month/result.wxml`

| # | 位置 | 显示什么 | 关开关后 |
|---|---|---|---|
| B1 | 真利润大数字 | `r.trueProfit` | 变大（摊销没扣） |
| B2 | 「钱扣在哪」一行 `amortText` | 文字说明 | 改措辞 |
| B3 | 展开「这笔钱怎么算出来的」→「减：摊销」 | `r.effectiveAmortize` | **¥0.00** |
| B4 | 「减：摊销」明细行 | `r.effectiveAmortize` | **¥0.00** |
| B5 | 摊销三件套卡（还剩几期 / 摊完月份 / 摊完后月利润） | `amort_extra` | 显示「未开启摊销·不适用」 |

### C. 月度首页 `subpkg/biz/month/index.wxml`

| # | 位置 | 关开关后 |
|---|---|---|
| C1 | `result.amortText` 口径提示 | 改措辞 |
| C2 | `result.lumpText` 口径提示 | 不变 |
| C3 | 三列小卡（利润 / 毛利 / 保本） | 利润变大 |

### D. 导出月报 `cloudfunctions/exportData/index.js`

| # | 位置 | 关开关后 |
|---|---|---|
| D1 | 利润表「减：一次性投入（本月）」 | 不变 |
| D2 | 「＝ 全要素真实利润」 | 变大 |
| D3 | 「摊销来源」明细表每行（`一次算清` / `分期摊销` 标签 + 本月金额） | 台账原值，不变 |
| D4 | 「合计」行 | 只合计 lump |
| D5 | 每行备注 `amortNote`（按金额是否实际计入分四态） | 「摊销开关关闭 ⇒ 本月不计入」 |

### E. 经营盈亏沙盘 `subpkg/tools/sandbox/`

| # | 位置 | 说明 |
|---|---|---|
| E1 | 「第5项 开店投入」各行右侧「月摊销」 | 手填金额 ÷ 年限，**不连台账、不读开关** |
| E2 | 保本营业额 `break_even_monthly_fen` | 固定成本**含**沙盘折算摊销 |
| E3 | 现金保本额（不含摊销） | 单独一行，仅在有摊销时出现 |
| E4 | 矩阵页「月摊销」列 | 同上 |

### F. 后端剩余位

| # | 位置 | 说明 |
|---|---|---|
| F1 | `getLedger` → `amort_extra{switch_on, this_fen, after_fen}` | 开关关 ⇒ `this_fen=0`、`after=当前真实利润` |
| F2 | `getAmortSchedule` → `amortize_switch_on` / `switch_source` | R735 起归档月读落库快照，与 `getLedger` 同源 |
| F3 | `getAmortSchedule` → `total_amount_fen` | **台账合计，不受开关** |
| F4 | `archiveMonth` → `switch_used` 快照落库 | 归档时冻结 `{inventorySwitchOn, amortizeSwitchOn}` |

---

## 四、用户（餐饮老板 / 产品负责人）的原话

> 「摊销的数我还添了，正常它要不摊销，按理说不该有那数对吧。然后我又把开关给它关了，关了不让它去摊销，那么不让摊销那填那个数，它的意义本身也不在，本身它就按理说它应该就是要摊销，启用摊销才对。
>
> 所以说这个开关，它不启用摊销，按理说它就应该是走到一次性那里去，记到一次性那里。那么摊销这里头其实它正常来说就不应该存在开关这个东西。
>
> 它应该就是一个摊销资产摊多少期，摊销记多少期。然后不摊销的那个是走的一次性那里嘛，因为你上面已经有一次性的投入了。
>
> 它下边那个它数字还在，它正不正常呀？」

---

## 五、待会诊的三个问题

1. **语义问题**：一个「摊销资产」既然填了总额和期数，它是否还有「不摊销」的可能？「不摊销」和「一次算清」在业务上是不是同一件事？
2. **开关问题**：摊销区块里这个「启用分期分摊」开关，该保留、该改位置、该改语义，还是该删除？如果删除，存量数据（已有店铺把开关关着）怎么迁移才不产生历史数据突变？
3. **展示问题**：开关关闭时，摊销页下半部分每笔资产的「月摊销 ¥4,333.33」仍显示 —— 这是正确（台账属性）还是错误（读起来像本月扣了钱）？如果保留，怎么标注才不误导？
