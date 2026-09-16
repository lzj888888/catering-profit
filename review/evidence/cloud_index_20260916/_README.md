# 云端索引实况证据（2026-09-16 · WorkBuddy 桌面自动化取得）

## 怎么来的
由 WorkBuddy 用「键鼠 + 窗口截图 + Windows OCR」驱动微信开发者工具，逐屏取证：
工具 → 云开发控制台（∞ 图标）→ 数据库 → 集合管理 → 搜索框筛集合名 → 索引管理。
窗口标题 `云开发控制台 v2.0.3 (2.0.34@707916636)`，环境选择器显示 `cloud1`（免费开发环境）。

## 本次动作（round17 §2 裁决的「10 秒复核」）
- **复核结果：`shop_cost_card` 上从未建过 `idx_card_code`** ⇒ **无需 drop**，直接按 A′ 新定义建。
- **已新建**：`idx_card_code_version` ｜ **唯一** ｜ `shop_id` 升序 / `card_code` 升序 / `version` 升序（8.00 KB）。
  - 建成前：`shop_cost_card_索引管理_建成前.png`（只有 `_openid_1` 非唯一 + `_id_`）
  - 建成后：`shop_cost_card_索引管理_建成后.png`（新索引在首行，属性「唯一」）
- 侧面印证 A7：**SDK 代码确实建不了索引** —— 本地 `initDb/collections.js` 定义了 39 条索引，云端一条都没有。

## 顺带全量核查（round17 §2 第 4 条建议：把 10 条 unique 清单整体过一遍）
预期含 unique 索引的 9 张集合，**全部只有 MongoDB 默认两条**（`_openid_1` 非唯一 8 KB、`_id_` 4 KB），
**没有任何 `idx_*` 自定义索引**：

| 集合 | 云端实际索引 |
|---|---|
| shop_cost_card | ✅ `idx_card_code_version`（唯一，本次新建） + `_openid_1` + `_id_` |
| user | 仅 `_openid_1` / `_id_`（预期 `idx_openid`、`idx_user_id` 均缺） |
| shop_entitlement | 仅默认（预期 `idx_ent_user` 缺） |
| shop_payment_flow | 仅默认（预期 `idx_pay_order` 缺） |
| order_refund | 仅默认（预期 `idx_refund_order` 缺） |
| shop_monthly_account | 仅默认（预期 `idx_acc_shop_month` 缺） |
| shop_inventory | 仅默认（预期 `idx_inv_shop_month` 缺） |
| shop_switch | 仅默认（预期 `idx_switch_shop_key` 缺） |
| admin_user | 仅默认（预期 `idx_admin_username` 缺） |

⇒ **线上自定义索引数 = 1 / 39**（unique 1 / 10）。与 `工序 5.5`「dev 可跳过、上线前必须补」一致，
**不阻塞批次 4**（少索引 = 约束更松，不会写失败；缺的是唯一性保护），但**上线前必须补齐**。

## 口径与局限
- 逐集合截图 + OCR 读数，另抽 `user` / `shop_switch` 两张**人眼复核**确认「集合名 + 索引管理 tab + 表体」三者一致；
  OCR 会把 `_openid_1` 认成 `_ogEnid`、`idx_card_code_version` 认成 `idxcardversion`（截断/形近），**以截图为准**。
- 只查了「索引管理」页；未查数据权限 / 数据库设置 / 其他集合（非本轮范围）。
