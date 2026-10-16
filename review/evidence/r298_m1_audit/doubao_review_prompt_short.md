微信小程序「店算」M1 修复批。请以假想敌立场挑错，**简短分点，只挑错**。

1) `pages/month/result.wxml` 第 6 行 `wx:elif="{{r}}"` 改为 `wx:elif="{{hasLedger}}"`（`hasLedger = !!d.account_id`）。
   缘由：云端 getLedger 对「无账本记录月」返回「默认空账」⇒ `result` 恒存在 ⇒ `r` 在成功路径恒真 ⇒ 空态分支只在 catch（接口异常）路径可达 ⇒ 未建档月份误显示红带「亏损」。入口 `month/index.wxml:75`「查看结果」按钮无 wx:if，恒显示。
   问：有无漏掉的可达路径或绕过点（tab 切换 / 下钻 / amortize 返回）？会不会把「老板真填了但利润恰为 0」的合法月份误判成空态？
2) `account_id` 是否严格等价于「有账本记录」？有无反例边界（account_id 有值但账本为空，或反之）？
3) 云端 `cloudfunctions/saveLedger/index.js` 归档宽限判据 `existing.archived_at || now` 改为 `|| 0`（前端 `utils/ui.js::withinGrace` 是 `if (!archivedAtMs) return false`，fail-closed）。
   问：会不会误伤历史老数据（archived_at = null 但用户确实还在 7 天宽限内）造成投诉？有无第三种更稳写法？
4) `utils/ui.js::withinGrace` 第二参 `nowMs` 原为**死参**，改为 `const now = typeof nowMs === 'number' ? nowMs : Date.now()`。隐患？
5) 改 wxml 必然撞红旧守卫（它硬钉正则 `/wx:elif="\{\{r\}\}"/`）。我的做法：**把守卫断言从「存在性」升为「可达性」**，而不是回退业务码。这个取向对吗？还有别的该防的吗？
