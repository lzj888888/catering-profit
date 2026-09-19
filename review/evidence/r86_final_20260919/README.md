# R86 超时终值回读（2026-09-19 round46 · WorkBuddy 独立复核）

命令：`cli.bat cloud functions info --project <repo> -e cloud1-d4gphpoxy337f2a25 --names <42 个函数>`（只读）
耗时：44.4s，rc=0

**结果：42 / 42 与定值表一致；平台默认 3 秒残留 = 0**

| 函数 | 期望 | 回读 | 判定 |
|---|---|---|---|
| adminExport | 60 | 60 | OK |
| adminGrantEntitlement | 20 | 20 | OK |
| adminInit | 20 | 20 | OK |
| adminLogin | 20 | 20 | OK |
| adminLogout | 20 | 20 | OK |
| adminManualOrder | 20 | 20 | OK |
| adminOrderList | 20 | 20 | OK |
| adminQueryUser | 20 | 20 | OK |
| adminRefreshToken | 20 | 20 | OK |
| adminRefundMark | 20 | 20 | OK |
| adminRevokeToken | 20 | 20 | OK |
| archiveMonth | 20 | 20 | OK |
| calcAmortize | 20 | 20 | OK |
| calcBom | 20 | 20 | OK |
| calcMonthlyProfit | 20 | 20 | OK |
| calcSandbox | 20 | 20 | OK |
| checkQuota | 20 | 20 | OK |
| deleteAccount | 20 | 20 | OK |
| detectCycle | 20 | 20 | OK |
| exportData | 60 | 60 | OK |
| getAmortSchedule | 20 | 20 | OK |
| getCardVersions | 20 | 20 | OK |
| getCostCard | 20 | 20 | OK |
| getLedger | 20 | 20 | OK |
| getMaterial | 20 | 20 | OK |
| getMonthList | 20 | 20 | OK |
| getShopContext | 20 | 20 | OK |
| getShopList | 20 | 20 | OK |
| initDb | 30 | 30 | OK |
| payCallback | 20 | 20 | OK |
| payCreateOrder | 20 | 20 | OK |
| payExpireNotify | 20 | 20 | OK |
| payOrderList | 20 | 20 | OK |
| payQueryEntitlement | 20 | 20 | OK |
| payRenew | 20 | 20 | OK |
| saveAsset | 20 | 20 | OK |
| saveCostCard | 20 | 20 | OK |
| saveLedger | 20 | 20 | OK |
| saveMaterial | 20 | 20 | OK |
| saveShopSetting | 20 | 20 | OK |
| smokeTest | 15 | 15 | OK |
| syncCostCard | 20 | 20 | OK |