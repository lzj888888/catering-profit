# 评审请求 · 微信小程序「店算」M1 修复批

请以**假想敌**立场挑错，只挑错、不要客套，简短分点。

## 架构
微信小程序；前端 `pages/` + `utils/`，后端云函数 `cloudfunctions/`（无自建服务）。M1 = 月度盈利模块。审计出 4 条，已拍板全批修。

## C1【P1 空态不可达】
- `pages/month/result.js` 的 setData 里 `r: {income:..., expense:...}` 是**无条件**赋值（成功路径永远得到真值对象，覆盖初始 `r:null`）。
- `result.wxml`：第 2 行 `wx:if="{{loading}}"`；第 6 行 `wx:elif="{{r}}"`；第 174 行 `wx:else`（空态，「本月还没记账」+ 去录入按钮）。
- 作者意图写在 `result.wxml:1/173` 注释：「三态拆分 = loading / 有结果 / 空态（**无账本或接口异常**）」⇒ 意图要求「无账本」也走空态。
- 实测：空态**只在 catch（接口异常）路径可达**，「无账本」这个**正常态不可达** ⇒ 未建档月份显示**红带「亏损」+ 全 ¥0.00 + 可导出空报表**。
- 入口可达：`month/index.wxml:75`「查看结果」按钮**无 wx:if**，恒显示。
- 云端 `getLedger` 对无账本记录月返回「默认空账」（result 对象恒存在）⇒ 判据不能用 result/r，只能用 `account_id`（`getLedger:177` 出参 `account_id = acct ? (acct.account_id || acct._id) : ''`）。
- 修法：result.js setData 加 `hasLedger: !!(d && d.account_id)`；wxml:6 改为 `wx:elif="{{hasLedger}}"`。

## C2【中 同族】
`pages/month/index.js:129` `const r = d.result || null;` 恒真；`wxml:34` `wx:if="{{result}}"`。
修法：`const hasLedger = !!d.account_id; const r = hasLedger ? (d.result || null) : null;`

## C3【中 前后端不等价】归档后 7 天宽限
- 云端 `cloudfunctions/saveLedger/index.js:64-68`：
  `const archivedAt = existing.archived_at || now;` `const withinGrace = (now - archivedAt) < GRACE_DAYS_MS;`
  ⇒ 缺字段时 `archivedAt = now` ⇒ `(now - now) = 0 < 7天` ⇒ 判「在宽限内」⇒ **fail-open**，允许补录。
- 前端 `utils/ui.js::withinGrace`：`if (!archivedAtMs) return false;` ⇒ 缺字段时 **fail-closed** 锁死。
- 修法：云端 `|| now` → `|| 0`。
- 诚实标注：当前**可达性 = 0**（`archiveMonth` 正常路径恒写 `archived_at = now`），定级「防御缺口」；但它是**写锁**且方向是 fail-open。

## C4【低】
`utils/ui.js` `withinGrace(archivedAtMs, nowMs)` 的 `nowMs` 是**死参**（函数体用 `Date.now()`，从不读 `nowMs`）。
修法：`const now = nowMs || Date.now(); return (now - archivedAtMs) < GRACE;`

## 请回答（简短分点）
1. C1 有无漏掉的可达路径或绕过点（tab 切换 / 下钻 / amortize 返回）？改成 `hasLedger` 会不会把「老板真填了但利润恰为 0」的**合法月份**误判成空态？
2. `account_id` 是否严格等价于「有账本记录」？有无反例边界（如 account_id 有值但账本为空、或账本有值但 account_id 为空）？
3. C3 改 `|| 0` 会否误伤历史老数据（`archived_at = null` 但用户确实在宽限期内）造成投诉？有无第三种更稳写法？
4. C4 改 `nowMs || Date.now()` 的隐患？
5. 这 4 条该不该拆批？改 wxml 必然撞红既有守卫（`tools/selftest_ui_fix.js:17` 硬钉 `/wx:elif="\{\{r\}\}"/` 正则）——正确做法是**改守卫断言**还是**改判据**？
