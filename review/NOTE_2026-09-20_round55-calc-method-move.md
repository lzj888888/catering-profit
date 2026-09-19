# round55 回执 · 核算方式从设置页迁入月度录入页 + 修 saveShopSetting 清空店铺名

来源：真机走查（2026-09-19）用户反馈「设置里面的摊销和库存差不单独放在这里，还是放到计算时需要用到它的地方……现在放在这里，用户不会理解」；2026-09-20 用户拍板「做吧」。

## 1. 已落

- [2026-09-20 01:35] **UI 落位已落** · 录入页新增「这两笔钱怎么算」区：① 食材消耗（按采购直接填 / 按库存盘点倒算）② 装修设备（一次性计入当月 / 按月分摊，带资产笔数 + 管理入口）；选中态 = ✓ + 墨蓝描边 + 浅蓝底三重可辨（不只靠颜色）· 证据：`grep -c onPickMethod pages/month/input.wxml` → 4；`grep -c cm-opt` → 12 · commit `c24e0a2`
- [2026-09-20 01:35] **设置页开关摘除已落** · 只留店铺名/备注 + 一句去向说明（指向月度录入页）· 证据：`grep -rn "inventory\|amortize" pages/shop/setting.js pages/shop/setting.wxml` → 仅剩注释 · commit `c24e0a2`
- [2026-09-20 01:36] **文案单源已落** · `miniprogram/i18n/terms.js::calcMethod`（25 键），双副本逐字一致 · 证据：`JSON.stringify(A)===JSON.stringify(B)` → true；`consumeInvSummary('1200.00','8000.00','1500.00')` → `已填：期初 1200.00 · 采购 8000.00 · 期末 1500.00` · commit `c24e0a2`
- [2026-09-20 01:38] **后端数据丢失缺陷已修** · `saveShopSetting` 未传 name/remark 时归一 '' 并写库 → **店铺名/备注被清空**（旧注释写"不清空已有名"，实现相反）。改为 `undefined = 不动库` / `'' = 显式清空`，与 switches 的 null 语义对齐 · 证据：`node cloudfunctions/saveShopSetting/selftest.js` → 35 通过 / 0 失败 · commit `c24e0a2`
- [2026-09-20 01:47] **后端已部署 dev** · 证据：`cli cloud functions deploy --names saveShopSetting` → `success: true, filesCount 15, packSize 19.8 KB`（首跑撞 `Updating` 并发锁，等 70 秒原命令重跑即成功，与既有记录一致）· 环境 `cloud1-d4gphpoxy337f2a25`（从 `initDb/config.json::envVariables.DEV_ENV_ID` 现读）
- [2026-09-20 01:41] **文档过期步骤已更正** · `04_核对清单.md` 第 5 步「开库存开关」改为指明新落点；喂投包 MD 两处加更正注记（服务端契约一字未改，只动 UI 落点）；重跑 `_gen_8batch_html.py` 同步派生件 · 证据：门禁 A–L 由红转绿

## 2. 未落 / 存疑（明示）

- [2026-09-20 01:47] **真机实测未做（存疑）** · 我只出了预览码（`_gui/preview_qr_calc.png`，包 141.8 KB），**没有在真机上点过**二选一。理由：切换口径会真实写库，且需人工核对「切换后店铺名是否还在」才能证伪后端修复；这一步只能李老师扫码确认。**未实测 ≠ 已验证。**
- [2026-09-20 01:47] **库存/摊销入口的可见性联动未改** · `pages/month/index.wxml` 的「库存盘点 / 摊销资产」按钮仍按 `switches.*SwitchOn` 显隐（行为不变）。新录入页内有直达入口，但月度主页的按钮要等开关写库后重进才刷新 —— 属既有行为，本轮未动。**待李老师判断是否需要录入页保存后即时刷新。**

## 3. 变异回灌（证明守卫不是假绿）

| 变异 | 结果 | 还原后 |
|---|---|---|
| 后端退回旧写法（`v.name \|\| shopDoc.name`）+ 去掉 undefined 三态 | selftest **30/35，5 条转红** | **35/35** |
| 设置页塞回一个 `<switch ...inventorySwitchOn>` | `selftest_ui_fix.js` **转红**（新防回归断言命中） | 67/67 |

门禁：67/67（含改 specs 后复跑，A–L 由红转绿）。

## 4. 顺带发现（已修，非本轮需求）

`saveShopSetting` 的 name/remark 清空缺陷是**在实现本轮 UI 时才暴露**的：以前设置页总是连 name/remark 一起传，坑埋着没被踩；一旦出现「只改开关」的调用方就会丢数据。同类写库模式已 grep 全仓（`v.name` / `v.remark` / `|| shopDoc`），**只此一处**，无漏网。
