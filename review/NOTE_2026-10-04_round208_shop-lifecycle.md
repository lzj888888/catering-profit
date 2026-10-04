# R208 · 店铺生命周期三件事（删除释放额度 / 删空不死锁 / 入口不藏）

- 日期：2026-10-04
- 起因：李老师反馈「店铺现在**只能改名**，删除要新建才可以，新建店铺又提示**已达免费上限**去开通。这个符合咱们的设计意图吗？」
- 结论：**不符合**。查下来是三个真缺陷（其中一条放开后会**锁死整个账号**），已全部修掉。

---

## 一、诊断：三个实锤

### ① 删除跑不通 —— 免费档被永久锁死（配额语义错）

`cloudfunctions/manageShop/service.js::decideDelete` 原判据：

```js
return { …, allowed: active >= 2 };   // 删完还必须剩 ≥1 家
```

注释给的理由是「否则用户把自己锁死（没店可进、也没店可建）」—— **这条理由不成立**：

- 软删店铺既不进列表也不占配额（`utils/shopSwitcher.js` 头注明写「软删店铺不进入列表、不占配额」；
  `getShopList` 的 `used = 活跃列表长度`）；
- 删光后 `used` 由 1 回落 0，**免费额度刚好够再建 1 家** —— 根本不存在"没店可建"。

真正把用户锁死的反而是这条禁止本身，且造成**档位错阶**：

> 想换店 ⇒ 得先有第 2 家 ⇒ 第 2 家已被付费墙拦 ⇒ **免费用户除了改店名什么都做不了**。

同时它与自身文案自相矛盾：`TERMS.exp.deleteConfirm` 白纸黑字承诺「删除后…**不再占用店铺额度**」，
而这个承诺对免费档**永远兑现不了**。

⇒ 放开为 `active >= 1`；`activeCount=0` 仍 fail-closed（防幽灵删除）。

### ② 🔴🔴 只放开 ① 会炸全流程（删空后账号报废）

`getShopContext` 原本**无条件** autoProvision：

```js
const id = defaultShopId(userId);        // 🔴 确定性 _id
await da.insert('shop', { _id: id, …, created_at: nowUtc() });
```

`defaultShopId(userId)` 是**确定性** `_id`，而软删**不物理删文档**（只是 `is_deleted=true`，仍在库）。
于是删空所有店铺后：

```
进任意页面 → ensureShop → getShopContext
  → da.list 带 is_deleted:false ⇒ 查不到
  → insert 同 _id ⇒ 撞键（软删文档占着这个主键）
  → catch: isDuplicateKeyError ⇒ created = false
  → 回读 again ⇒ 仍为空（文档是软删态）
  → return fail('店铺初始化失败（并发冲突后回读为空）')
  ⇒ 该用户此后**每一个页面都报错**。
```

⇒ 必须先区分「从未建店的新用户」与「主动删空的老用户」：

```js
const everRes = await da.listIncludingDeleted('shop', { user_id: userId });
const everHad = (everRes && everRes.data && everRes.data.length > 0);
if (!shop && everHad) return ok({ shop_id:'', …, no_shop:true });   // 早退，不重建
```

只有 `!everHad`（真的新用户）才走原来的 A6b 兜底建店。
出参加 `no_shop`（正常路径恒 `false`，契约键不缺）。

### ③ 入口藏得太深 —— 李老师本人都没找到

改名/删除收在每行行尾「⋯」的 `showActionSheet` 里。低频 ≠ 可藏（R192 红线：藏起来的功能等于没有）。
实测后果：**产品主人都没找到删除**，还以为「店铺只能改名」。

⇒ 摊成行内两个显式按钮：`改名`（次要）/ `删除`（危险色）。

---

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `cloudfunctions/manageShop/service.js` | `decideDelete`：`active>=2` → **`active>=1`**；头注写清旧判据错在哪 |
| `cloudfunctions/manageShop/index.js` | 同步注释；异常态错误码改 `RESOURCE_NOT_FOUND`（已有 i18n 映射） |
| `cloudfunctions/manageShop/selftest.js` | 删边界断言同步（旧断言把错误行为锁死了） |
| `cloudfunctions/getShopContext/index.js` | 加 `everHad` 判定 + `no_shop` 早退分支；正常路径补 `no_shop:false` |
| `cloudfunctions/getShopContext/selftest.js` | 🔴 修判据形态假设（详见 §四） |
| `pages/shop/switch.js` | 去掉 `length<2` 拦截改分级告知；删空后**复位 shop_id** + 自动展开新建 |
| `pages/shop/switch.wxml` | 「⋯」 → 行内「改名」「删除」两个按钮（`catchtap` 阻断冒泡） |
| `pages/shop/switch.wxss` | `.row-ops .ops-btn`（96rpx 宽 / min-height 88rpx / font-size 28rpx） |
| `miniprogram/i18n/terms.js`（+ specs 副本） | 改 `deleteLastHint`、加 `renameShort/deleteShort/noShopHint/shopManageHint`；删掉「至少要保留一家」 |
| `tools/check_shop_lifecycle.js` | **新增第 133 个套件**，29 断言 |
| `verify_all.js` / 重启键 / `check_suite_assert_counts.js` | 六处同步（132 → 133） |

---

## 三、守卫设计（29 条）

- **S 护栏 4**：7 份目标文件在位 + 剥注释后达下界 + 两个"确实扫对了文件"的锚点（路径没写错）
- **A 配额语义 5**：**实跑 `decideDelete` 判行为不判字面**（1 家允许删 / 2 家 / 0 家 fail-closed / remaining 自洽）
- **B 删空不死锁 6**：必须先用 `listIncludingDeleted` 探测；`everHad` 早退顺序必须在 autoProvision 之前；
  正常路径也要带 `no_shop:false`；旧头注已改
- **C 入口不藏 10**：不许再出现 ⋯/actionSheet/onMore；两个按钮 + `catchtap`；不许有数量拦截；
  删空要引导新建 + **复位 shop_id**；保留二次确认；`.ops-btn` 规则块内守 88rpx / 28rpx
- **D 文案对齐 4**：不再有「至少要保留一家」过期承诺；额度承诺仍在；删最后一家有专门后果文案；有空态引导

## 四、三条新坑（本轮最值钱）

1. **同一份文件里的同名值会让判据变成恒真。**
   C-⑧/C-⑨ 首版全文件搜 `min-height: 88rpx` ⇒ M5 变异（把 `.ops-btn` 降到 64rpx）**守卫一声不响**。
   因为 `.shop-main .shop-name`、`.edit-inp`、`.more-hint` 都写着同样的 88rpx / 28rpx。
   ⇒ **尺寸类判据必须收进目标规则块**（`.row-ops .ops-btn { … }`），不能全文 `.test()`。

2. **判据里隐含的"文件形态假设"会被新改动打破。**
   `getShopContext/selftest.js` 原判 `body.slice(body.indexOf('return ok'))` —— 假设全文**只有末尾一个**
   `return ok`。加了 `no_shop` 早退后变成两个 ⇒ 切片把后面整段 autoProvision 划进"出参区" ⇒ 假红。
   ⇒ 改成**逐个出参块**判（`return ok(` 到其后第一个 `});`），并补一条"出参区切片非空"的前提断言防零命中假绿。

3. **UI 结构的注释会被当实现形态。**（R207 已踩一次，本轮又两例）
   C-① 首版判 `!/⋯/` ⇒ 红，因为 **wxml 自己的注释里提到了「⋯」这个词**（写着"为何换掉它"）；
   D-① 同理，**terms.js 注释里引用了那句旧文案**。
   ⇒ 判 UI / 文案必须先**剥注释**。另 **C-②/③**：要点判的是"绑定存在"，而不是"绑的是 bindtap 还是 catchtap"
   ——实际写的是 `catchtap`（要阻断冒泡），按 `bindtap` 判就永远绿不了（还好方向反之，不然就漏判了）。

## 五、验证

- 门禁：**133/133 通过、RC=0、miss=0**（107.0s，沙箱通道需挂 `gitcache_preload.js`）
- 变异回灌 **6/6 全部点名目标断言**：

| 变异 | 目标断言 |
|---|---|
| M1 `decideDelete` 改回 `active>=2` | A-② |
| M2 早退条件改 `if (false)`（provision 裸跑） | B-④ |
| M3 入口改回「⋯」 | C-① / C-② / C-③ / C-③b |
| M4 删掉 `switchShop(… : '')` 复位分支 | C-⑥ |
| M5 `.ops-btn` 降到 64rpx（**首跑未红 ⇒ 修判据后红**） | C-⑧ |
| M6 文案塞回「至少要保留一家」 | D-① / D-③ |

- 变异前/后 6 个文件 md5 **逐字节一致**（含 terms 双副本 md5 一致）

---

## 六、待办 / 遗留

- **必须部署** `getShopContext` + `manageShop` 两个云函数（本次有后端改动，前端单独出码不生效）
- 李老师验真机：① 店铺列表右侧「删除」能删掉唯一那家 ② 删完就地弹出新建输入 ③ 建好后首页正常
- 遗留（前轮）：清理 `initDb` 的 `diag_shop` 诊断分支；`shop` 的 `id` 索引随批量补索引时加

---

## 回执

- [2026-10-04 11:35] R208 已落 · 证据：`node tools/check_shop_lifecycle.js` → 29 通过/0 失败 RC=0；
  `run_gate3.py` → 总览 133/133 通过 耗时 107.0s RC=0，miss=0 · commit 待填
