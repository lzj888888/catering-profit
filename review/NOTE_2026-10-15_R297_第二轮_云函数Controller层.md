# R297 · 第二轮查缺补漏：云函数 Controller 层

- 范围：`cloudfunctions/*/index.js`（Controller 层）为主，M1 / M2 / M3 相关 30 个云函数
- 门禁：**172/172 全绿**（新增 1 座守卫）
- 结论：**1 个真漏洞（M2 场景矩阵零校验）已修**；其余面判定为**已纵深防守**，勿重复开挖。

---

## 一、先做机器可判的一面（都不是漏洞，结论归档）

| 检查 | 结果 |
|---|---|
| 有 `validate.js` 却没被 `index.js` require | 只有 `payExpireNotify`（定时任务桩，`validate.js` 是空实现）⇒ **非漏洞** |
| `validateInput` 实际调用次数 | 30 个 Controller **全部 ≥1 次** ⇒ 无 require 级架空 |
| 未 `return` 的 `fail(...)` 调用 | **0 处** |
| `catch` 吞异常后返回成功 | **0 处**（一律 `return fail(...)`） |
| Controller 直读 `event.xxx` | 除 `shop_id` 外仅 `calcSandbox.action/clean_array/client_request_id`、`saveDishMapping.input`（后者两种形态都过 `validateBatch`/`validateInput`） |
| 元/分混用 | `getCostCard:83` 两个分支（`sub.total_cost` 与 `net_unit_cost/100`）**同为分**（落库 `total_cost = unit_cost_fen` 整数分）⇒ **非漏洞** |
| `Number(x) \|\| n` 非零兜底 | 仅 `co.rent \|\| 1`（城市系数中性值）、`free_limit \|\| 1`（最严档）、`doc.version \|\| 1`（展示）、`plan.days \|\| 30`（admin）⇒ 均正确 |

---

## 二、真漏洞：M2「场景矩阵」分支**完全绕过入参校验**

| 项 | 内容 |
|---|---|
| 位置 | `cloudfunctions/calcSandbox/index.js` 的 `action:'matrix'` 分支（原 `arr.map((c) => calcSandbox(c))`） |
| 触发 | 矩阵页四档维度（房租/人数/毛利率/目标利润）是**自由文本** —— `onDimInput` 只管存，`onGenerate` 只判 `isFinite`，**无范围校验** |
| 后果 | 越界值静默进引擎 ⇒ 算出一个**能看但错**的数，零报错 |

**实测**（探针 `_probe_tmp/r297_matrix_robust.js`，基准保本 46,111.12 元）

| 老板填的 | 保本点 | 说明 |
|---|---:|---|
| 基准（毛利率 60） | 46,111.12 元 | 正确 |
| **毛利率 150** | **18,444.45 元** | 不该算出来（单算路径会被 validate 拒） |
| **房租 −8,000** | **19,444.45 元** | 同上 |
| **fixedItems 缺失** | **2,777.78 元** | 同上 |
| 年限缺失 / 填 0 | 保本 **−5.7%** | 引擎 `if (years > 0)` ⇒ 建店投入**完全不摊** |

偏差方向**一律是「保本更低 = 更好看」** —— 最危险的一类。
注：毛利率 0 / 缺失 / 负数、变效率 300 这几项引擎自身是 fail-closed（返回 null），**不是**漏洞；
真正的洞在「引擎能算但算错」的区间（>100、负数、缺项）。

**同族病第三例**：单源 `validate.js` 写了，但被 `action:'matrix'` 这条**另一入口**架空成死代码
（第一轮两个：建店年限、出成率上界，都是被**前端**架空；这一轮是被**云端另一分支**架空）。

### 修法（单源，不是复制第二套）

1. `calcSandbox/validate.js`：字段级判据抽成 **唯一实现 `checkClean(clean, isReverse)`**；
   `validateInput`（wire/snake 入口）与新增的 `validateClean`（clean 入口）**共用**。
   另加 `normalizeClean()`：只补缺省（年限取 `indicatorRef.BUILD_DEFAULT_YEARS`、validDays/expectedRevenueFen 补 0），
   **不把非法值改合法**（那是"静默替老板编数"）。
2. `index.js` matrix 分支：逐行 `validateClean` ⇒ 算不出的档位给 **null + `rejected` 人话**；
   **全部**算不出 ⇒ 响亮 `fail`。绝不拿一个"能算但错"的数顶上。
3. `pages/sandbox/matrix.js`：
   - `badDimOf()` 发起前体检（毛利率 0~100、房租/人数/目标利润非负），报「第 N 档 X 要在 a~b（现在填了 c）」；
   - `toRow` 对 `res == null` 给占位行（旧码直接解引用 ⇒ TypeError ⇒ **整张矩阵崩成一句"出错"**）；
   - `rejected` 上屏提示（静默丢档 = 老板以为算过了）。

### 修复后实测（`_probe_tmp/r297_matrix_fix.js`）

| 场景 | 结果 |
|---|---|
| 毛利率 150 / −20 | ❌ 拒：`grossMarginPct 必须是 ∈ [0,100] 的 number（%）` |
| 房租 −8000 | ❌ 拒：`fixedItems[0].fen 必须是非负整数分` |
| 变效率 300 | ❌ 拒：`varItems[0].pct 必须是 ∈ [0,100] 的 number` |
| 年限 0 / 99 | ❌ 拒：`buildItems[0].years 必须是 1~20 的整数` |
| fixedItems 缺失 / bizType 非法 / cityTier 非法 / key 重复 | ❌ 拒（各自人话） |
| 年限**缺失** | ✅ 补单源默认 3 年 ⇒ 46,111.12（与单算**同数**） |
| 毛利率 0（边界） | ✅ 放行（引擎自会 fail-closed） |
| 混合批次（3 档中第 2 档非法） | `46111.12 / null / 46111.12` + rejected 明细 |

另验：合法档位**修复前后同数**（46,111.12）⇒ 修复没有改变正常结果。

---

## 三、新增守卫：`tools/check_matrix_validate.js`（40 断言）

- **P 前置**（12 条）：导出齐全、`matrix` 分支真的调 `validateClean`、仍批量复用 `calcSandbox`、
  算不出的档位置 null、页面有 `badDimOf` 且 `onGenerate` 真调、`toRow` 有空值占位。
- **A 行为级**（14 条）：10 负 + 4 正，**真跑 `validateClean`**（非文本匹配）。
- **B 单源**（5 条）：存在 `checkClean` 单一实现；两个入口都调它；`validateInput` 体内**无第二套白名单判据**；
  `MAX_BUILD_YEARS` 只定义 1 次。
- **C 变异互证**（3 条）：绕过校验直接喂引擎**确实算出 18,444.45** ⇒ 证明本守卫不是空转；
  合法档位修复前后同数；引擎对 years 缺失确实完全不摊。
- **D 护栏**（6 条）：页面真判 0~100 上界 / 判非负 / 空档不误判 / 扫描面非空 / rejected 返前端 / 断言数 ≥20。

**变异回灌（证明非假绿）**：
- 把 matrix 分支改回零校验 ⇒ **P-⑦ 转红**；
- 去掉 `onGenerate` 里的 `badDimOf()` 调用 ⇒ **P-⑪ 转红**；
- 还原后 40/40 全绿。

---

## 四、本轮顺带改的一处守卫判据（需李老师知悉）

`tools/check_m2_matrix.js` 原断言硬钉字面量 `arr.map((c) => calcSandbox`（实现细节）。
修这个 bug 必须在调引擎**之前**插逐行校验，回调签名必然从 `(c)` 变 `(c, i)` ⇒ 字面量判据会把"修 bug"判红。
已改为**判语义**：matrix 分支须 `arr.map(` + 调 `calcSandbox(`（批量复用引擎、引擎零改），
并**加严一条**：必须调 `validateClean(`。**方向是加严，不是放宽。**

---

## 五、第二轮剩余面（尚未开挖，供第三轮）

1. `_adminCore` / admin* 系列（本轮按作用域排除，未审）。
2. `exportData`/`saveLedger` 的出参与前端落盘路径一致性（M1 导出/打印链路）。
3. `importSalesBill` 多平台解析分支（京东/美团「结算金额」同名列误判是已知雷区，R259/R282 口径）。
4. `syncCostCard` 套餐子卡**版本锁定**在同步链路上是否真锁住（M3 口径要求锁版本）。
