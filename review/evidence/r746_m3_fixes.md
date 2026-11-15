# R746 · M3 审计四条真缺口修复（李老师「好的，听您的」放权）

> 承接 R745 交叉审计收敛报告的「下一轮建议顺序」：**G1 → GAP-3 → GAP-1**，顺带三个低风险项。
> K-1 的免费额度数值（3/5/20）**未拍板、未改**——G1 的文案修法本来就是改成不含数字的中性表述，正好绕开它。
> 守纪律：不采信任何自述（含我自己的）；每条修复都用真表/真函数取证；改完跑门禁。

---

## 1. G1（P0 提审红线）· 配额文案去「开通/升级/解锁」

### 证据（R745 已复核）
- `terms.js:4240` `'ERR.FREE_LIMIT': '已达免费上限，开通后解锁'`；`:2051` `quotaUsedUp: '…下一道需升级'`。
- 触发链：`saveCostCard/index.js:337 hit_free_limit → fail(FREE_LIMIT_EXCEEDED)` → `utils/api.js:60/69 msg=msgOf(code)`（后端 msg 只 console.warn）→ toast 直达老板。
- 免费期 `paywall.js:145-158` 明禁「价格/支付/开通/客服/续费/升级」；`featureFlags.js:47-48` 明写提审期出现「去开通」即整包驳回 ⇒ 这两句是**死指路 + 提审红线**。

### 改动
- `miniprogram/i18n/terms.js`（+ `specs/dev-specs/i18n/terms.js` **双副本逐字同步**）：
  - `ERR.FREE_LIMIT` → `'已达当前版本上限，你已填的内容都还在，可以正常查看和修改'`（与 `pay.freeLimitGeneric` 同源）；
  - `quotaUsedUp` → `'当前版本额度已用完 —— 这道菜已存好，已填的内容都还在，可以正常查看和修改'`（保留守卫 `check_quota_tip Q-③` 要求的"已用完 + 这道已存好"语义）。
- `tools/check_paywall_coverage.js` L9-③ 扫描面扩到 `ERR.FREE_LIMIT` 与 `card.quotaUsedUp/RemainTpl/LastOne`（原来只扫 `TERMS.pay.*`，这正是漏网原因）；新增 **L9-③b 反恒真**：把 G1 旧文案喂进同一把 BAD_WORDS 必须命中「开通/升级」，证明判据有牙。
- 守卫 38 → 39 条。

### 复验
真跑：`check_paywall_coverage` 39/0（L9-③ 文案干净 274 字符；L9-③b 旧文案命中「开通、升级」、现行文案已无）；`check_quota_tip` 18/0、`check_m1_diff_explain` 64/0、`selftest_ui_fix` 43/0 不撞。

---

## 2. GAP-3（P1 当前可达）· 营收日报缺列静默按 0 → fail-closed

### 证据（R745 真表复现）
- `revenueDailyParse.js:150-165 detectRevenueDaily` 只要求「日期/班次/现金」三列即认表；缺业务列 `get()` 返回 null → `num(null)=0` → `:377-380` 营收求和缺列按 0。
- 真表测试：完整表 `revenueM1=1188.88`，删掉「美团外卖」列后 `=300`，**少算 888.88 元**，而 `cashInflow.pass=true / mismatches=0 / identityOk=true` —— 自检恒等式两边同减仍绿，零报错。

### 改动（关键设计：不动手填路径）
- `cloudfunctions/importSalesBill/revenueDailyParse.js`：新增纯函数 `missingRevenueCols(cols)`，必需面 = 现金流入公式 ∪ M1 堂食 ∪ M1 外卖（不含对账/合计/茶楼），返回缺列的中文名；导出。
  - ⚠️ **不嵌入 `parseRevenueDaily` 内部**——手填路径（`manualToRows` 合成稀疏行）本就只有部分列，强制全覆盖会误伤。只给上传路径用。
- `cloudfunctions/importSalesBill/index.js` 营收分支：detect 命中后先过 `missingRevenueCols`；缺列则不走营收解析、记入 `revMissing`；循环结束若一个干净表都没有但有缺列表 ⇒ 走 `ok({diagnosis:{shape:'revenue_daily',reason:'revenue_missing_cols',missing:{revenue:[...]},nearest:'revenue'}})`（与 R286 认不出表同一通道，**不落库、不给预览**）。
- `subpkg/biz/revenue/index.js::showNotMine` 加 `revenue_missing_cols` 分支；i18n 新增 `TK.importDiagRevenueCols`（双副本同步）：「这张表缺：{cols}。营收日报表按这些列算收入，缺了会少算，所以这次没有导入。请按原来的列名补回这几列再导一次。」

### 新守卫 `tools/check_revenue_missing_cols.js`（22 条，已挂门禁）
- A 完整真表 16 列 missing=[]、仍能解析出营收（零回归）；
- B 逐个删 10 个必需键都被点名（含「美团外卖」GAP-3 案例）；缺「茶楼」/「营业收入」**不报缺**（不误伤合法缺列）；
- C 反证 fail-closed 不在 parse 本体（保手填路径）；
- D index.js 接线 + 前端分支 + i18n 文案；
- E 变异回灌：恒不报 / 必需面缩到 3 列必须转红。

### 复验
真跑：完整表 missing=[]、删「美团外卖+团购」→ `["美团团购","美团外卖"]`；新守卫 22/0；`check_revenue_daily` 54/0、`check_revenue_page` 42/0、`check_revenue_manual` 59/0、`check_import_encoding` 23/0 不撞。

---

## 3. GAP-1（P1 恢复开关即 P0）· 账单解析生产/自测同源

### 证据（R745 真表复现）
- R695/R700 只修了 `utils/billParse.js:70-86,313-351`；生产 `cloudfunctions/importSalesBill/service.js:141-146,317-342` 仍是旧版。
- 同一张美团退款真表 `r700_realtables/meituan_bill.json`：自测 **9081 分 / 5 单 / 6 行**，生产 **13066 分 / 5 单 / 5 行**（多算 **39.85 元 / 44%**）。
- `check_bill_realtables.js` 全仓**零断言调生产 `SV.parseBillMatrix`**（R181m 同族盲区），所以门禁全绿无人知。

### 改动（两处纯同步，生产向自测对齐）
- `service.js` meituan 档案：`rowFilter` 加 `keepContains:['退款']`、补 `orderType:'订单状态'`/`refund:'已退款'`/`refundTypeContains:'退款'`、`qtyRule` 从 `perRow` 改 `perRow_exceptRefund`。
- `service.js parseBillMatrix`：`rowFilter` 段加 kept 分支（退款放行冲减、广告保险照排）；`perRow_exceptRefund` 段加 `isRefundType`（交易类型含「退款」的形态不算有效订单）。
- 向后兼容：旧版账单无「订单状态」列时 `at()` 返回 undefined ≠ refund ⇒ qty 仍为 1，行为与改前一致（不臆造排除）。

### 新守卫 `tools/check_bill_parse_prod_sync.js`（18 条，已挂门禁）
- **A 真调生产 `SV.parseBillMatrix(美团退款真表)` 断言 9081 分**（qty=5/rows=6、与自测逐分/excluded 相等）——正是补上"零断言调 SV"的洞；
- B 两档案 5 个关键字段逐项相等 + keepContains 含「退款」；
- C 生产解析逻辑含 keepContains / isRefundType 活代码（非注释）；
- D 淘宝/京东档案未被带偏；
- E 变异回灌：删 keepContains / qtyRule 退 perRow / 真表 13066≠9081（证明 9081 非恒真）。

### 复验
真跑：改动前 13066 vs 9081（R745 证据），改动后 **生产=9081、自测=9081、差=0**，档案逐字段一致；新守卫 18/0；`check_bill_realtables` 56/0、`selftest_bill_parse` 70/0 不撞。

---

## 4. 三个低风险项

| 项 | 改动 | 复验 |
|---|---|---|
| **G3 双占位符** | `utils/paywall.js:147` `raw.replace('{n}',…)` → `replace(/\{n\}/g,…)`（freeLimitCardBody 有两个 `{n}`，原只换第一个） | 真跑：「最多支持 20 道…你已建的 20 道…」无残留占位符 |
| **P-⑥ 无效变异自证** | `check_card_live_cost.js:323-326` 原来只自证字符串替换生效、从不喂回判据（把 P-① 改恒真仍绿）；现抽 `p1Judge` 真把 mutated 喂回，断言 true→false；加 P-⑦ 防两处判据漂移 | 85 → 86 条，真跑 P-⑥「原件=true 变异=false」 |
| **5 守卫无下界保护** | `check_m3_card_roundtrip`/`margin_bands`/`page_behavior`/`storage_isolation`/`chain_clarity` 纳入 `check_suite_assert_counts.js` CASES + 声明行（原不在，删其反恒真护栏无人知） | 声明 38/15/29/40/31 ≡ 实跑，全守卫绿 |

---

## 5. 门禁与轮次
- 新套件 2 个（`revenue-missing-cols`、`bill-prod-sync`），**追加在 SUITES 末尾**而非插入中间——不打乱仓内「第 N 套件」序号声明（`check_suite_count_claims C3` 曾因此判红，本轮规避）。
- 套件 324 → **326**；两处重启键声明同步；两处断言数声明同步（38→39、85→86）+ 7 个新登记值。
- `ROUND_INDEX NEXT 745→746→747`：本轮注释里的 `R746` 字样 again 撞 `NEXT:746`（R745 收口时推到 746）⇒ 推进到 747 后 `check_auto_queue` 28/0。
- 全量门禁 `_gate_r746.log` ⇒ **326/326 套件通过、0 失败**；`check_paywall_coverage` 实跑 39 ≡ 声明 39。
- 本轮改动面：`cloudfunctions/importSalesBill/{index.js,revenueDailyParse.js,service.js}`、`miniprogram/i18n/terms.js` + `specs/dev-specs/i18n/terms.js` 双副本、`subpkg/biz/revenue/index.js`、`utils/paywall.js`、3 个既有守卫 + 2 个新守卫、断言数/套件数/重启键声明。
- **需要重新部署的云函数只有 `importSalesBill`**（GAP-3 的 index/revenueDailyParse + GAP-1 的 service 都在它里面）；G1/G3 是前端与 i18n，不用部署。

## 7. 提交、部署与真机码（收口后回填）
（见下方最终回复）

## 6. 未动 / 待拍板（如实登记）
- **K-1 免费额度 3/5/20 三值冲突**：产品口径，未拍板未改；G1 用中性文案绕开。
- F-1 `da.get` 不带 shop_id（牵 51 份派生 + 12 云函数契约）、GAP-4 api.js 全局覆盖 msg、F-2 fail-open、GAP-5 固定列序、净料成本前端/云端对拍：均按 R745 报告的定性**登记待办，本轮不动**。
- 「老板选择留置」分支：产品口径 + 新 UI，未经讨论不实装。
