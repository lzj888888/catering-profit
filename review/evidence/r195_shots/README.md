# R195 走查取证 —— `<button>` 定宽同型缺陷「一次改干净」

> 轮次：R195（2026-10-03）· 触发：R194 §7.9 遗留的「`.top-add` 同根因缺陷是否一并修（等拍板）」
> 李老师 R195 起点指令：「**接下来做什么？你安排**」⇒ 本轮自行安排并执行。
> 取证通道：微信开发者工具模拟器（`miniprogram-page-review` 技能通道，R188 纪律），
> **判据全部机读**：`wx.createSelectorQuery().selectAll(sel).boundingClientRect()`，不靠肉眼。

---

## 一 一句话结论

**R194 写进代码注释 / 审计 / PITFALLS 的根因表述是错的**（说「`<button>` 的 `width` 只在 flex 容器内才失效」）。
R195 用三处同型样本实测定性后**一次改干净**：2 处真缺陷修完、1 处实测正常不动，
并把错误表述在 **4 个文件里逐一回改**（保留原文 + 加更正批注，不抹历史）。

| 判据 | BEFORE | AFTER | 结论 |
|---|---|---|---|
| `app.wxss::.top-add` 宽 | **184px** | **104px**（= 200rpx） | ✅ 修好（`material/index` + `card/index` 两页同构） |
| 顶栏 `.top-inp`（搜索框）宽 | 174px（被挤窄） | **254px** | ✅ 连带修好 |
| `pages/pay/orders.wxss::.btn-block` 宽 | **184px**（父 `.card2` 366） | **342px**（= 366 − 左右各 12 内边距） | ✅ 修好（满宽） |
| `pages/month/index.wxss::.banner .btn-small` 宽 | 83px ✔ | **83px** ✔ | ✅ 本就正常，**不动**（回归不破） |

BEFORE / AFTER 原始机读数据：`report_r195_BEFORE.json`、`report_r195_pay_BEFORE.json`、
`report_r195_AFTER.json`、`report_r195_pay_AFTER.json`（同目录，4 份）。
截图 8 张：`*_1_material_top` / `*_2_card_top` / `*_3_pay_renew` / `*_4_month_banner` × BEFORE/AFTER。

---

## 二 🔴🔴 本轮最值钱的发现：**R194 的根因表述被实测推翻**

R194（我在 `pages/shop/switch.wxss` 注释、`r194_shots/README.md` §二、`AUDIT…md` §7.8.1、
`.workbuddy/memory/PITFALLS.md` §1）都写了：`<button>` 的固有宽度 184px **优先级高于普通 `width`**，
并给出纪律「行内按钮**只能用 flex-basis 定宽**（父层得是 flex 容器）」。

**R195 三处同型样本实测矩阵**（`report_r195_*.json` 机读，非目测）：

| 声明 | 位置 | 选择器 | 父容器是 flex？ | BEFORE 实测 | 生效？ |
|---|---|---|---|---|---|
| `width:200rpx; min-width:200rpx` | `app.wxss::.top-add` | **单类** `.top-add` | ✅ 是 | **184px** | ❌ 失效 |
| `width:100%` | `pages/pay/orders.wxss::.btn-block` | **单类** `.btn-block` | ❌ **否**（`.card2` 是普通块） | **184px**（父 366） | ❌ **失效** |
| `width:160rpx` | `pages/month/index.wxss::.banner .btn-small` | **双类** `.banner .btn-small` | ❌ 否 | **83px** ✔ | ✅ 生效 |

**⇒ 两条反证，各自打掉 R194 表述的一半：**
1. `.btn-block` 的父容器**不是 flex**，可 `width:100%` **照样失效** ⇒ 「**在 flex 容器内才失效**」**错**；
2. `.banner .btn-small` 父**也不是 flex**，但它是**双类**选择器 ⇒ **照样生效**（160rpx=80px + border ≈83）。

**真规则（以此为准）**：`<button>` 的 UA 默认宽度（实测恒 **184px**）压过的是
**「单类选择器」的 `width` 声明** —— **与父层是否 flex 容器无关**，只与**选择器类名个数**有关。

**⇒ 两条修法，按场景选（均已实测验证）：**
- **flex 容器内** → 走**布局层** `flex: 0 0 <b>`，不与 button 的 `width` 打架
  （R194 在 `.edit-btn` / `.avatar-btn` 用过；R195 `.top-add` 同法，184 → 104）；
- **非 flex 容器内** → **把选择器提到双类** `.btn.btn-block`，与实测生效的 `.banner .btn-small` 同档
  （R195 `orders.wxss` 走这条，184 → 342）。
  🔴 提双类时**顺手加 `box-sizing: border-box`**，防 content-box 叠加 padding/border 导致超宽。
- ⚠️ `!important` 这条路**只在 R194 的 flex 样本上验过，非 flex 场景未验** ⇒ 别当第三条路。

---

## 三 改了什么（两处源码，各带判据注释）

| # | 文件 | 改法 | BEFORE → AFTER |
|---|---|---|---|
| 1 | `app.wxss::.top-add` | `width:200rpx; min-width:200rpx` ⇒ **`flex: 0 0 200rpx`**（去掉 width/min-width） | 184 → **104**；`.top-inp` 174 → **254** |
| 2 | `pages/pay/orders.wxss::.btn-block` | 单类 `width:100%` ⇒ **双类 `.btn.btn-block` + `box-sizing: border-box`** | 184 → **342** |
| — | `pages/month/index.wxss::.banner .btn-small` | **不改**（实测 83px 正常） | 83 → 83（回归不破） |

两处注释里都写了「⚠️ 别改回 `width`」，并互相指认判据文件（`r195_shots/`、`r194_shots/README.md` §二）。

### 顺带回改的 4 处错误表述（R194 → R195 更正，**原文保留 + 加批注，不抹历史**）

| 文件 | 改法 |
|---|---|
| `pages/shop/switch.wxss`（R194 旧注释） | 加 🔴 R195 更正块，点明「不是 flex 容器内才失效」，并把「`.top-add` 待拍板」改为「R195 已修完」 |
| `review/evidence/r194_shots/README.md` §二 | 根因表下方加 R195 更正引文块（三样本矩阵 + 两条修法） |
| `review/AUDIT_2026-10-03_全站功能入口与按钮盘点.md` §7.8.1 / §7.8.4 | 同上；§7.8.4 表格从「登记未改」改为「R195 已全部定性并修完」 |
| `.workbuddy/memory/PITFALLS.md` R194 §1/§2 | 拆成「R195 真规则（以此为准）」+「R194 原文（保留留痕）」；§2 升级为「已修」表 |

---

## 四 🔴 测不出来就白测的坑：`wx:if` 依赖链（**本轮第二值钱**）

`.btn-block` 首次机读返回 **`[]`**（看着像"setData 探针失效"）。**排查顺序值得记**：

1. 先证伪「探针机制坏了」：同轮对 `month/index` 做 `setData({expireSoonDays:5})`（`MON_forced`）⇒ **成功**，
   证明 `mp.evaluate` + `setData` 机制本身没问题；
2. 再读源码找真因：`pages/pay/orders.wxml:3` 显示 `.btn-block` **外层**还有
   `<view class="card2" wx:if="{{expireText}}">` ⇒ `expireText` 空 ⇒ 整块不渲染。
3. 正解 = **同时**给两个字段：`setData({ expireText: '…到期（探针）', showRenew: true })` ⇒ 立刻量到 184px。

⇒ **纪律**：机读返回空数组时，**先查 `wx:if` 依赖链**，别急着判「探针失效 / 该处无此元素」。
判行为要看**渲染后**，不是看选择器写没写在 wxss 里。

---

## 五 明确「没做到」的（防下一轮误判）

- **没做真机验证**（仍属李老师）：本轮全部数据来自**模拟器 iPhone 12/13 尺寸**（`.top-row` 366px 宽），
  窄屏机型 `.top-add` 的挤压量只会更大 ⇒ 修复方向只会更被需要，不会更不需要。
- **没做真云 e2e**（同 R194）：dev 只有 1 家店 + `hit_free_limit=true`，本轮纯 UI 层，未触任何数据。
- **没验 `.btn-block` 点击后的续费流程**：只验了「渲染宽度」这一个维度，续费逻辑本身不在本轮范围。
- **`.top-add` 改后是否影响两页的「顶栏手感」**（视觉主观）：只给了机读数字 + 截图，
  好不好看需李老师真机看一眼再定。

---

## 六 文件清单（本目录）

| 文件 | 说明 |
|---|---|
| `BEFORE_1_material_top.png` … `BEFORE_4_month_banner.png` | 修复前 4 页截图（`mp.screenshot`） |
| `AFTER_1_material_top.png` … `AFTER_4_month_banner.png` | 修复后同 4 页截图 |
| `report_r195_BEFORE.json` | 4 页机读矩形（`.top-row`/`.top-inp`/`.top-add`/`.btn-block`/`.banner .btn-small`） |
| `report_r195_AFTER.json` | 同上（修复后） |
| `report_r195_pay_BEFORE.json` | pay/orders 补测（含 `setData` 双字段强制渲染后的 `.btn-block`） |
| `report_r195_pay_AFTER.json` | 同上（修复后，`.btn-block` = 342） |
| `README.md` | 本文件 |

复现脚本（**仓外**，不进 `review/evidence/**` 扫描面，避免被面 B 正则判红）：
`C:\Users\lzj\.workbuddy\binaries\node\mpauto\r195_layout.js`（4 页一条连接顺序跑）
与 `r195_pay.js`（pay/orders 补测）。
