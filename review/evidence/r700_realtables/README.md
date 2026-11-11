# r700_realtables —— 老板真表（端到端回归数据源）

## 这是什么

三张**平台导出的真实文件**（不是构造样本、不是豆包生成），抽成 JSON 供 node 门禁读取。
由 `tools/check_bill_realtables.js` 消费，已注册进 `verify_all.js`（套件 `bill-realtables`）。

## 🔴 先确认「真」——判据是 xlsx 元数据，不是文件名

李老师提醒过：「这里表格有真实的，有后期豆包模拟生成的。」
仓里 `review/evidence/` 下**两类文件混在一起**，靠文件名分辨不出来。用文件自带的
`docProps/app.xml`、`docProps/core.xml` 判定（由 `check_bill_realtables.js` E 组机器校验）：

| `Application` 字段 | 含义 | 判 |
|---|---|---|
| `Apache POI` | 平台**后端** Java 导出（真人不会用 POI，脚本模拟也不会） | 真表 |
| `WPS 表格` / `Microsoft Excel` | 老板自己打开、另存过 | 真表 |
| `openpyxl` / `Microsoft Excel Compatible` | Python 脚本生成 | **模拟** |

本目录三张的实测元数据：

| 文件 | Application | lastModifiedBy | 判定 |
|---|---|---|---|
| 美团账单 | `Apache POI` | — | **真表**（平台后端导出） |
| 淘宝闪购 | `Apache POI` | `耙三样·耙牛肉` | **真表**（平台导出 + 老板动过） |
| 美团商品 | `WPS 表格` | `符号` | **真表**（老板 WPS 另存） |

对照反证：`review/evidence/r245_jd_profile/jd_sku_sample_doubao.xlsx` 元数据是
`Microsoft Excel Compatible / Openpyxl 3.1.5` ⇒ 脚本模拟，**不可当真表用**。

> ⚠️ **容易被误当成真表的两张**（本轮踩过）：
> `owner_revenue_daily_202609_v5.xlsx`、`owner_takeaway_compare_202608.xlsx`
> 文件名带 `owner_` 很像老板自己的表，但元数据是 `Microsoft Excel Compatible`（脚本生成）。
> 真要拿它们做回归，必须先确认数据来源。

## 来源对应

R700 只接了 3 张；R703 把**仓内全部真表**（10 张）都接上了 —— 它们一直躺在 evidence 里没人跑。

| JSON | 原始文件 | 说明 | 接了 |
|---|---|---|---|
| `taobao_bill.json` | `r181l_stage1_import_feed/fixtures/淘宝闪购.xlsx` | **6 个 sheet**，主表「外卖账单明细」157 行 × 88 列，账期 2026-08 | R700 |
| `meituan_bill.json` | `r615_wechat_real/meituan_bill_20260907-0913.xlsx` | sheet「订单明细」15 行 × 69 列，账期 2026-09-07~13 | R700 |
| `meituan_goods.json` | `r615_wechat_real/meituan_goods_20260907-0913.xlsx` | 商品销量表 11 行 × 14 列（sheet 名带门店与日期后缀） | R700 |
| `meituan_bill_pack.json` | `r181l_stage1_import_feed/fixtures/09bbd0….xlsx` | **完整账单包 4 sheet**：账单明细(按日汇总) / 订单明细(98行) / **汇总信息(平台自带对账基准)** / 账户余额流水 | R703 |
| `jd_bill.json` | `r242_jd_bill/jd_bill_20260930.xlsx` | 京东账单 117 行 × 82 列，**两级表头**（R1 分组 / R2 真列名） | R703 |
| `jd_sku_bill.json` | `r242_jd_bill/jd_sku_bill_20260930.xlsx` | **空样本**（只有表头、无数据）—— 用来验「不崩不编」 | R703 |
| `goods_download.json` | `r232_formc_sample/商品下载_…xlsx` | 外卖商品销量 355 行 × 18 列，**「销售额」排在「销量」前面** | R703 |
| `jd_order_export.json` | `r615_wechat_real/jd_order_export_20261014-1020.xlsx` | 京东订单导出，商品混装在「商品信息」一列（`名,单价,数量/…`） | R703 |
| `combo_detail.json` | `r615_wechat_real/pos_combo_detail_…xlsx` | 套餐明细 73 行 —— 预期判成形态 B 并**主动拒收** | R703 |
| `inventory.json` | `r615_wechat_real/owner_inventory_202609_v3.xlsx` | 进销存 44 行 —— 预期**认不出**（我们没这个功能） | R703 |

重新抽取：`python extract_tables.py`（需 openpyxl，路径见脚本头部注释）。

## R703 的验证成果（每张都独立复算过）

| 表 | 期望值 | 结果 |
|---|---|---|
| 美团账单包（2026-08 整月） | 1826.64 元 / 50 单 | ✅ 且**与平台「汇总信息」交叉验证一致** |
| 京东账单 | 正向订单 555.96 元 / 23 单 | ✅ 排除 92 行（推广费 23 + 保险 69） |
| 京东 SKU 账单 | 空表 → 0 元 0 单 | ✅ 不崩不编 |
| 外卖商品下载（355 行） | 118 件 / 1823.08 元 | ✅ 列序反转（销售额在销量前）仍读对 |
| 京东订单导出 | 10 件 / 197.02 元 | ✅ 混装列还原无残留 |
| 套餐明细 | 形态 B | ✅ 主动拒收 |
| 进销存 | 认不出 | ✅ 预期行为 |

### 🔴 本套件最强的一条：用平台自己的数对账

`meituan_bill_pack.json` 的「汇总信息」sheet 是**美团自己算的**：

```
外卖订单       49笔   1,779.53元
企业外卖订单    1笔      47.11元
账单金额             1,747.95元
```

而在「订单明细」里，「外卖订单」和「企业外卖订单」的交易类型**都写「外卖订单」**。
所以正确结果是 `1779.53 + 47.11 = 1826.64` —— 我们算的正好是这个数。

> 为什么这比"独立复算"更强：复算和解析器可能犯**同一个理解错误**（比如都把退款当广告）。
> 平台汇总是第三方立场，不共享我们的假设。

## ⚠️ 三种口径互不相等，但都不是 bug

这是 H 组四条断言存在的原因 —— 防止后人把口径差异误判成 bug：

| 数 | 含义 | 谁给的 |
|---|---|---|
| **1826.64** | 外卖收入（含企业外卖订单）—— **我们落库的口径** | 订单明细求和 |
| **1779.53** | 平台「外卖订单」口径（**不含**企业外卖订单） | 汇总信息 |
| **1747.95** | 账单金额 = **打款净额**（扣完广告 76.41 + 保险 2.28） | 汇总信息 |

关系：`1826.64 − 1747.95 = 78.69 = 广告 76.41 + 保险 2.28`。
广告/保险是**费用**，不是收入减少 —— 所以排除它们、把 1826.64 当外卖收入是对的。


## 为什么这些真表值得单独建套件

它们**早就在仓库里**（10-16 至 10-26 期间李老师提供），但 R700 之前**全仓零脚本引用** ——
从没进过任何门禁。于是「解析器改坏了真表」只有等老板真的导入时才会发现。

R700 接入后立刻抓到两个真 bug：

### 1. 美团退款被当成广告排掉（金额多算 44%）

真表里同一订单号 `440229506410710878` 有两行：

```
R4  交易类型=外卖订单        商家应收款=+37.87
R7  交易类型=订单部分退款     商家应收款=−39.85
```

`rowFilter` 只留「外卖订单」，**退款整行被排除** ⇒ 收入算成 130.66 元，
而商家真实应收只有 **90.81 元**（130.66 − 39.85）。多算 39.85，页面零提示。

修法：`rowFilter.keepContains` —— 值里含关键词也放行（只对退款开口，广告/保险照排）。
同时 `refundTypeContains` 让退款行不计入有效订单数（它的订单状态写「订单完成」，
靠 `orderType===已退款` 判不出来，R695 那种判据覆盖不到这个形态）。

### 2. 美团商品表表头「商品名」被当成一道菜

真表表头：`日期 | 商品名 | 门店所在城市 | ...`
`COL_NAME` 里有「商品名」（能定位到列），但 `HEADER_FIRST` 是手写的另一份名单，
只有「商品名称」没有「商品名」⇒ 表头行没被拦，导出一张叫「商品名」的空卡。

修法：`HEADER_FIRST` 改为由 `COL_NAME` 派生（单源）—— 以后加列名别名，拦表头自动生效。

## 淘宝这张表的特殊价值：它是「零误差锚点」的原始数据

`utils/billParse.js` 头部注释写着：

> 淘宝闪购 2026-08：156 行 / 到手 3779.65 元

这张表就是那个锚点的原始文件。R700 实测：解析器给出 **156 行 / 3779.65 元 / 150 单**，
与注释逐一相符 —— 说明锚点没漂，淘宝链路是可信的（也反证美团那条是孤立的缺陷，
不是解析器整体不可靠）。

## 判据纪律（写在本套件里的约束）

- 金额一律比**分**（整数），不比浮点元。
- 每条金额断言都配一条**独立复算**（直接遍历 JSON 求和，完全不经过解析器）——不采信被测代码自己的汇总。
- 不比中文字面量做业务判断（`page-terms` P3-1 会判红）；要比就比**结构位置**（列索引）或数字。
- 带一条**反恒真**断言：按修前口径算必须得到不同的值，证明判据有分辨力。

## 附：`review/evidence/` 下 xlsx 的全量真伪盘点（2026-11-11）

按上面的元数据判据把仓里所有 xlsx 扫了一遍：**真 10 / 模拟 17 / 未知 2**。

**真表（可放心做回归）**

| 文件 | Application | 备注 |
|---|---|---|
| `r615_wechat_real/meituan_bill_20260907-0913.xlsx` | Apache POI | 已接入本套件 |
| `r181l_stage1_import_feed/fixtures/淘宝闪购.xlsx` | Apache POI | 已接入本套件 |
| `r615_wechat_real/meituan_goods_20260907-0913.xlsx` | WPS 表格 | 已接入本套件（C 组） |
| `r615_wechat_real/pos_combo_detail_20260907-0913.xlsx` | Apache POI | 套餐明细，**尚未接入** |
| `r615_wechat_real/jd_order_export_20261014-1020.xlsx` | Apache POI | 京东订单，尚未接入 |
| `r615_wechat_real/owner_inventory_202609_v3.xlsx` | WPS 表格 | 库存盘点，尚未接入 |
| `r242_jd_bill/jd_bill_20260930.xlsx` | Apache POI | 京东账单，尚未接入 |
| `r242_jd_bill/jd_sku_bill_20260930.xlsx` | Apache POI | 京东 SKU 账单，尚未接入 |
| `r181l_stage1_import_feed/fixtures/09bbd01042244a1fa98e0d0f1963211b.xlsx` | Apache POI | 待辨认是哪张表 |
| `r232_formc_sample/商品下载_20260907至20260913__…xlsx` | Microsoft Excel（by 蒋 敏） | 商品下载 |

**模拟样本（可作格式参考，不可当"真表回归"的证据）**
`jd_sku_sample_doubao.xlsx`、`dsi1_s1/s2_example.xlsx`、`_FAKE_dsi1_example.xlsx`、
`output_店算_小店决策对比表_小面样例.xlsx`、`堂食建卡*.xlsx`（8 个）、
`owner_revenue_daily_202609_v0_old/v5.xlsx`、`owner_takeaway_compare_202608.xlsx`

**未知**
`_variant_jd_sku_native.xlsx`、`_variant_jd_sku_withdata.xlsx`（Application=SheetJS，是解析器的变体实验文件，非原始导出）

> 上表由元数据脚本生成，需要复核时重跑：解 `docProps/app.xml` 看 `Application`。
> 别用「文件名像真的」当判据 —— `owner_*` 那两张就是反例。
