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

## 4 ✅ 部署已闭环（IDE GUI 起来后一次成功）

### 4.1 修通过程

先前三次部署全 FAIL（242.5s timeout / 37.2s / 280s），根因 = **IDE GUI 没跑**（端口全闭）。
按键鼠控制技能 §9.2 启动 IDE ⇒ **Win+R 第一次不出窗、重做一次即成**（该技能明写此现象）。

成功后日志形态（判据齐全）：

```
√ IDE server has started, listening on http://127.0.0.1:10896
√ [getSalesBills] cloudfunction getSalesBills doesn't exist in the cloud, will create it
√ [getSalesBills] upload cloud function getSalesBills - deploy
√ deploy cloudfunctions
```

⚠️ **首次 create 会撞 `FailedOperation.UpdateFunctionCode: 当前函数处于Creating状态`**
（不是失败，是云端在创建）⇒ **等 45~50s 重试即成功**（两函数均如此，第二次即 `success=true`）。

### 4.2 部署结果（判据：`success=true` + `filesCount`）

| 函数 | success | filesCount | packSize | 用时 |
|---|---|---|---|---|
| `getSalesBills` | **true** | 21 | 48.6 KB | 19.6s |
| `clearSalesBills` | **true** | 21 | 49.2 KB | ~10s |

### 4.3 timeout 抬升（键鼠代操控制台，配方 19）

新部署函数 timeout 平台默认 = **3**（真机必超时）⇒ 用键鼠代操云开发控制台改成 **20**。
坐标**逐项复现**配方（`∞` 1402≈1408 · 侧栏云函数 166 · 版本与配置 1639 · 配置 1612 ·
高级配置 607 · 超时框 **791**≈792 · 绿底确定**像素法 1322**≈1321，误差 1px）。
数字框**可直接编辑**（点 → Ctrl+A → 粘贴 `20`），**剪贴板回读**校验 `3` → `20`。

### 4.4 ✅ 权威判据（`cli … info` 回读）

```
│ getSalesBills   │ 'Active' │ 20 │ 'Nodejs16.13' │
│ clearSalesBills │ 'Active' │ 20 │ 'Nodejs16.13' │
```

**第三方独立确认**：控制台云函数列表 = 两函数 **已部署**
（`getSalesBills` 创建 19:56:07 / 更新 19:57:14；`clearSalesBills` 创建 19:57:44 / 更新 20:06:28）。

归档：`fn_info_after_deploy.txt`（info 回读）· `fn_list_cloud.txt`（list 清单）· `qr_meta_R252.json`

### 4.5 真机预览码

`qr_R252.jpg` —— md5 `f240ecb433d4439dbef7abfee881c4db` · 出码 20:07:01 · 失效≈ 20:32:01
验码通过（`_qr_verify` 解出 URL + 实印 317/250/199px 三档全过，含 37% 余量）。
