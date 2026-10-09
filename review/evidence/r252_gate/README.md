# R252 · 已导入账单「查看 + 清除」交付证据

> 触发：R251 真机走查第 ④ 问「复盘页没有清除键、只有一个『去映射』」。
> 坐实的真缺口：`external_sales_daily` **全站只有写入、没有删除**
> （写 3 处 `.set()` / 读 1 处 `da.listAll` / 删 **0** 处）
> ⇒ 导错了看不见也删不掉；且「去映射」名不副实（跳 `/pages/card/index` = 去**建**卡）。

## 1 交付物

| 类型 | 文件 |
|---|---|
| 方案 | `review/PLAN_2026-10-09_已导入账单查看与清除.md` |
| 新云函数 | `cloudfunctions/getSalesBills/`（只读列表） |
| 新云函数 | `cloudfunctions/clearSalesBills/`（软删） |
| 单源 | `cloudfunctions/common/salesBillId.js::parseSalesBillId` |
| 守卫 | `tools/check_salesbills.js`（**43** 断言 / 7 组） |
| 页面 | `pages/m3/dishreview/index.{js,wxml}` 新增「已导入账单」区 |
| 词条 | `miniprogram/i18n/terms.js` +15 键（已 cp 至 `specs/dev-specs/i18n/terms.js`） |

## 2 判据（全部实跑）

```
函数目录数        47 → 49（getSalesBills / clearSalesBills）
sync_common       49 个目录同步 ✅
check_fn_inventory F1~F5 全绿 · 实测 函数 49 / selftest 45
check_salesbills  43 通过 / 0 失败
两函数 selftest   16 / 0 · 16 / 0
门禁              158/158 通过 · miss=0 · 零真 FAIL   ← gate_final_confirm.txt
变异回灌          9/9 抓到 · 组 B 3 条未假红 · 还原后逐字节回绿
页面行为真调      23 通过 / 0 失败
```

- `gate_final_confirm.txt` —— 最终确认门禁（`====== 总览：158/158 套件通过 ======`）
- `mut_backfill_r252.py` / `mut_backfill.out.txt` —— 变异回灌
- `refresh_keys_r252.py` / `run_gate_native.py` —— gitcache 刷新 + Python 侧真跑
- `../r252_page/_r252_verify.js` —— 页面行为真调（require hook 桩 `api/ui/paywall`，记录 `api.call` 入参）

## 3 两个冒烟实测抓到的 BUG（非推测）

| BUG | 现象 | 修法 | 回归断言 |
|---|---|---|---|
| **A** | `lastIndexOf('_')` 取平台 ⇒ `BILL_..._jd_order_2026-10-08` 解析成 `platform='order'` | 改**按已知平台枚举做前缀匹配**（`pickPlatform`，最长优先） | `2-③/2-④` |
| **B** | `matchTargets` 的 `want` 用 `t.kind + '\|' + …`，`kind` 缺省为 `''` ⇒ 构出 `\|taobao\|…`，与实行 `bill\|taobao\|…` 永不相等 ⇒「不限形态」清除**命中 0 行** | kind 缺省**展开成两种形态** `['bill','dish']` | `4-①` |

## 4 🔴 部署未闭环（阻塞 · 如实记录）

两个新云函数**尚未上云**。

- 第 1 次 `cli cloud functions deploy --names getSalesBills -r` ⇒ 242.5s timeout，日志停在 `- initialize`
- 第 2 次 ⇒ 37.2s，同样无 success 行
- 第 3 次 ⇒ 280s，同样 FAIL（0/1 OK）
- 探针：`wechatdevtools.exe` 进程 **0**；IDE 服务端口 9420~9425 **全 closed**
- 三条启动路全试：Win+R 键鼠（非沙箱）❌ / `Popen(微信开发者工具.exe)` ❌ / `explorer.exe` ❌
- ⇒ 与技能 `miniprogram-cloud-deploy` §3.3/§3.4 记载一致：**IDE GUI 必须在跑，cli 自起的裸 server 完成不了首次函数创建**

**待办**：请李老师在正常桌面打开微信开发者工具（打开本项目即起 server），
之后喊一声，我跑 `review/evidence/_deploy_fns.py getSalesBills clearSalesBills` 完成上云 + 出真机预览码。
