# NOTE · R298-D2「配置缺省静默 fallback」审计与修复（裁决态）

> 日期：2026-10-16 ｜ 起点 `7347676`（D1 已推）｜ 计划出处 `review/PLAN_R297_下一轮审计与修复计划.md` §D2
> 性质：**审计面**（豆包提出、PLAN 定稿：「先出逐个判定表，成立才修；不成立登记」）
> 纪律：不采信自述，只认机器证据；每改必有守卫 + 变异证明

---

## 0 一句话结论

全仓 **81 处**「业务比率字段 + 缺省 0」里，**80 处是有意设计或无害**（哨兵值 / 有业务语义的默认 / 用户可感知的表单默认），
**唯一真缺陷 = `netUnitCostWan` 五副本的裸除**：出成率 0 ⇒ `÷0` = **Infinity**；缺失/空串 ⇒ **NaN**；>100 ⇒ 成本被**系统性低估**。
> 已修（加夹紧）+ 扩守卫（E 段）+ 变异 **9/9** 如期。

---

## 1 取证口径（可复现）

探针 `_probe_tmp/r298_d2_scan.py`：扫 `pages/ utils/ cloudfunctions/ miniprogram/` 下所有 `.js`，
取「比率字段族 ∩ 缺省 0 形态」的交集。

- **比率字段族**：`yield_rate` / `loss_rate|loss_pct` / `commission*` / `*Rate` / `*Pct` / `*Ratio`
- **缺省 0 形态**：`X || 0`、`X != null ? X : 0`、`X ? X : 0`
- **命中 81 行**（原始清单见探针输出）

---

## 2 逐个判定表（**这是本轮 D2 的核心产出**）

| 族 | 行数 | 代表位置 | 判定 | 依据 |
|---|---|---|---|---|
| **`netUnitCostWan` 裸除** | **5 副本** | `cloudfunctions/{calcBom,getMaterial,saveCostCard,saveMaterial,syncCostCard}/service.js` | 🔴 **真缺陷（已修）** | 见 §3 |
| `yield_rate` 缺省 0 | 12 | `card/edit.js:348,536`、`material/index.js:96`、`getCostCard:51`、`getCardVersions:51`、`saveCostCard:213,379`、`saveCostCard/service:52`、`syncCostCard:107,252,340`、`syncCostCard/service:34` | ⚪ **哨兵设计（无害）** | 合法值域 (0,100] **不含 0** ⇒ 0 可安全当「无值」标记；下游一律以 `!yr` / `m.yield_rate ?` 判空 ⇒ 表现为「不显示 / 不参与」，**不产生错误数字** |
| `loss_pct` / `loss_rate` 缺省 0 | 8 | `card/edit.js:365,674,715,859,911,977`、`card/index.js:364`、`card/version.js:74,154`、`calcBom/validate.js:57`、`saveCostCard/validate.js:106`、`getCostCard/service.js:18`、`getCardVersions/service.js:18`、`syncCostCard/service.js:84` | ⚪ **有业务语义的默认** | 损耗率 0 = 「不损耗」，是**合法且最常见**的默认值；且该字段在卡片编辑页**用户可见**（`card/edit.js:195 lossRate: 0`）⇒ 非静默 |
| `commission_rate` / `ratePct` 缺省 0 | 5 | `takeawayDerive.js:33,35,165`、`grouponDerive.js:29`、`takeaway/index.js:383` | ⚪ **有意口径（红线）** | `grouponDerive.js` 红线④原文：「**费率没有默认值**：店家不填即按 0 计，**绝不替他编一个数**」；纯试算、不落库、不进 M1 |
| `rentPct` 缺省 0 | 3 | `bizPreset.js:366,422,443` | ⚪ **有意兜底** | 三处均带 `if (fen > 0)` 且房租缺失时另有 `RATE_COST_FLOOR[bizKey] × 城市系数` 兜底（注释已明示口径） |
| 平台费率（试算页） | 5 | `sandbox/index.js:435-438,735-737` | ⚪ **试算页** | M2 试算，输入框就摆在用户眼前；`off ? 0 : …` 是开关语义 |
| `takeawayRatio` / `groupRatio` | 3 | `sandbox/index.js:436,731,732` | ⚪ 同上 | 渠道占比，用户填 |
| `*Pct` 展示/派生 | 13 | `dishreview:20,362,374,390-392`、`month/result:123`、`getDishReview:92` 等 | ⚪ **只读展示** | 由云端返回或本地派生，0 是合法展示值 |
| `marginPct` 试算 | 2 | `sandbox/index.js:677`、`sandbox/matrix.js:307` | ⚪ 试算页 | 同上 |
| 金额 / 数量 `Number(x) \|\| 0` | 余量 | `month/*`、`takeaway/index.js:377` 等 | ⚪ **工程兜底** | 无金额 ⇒ 0 元，语义正确 |

> **判定口径（可迁移）**：`|| 0` 是否可疑，取决于**该字段的合法值域是否含 0**：
> 含 0（金额 / 数量 / 损耗率 / 费率）⇒ 0 是**有意义的值**，兜底合理；
> 不含 0（**出成率**，合法域 (0,100]）⇒ 0 只能是**哨兵**（要确保下游按「无值」处理），**绝不能参与除法**。

---

## 3 真缺陷：`netUnitCostWan` 五副本裸除（🔴 已修）

### 3.1 现象（修前）

```js
function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);
  return Math.round(yuan * 10000);
}
```

`Math.round(...)` **拦不住** Infinity / NaN（`Math.round(Infinity) === Infinity`）。五种输入直接爆：

| 输入 | 结果 | 后果 |
|---|---|---|
| `yieldRate = 0` | `÷0` ⇒ **Infinity** | 净料成本无穷大 ⇒ 保本点无穷 ⇒ 全是乱数 |
| `yieldRate = undefined / ''` | `÷NaN` ⇒ **NaN** | 全链路 NaN 传播 |
| `yieldRate = 150` | `÷1.5` ⇒ 成本 **−33.3%** | 毛利虚高（R297 已在**前端**拦，云端未防） |
| `convertFactor = 0` | `÷0` ⇒ **Infinity** | 同上 |

### 3.2 可达性（不夸大也不缩水）

- `saveMaterial/index.js:60` → 由 `validate.js` 保证 `yield_rate ∈ (0,100]`、`convert_factor > 0` ⇒ **安全**
- 🔴 **`saveCostCard/index.js:201`**：`netUnitCostWan(ln.unit_price_fen, 1, ln.yield_rate)` —— **手工行**，
  该 `ln.yield_rate` 来自**前端请求体**，云端 `validate.js` **不管这一格** ⇒ **可达**（前端 `badYieldOf` 是唯一防线，
  一旦前端被绕 / 新调用方出现 ⇒ Infinity 静默落库）。**这正是「纵深防御缺口」**。

### 3.3 修法

五副本统一加**夹紧**，口径与前端单源 `utils/units.js::yieldRateOf` 一致（**未填 = 100，不折损**）：

```js
const y = Number(yieldRate);
const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;   // 越界 / 缺失 ⇒ 100（中性值）
const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1; // 换算系数 ≤0 ⇒ 1
```

- **合法路径零漂移**（`yr = y`、`cf = cf`，公式一字未变）
- 改动落点（5 文件，`+8/-1` × 4 + `+7/-1` × 1）

### 3.4 为什么不改成「抛错」

`netUnitCostWan` 是**纯计算**，且 `saveCostCard` 的既有约定是 **fail-soft**（存量行缺字段不崩）。
抛错会让「老数据 / 手工行空出成率」直接 500；夹紧是**与该约定一致**的保守解。

---

## 4 守卫：`tools/check_yield_rate_range.js` 新增 E 段

原守卫只守**上界**（`|| 100` 裸兜 / `yieldRateOf` 归一），**不守「云端五副本的除法安全」**。

| 断言 | 判据 |
|---|---|
| **E-①** | 五副本均可解析并求值（`fail-closed`：读不到 / 求不出即红） |
| **E-②** | **合法域** 4 组 × 5 副本 = 20 点全中（**证明夹紧未改合法路径行为**） |
| **E-③** | **越界 / 缺失** 10 组 × 5 副本 = 50 点**全部有限**且等于夹紧值（禁 Infinity / NaN） |
| **E-④** | 裸实现与夹紧实现在 **4 个边界样本上全部有差异**（证明 E-③ 不是恒真） |

> 实现细节：用**正则从源码文本提取函数体 + `new Function` 求值**（零 `require`、零副作用）。
> `calcBom` 版写法不同（用 `purchasePerGramYuan` 辅助）⇒ 判据**判行为不判字面**，不硬钉逐字一致。

**修前首跑即红**：E-② 报 `netUnitCostWan(1000, 500, 100) = 200` —— 是**我自己期望值算错**（1000分/500 ÷100% = 0.02 元 = 200 万分），
守卫当场抓出，改为 200 后 **24 通过 / 0 失败**。这是「守卫有分辨力」的自证。

---

## 5 变异回灌（9/9 如期）

脚本 `_probe_tmp/r298_d2_mut.py`（纯内存备份 / 每条独立 / 锚点须命中 1 次 / 字节级还原）。

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| A1 | `saveCostCard` 整块退回裸除（旧 bug 复现） | 点名 E-③ | ✅ `副本2(1500,500,0)=Infinity(应 300)` |
| A2 | `syncCostCard` 退回裸除（只坏 1/5 副本） | 点名 E-③ | ✅ `副本4=Infinity` |
| A3 | 夹紧**方向错**（缺失给 0 而非 100） | 点名 E-③ | ✅ |
| A4 | 上界放宽到 1000（>100 不再夹） | 点名 E-③ | ✅（+E-④ 差异降为 3/4，噪音红） |
| A5 | 删换算系数夹紧（`cf=0 ⇒ Infinity`） | 点名 E-③ | ✅ |
| A6 | 函数名改掉（判据读不到） | 点名 E-① | ✅ |
| A7 | 下界放行 0（`y > 0` ⇒ `y >= 0`，÷0 重现） | 点名 E-③ | ✅ |
| **B1** | **等价改写**（`&&` 链 ⇒ `!(<=)` 形式） | **不该红** | ✅ 全绿 |
| **B2** | 仅加注释（零语义变化） | **不该红** | ✅ 全绿 |

**还原后**：`rc=0`、`❌=0`、**字节级一致 = True**。

---

## 6 本轮踩到的坑（已沉淀）

1. 🔴🔴 **`git status` 会漏报行尾漂移**（本仓 `core.autocrlf=false`、**无 `.gitattributes`**）：
   第一版补丁按「工作树字节含 `\r\n` 则按 CRLF 展开」处理 `calcBom/service.js`，结果把它从**纯 LF 变成全 CRLF**，
   而 `git diff --numstat` 立刻报 **`170/164`**（整篇改写）。
   ⇒ **定式**：改仓库文件前先 `git show HEAD:<path>` 看 blob 行尾；**正解 = 从 HEAD blob 改、按 `\n` 写回**，而不是从工作树读。
   ⇒ 同族纪律：**判「文件是否真被改」必须用 `git diff --numstat`，不能只看 `git status`**。

2. 🔴 **期望值算错会被守卫当场抓住**（E-② 首跑红）。这是守卫的价值，不是麻烦 —— 别为了让首跑好看而放宽判据。

3. **五个副本「行为同源、写法有别」** ⇒ 守卫必须**判行为**（同输入同输出）而非**逐字一致**，否则 `calcBom` 版会被假红。

---

## 7 登记（未修 / 待办）

| 项 | 状态 | 理由 |
|---|---|---|
| `yield_rate` 12 处缺省 0 | ⚪ **登记为「哨兵设计」不修** | 合法域不含 0 + 下游判空 ⇒ 无害；若要更贴单源，可另立一批统一为 `yieldRateOf`（**非缺陷，不夹进本轮**） |
| `commission_rate` 等费率缺省 0 | ⚪ **登记为「有意口径」不修** | 红线⑦「绝不替他编一个数」；**改动反而违反产品口径** |
| 云端 5 文件需**部署**才生效 | ⏳ **待部署** | C 线冻结 ⇒ 本批只提交代码；部署由李老师控制 |
| M3 试算页「未填费率」缺提示 | ⏳ 待拍板 | 属 UX 改进（非错账），同 C-② 归档出路提示一批 |

---

## 8 证据文件

- 扫描探针：`_probe_tmp/r298_d2_scan.py`
- 补丁脚本（两阶段）：`_probe_tmp/r298_d2_patch.py`、`_probe_tmp/r298_d2_guard_patch.py`
- 变异回灌：`_probe_tmp/r298_d2_mut.py`
- 门禁输出：`_probe_tmp/gate_r298.txt`
