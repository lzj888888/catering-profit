# R747 · 净料成本对拍 + DSI-1 行级错误通道（李老师「继续下一步工作」放权）

> 承接 R745 收敛报告的未完成清单。本轮只做**不需要产品拍板**的两项：
> ① 净料成本前端/云端对拍守卫（数字链路覆盖缺口 + GitHub 学到的参数化对拍器）
> ② GAP-4 DSI-1 行级错误透传（G1 同根治本，但用局部修法而非全局改 api.js）
>
> **K-1 额度 3/5/20、留置分支、F-2 fail-open 口径需产品拍板，本轮未动。**

---

## 1. 净料成本参数化对拍器（`tools/check_net_unit_parity.js`，13 条）

### 审计发现（R745 B4）
- 前端 `utils/units.js::netUnitWanOf` 用**完整元精度**（`priceToBase` 返回浮点元）；
- 云端 5 份 `netUnitCostWan` 收**整数分**，先 round 到分再算；
- 对齐 cf=1 后实测：10 万组里 2 位小数日常输入 **31%** 不等、3 位小数 **93%** 不等。

### 关键判断：不是当前错钱，是覆盖缺口
- **主链路**走前端快照：`edit.js` 调 `netUnitWanOf` → 送 `net_unit_cost` 整数 → `validate.js` 二选一（有快照就不再重算）⇒ 云端 `netUnitCostWan` **不参与主链路**。
- 所以差异**不外显**，属"两条录入路径精度契约不同"，不是引擎 bug。
- ⇒ **本轮不改公式**（改了会破坏现有锚点），而是把三条关系钉死。

### 守卫判据（每条真跑）
- **A** 云端 5 副本逐点等价：确定性种子 5 万组，**0 差异**。
- **B** 前端快照 vs 云端重算：2 万组里 6092/20000（**30.5%**）不等；差异**双向且对称**（front<cloud 3097 / front>cloud 2995，比例差 0.017），量级有限（max 5000 万分 = 0.5 元）。
  - ⚠️ 首版我假设"前端不会系统性低估"被真跑证伪（3097>2995）——差异是分位截断抖动，方向随机，不是单向偏移。判据改为统计对称性。
- **C** 主链路契约：编辑页走快照 + validate 二选三分支全覆盖（input / snapshot / 都没有报错）——差异不外显的前提。
- **D** 契约歧义陷阱量化：6 元/斤（factor=500）前端完整精度 120 万分 / 云端分位截断 100 万分（差 0.002 元）；误把"原单位分 600"喂 cf=1 得 60000 万分（**600×** 灾难性且零报错）。
  - ⚠️ 首版我假设"差 factor=500 倍"被真跑证伪（实际 600×，因 0.012 元被截成 1 分而非 1.2 分）。判据改为"≥100 倍即灾难"。
- **E** 变异回灌：漏除出成率 / 前端也收整数分（差异消失）两个变异体都必须转红。

### 价值
这是 GitHub `property-based-testing` 学到的**参数化对拍器**落地：一个守卫用确定性种子跑 7 万组，取代"每个函数手写固定样例"的旧法；并明确区分"客观差异存在"与"当前流程外显"（engine-truth-audit §C/D 纪律）。

---

## 2. GAP-4 · DSI-1 行级错误透传（`tools/check_dsi1_error_channel.js`，13 条）

### 审计发现（R745 B2）
- `cloudfunctions/importSalesBill/index.js::handleDSI1Import` 原写 `fail(INVALID_PARAM, parsed.error)`，注释承诺"人话+行号原样透出"；
- 但 `utils/api.js:60/69` 把 fail 的 msg **整条覆盖**成 `msgOf(code)` 通用文案（原始 msg 只落 console.warn）⇒ 老板只看到"参数有误"，照着改不了表（R298Y「读到了≠送出去了」同族）。

### 关键判断：不能全局改 api.js
- 全云函数有 **82 处** `fail(code, 具体 msg)`，其中大量是**不该给老板看的技术细节**（`user_id 必填`、`plan_id=plan_free`、admin 内部错误）。
- api.js:2026-09-25 的注释明确"不改 UI 文案口径，只落日志供排障"——是**有意设计**。全局透传会倒退。
- ⇒ **局部修法**：只把 DSI-1 解析错误改走 ok 的 data 诊断通道（与 R286 认不出表、R746 缺列同一条），fail-closed 语义不变。

### 改动（前后端两处，闭环）
- 云函数：`handleDSI1Import` 解析失败 → `ok({diagnosis:{shape:'dsi1',reason:'dsi1_invalid',detail:parsed.error}})`，不落库、不预览、不给确认按钮。
- 前端 `subpkg/biz/takeaway/index.js::diagnosis` 块加 `dsi1_invalid` 分支：`body = dg.detail`（后端 dsi1.js 文案单源，前端不重造）。
- **api.js 未动**：82 个其他 fail 的 msg 仍不会泄漏给老板。

### 守卫判据
- A 云函数确实改走 ok diagnosis（源码形态 + 不再有旧 fail + detail 带行号）；
- B 前端确实消费 `dsi1_invalid.detail`（前后端都改才闭环）；
- C api.js 全局覆盖设计未被动（防倒退）；
- D 真跑 `dsi1.js::parse`（7 列标准表、销量填 abc）⇒ 错误文案「销量或销售额不是数字（销量）：第 2 行「abc」」带行号人话；
- E 变异回灌：把云函数改回旧 fail / 前端摘掉分支，两条判据都必须转红。

### 复验
真跑 13/0；`check_dsi1_parse` 59/0、`check_dsi1_page_stub` 18/0、`check_import_diagnosis` 1/0、`check_import_ai_fix` 21/0、`check_bill_import_gate` 49/0 不撞。

---

## 3. 门禁与轮次
- 新套件 2 个（`net-unit-parity`、`dsi1-error-channel`），**追加在 SUITES 末尾**不打乱序号。套件 326 → **328**。
- 两处重启键声明、两处断言数声明同步（新增 13+13）。
- `ROUND_INDEX NEXT 746→747→748`：本轮注释里的 R747 字样撞 NEXT:747（R746 收口时推到 747）⇒ 推进到 748 后 auto_queue 28/0。**第三次踩同类撞车**（R745/R746/R747 连续三轮），建议后续把"证据件/注释里的轮次号"从守卫扫描面解耦（见 R745 报告 §5D）。
- 全量门禁 `_gate_r747.log` ⇒ **328/328 套件通过、0 失败**；套件数守卫 11/0、auto_queue 28/0、行尾守卫绿。
- 改动面：`cloudfunctions/importSalesBill/index.js`（DSI-1 fail → ok diagnosis）、`subpkg/biz/takeaway/index.js`（前端 dsi1_invalid 分支）、2 个新守卫、断言数/套件数/重启键声明、NEXT。
- **需重新部署的云函数只有 `importSalesBill`**（DSI-1 分支在它里面）；`check_net_unit_parity` 纯守卫不改产品；前端 takeaway 页随小程序包发布（真机码）。

## 4. 未动 / 待拍板（如实登记）
- **K-1 免费额度 3/5/20 冲突**：产品口径，未拍板；R746 的 G1 用中性文案绕开，但规范冲突仍在。
- **「老板选择留置」分支**：残值变卖收入录入 + 新 UI，未经讨论不实装。
- **F-2 fail-open**（getDishReview/getSalesBills 缺区间全返）：需定产品口径（fail-closed / 默认本月 / 保持全返），R719 §6 已登记待拍板。
- **F-1 da.get 不带 shop_id**（跨店改写，正常路径不可达）：改 `common/dataAdapter.js` 触发 51 份 cx_ 派生 + 12 云函数契约，属架构级决策，需单独一轮会诊。
- **GAP-5 固定列序**（形态 A 堂食表按列序取数）：依赖 POS 列序稳定，非当前错钱。
