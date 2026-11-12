# R724i · 跨店与月份隔离实测（真云，不是桩）

> 2026-11-13 凌晨 · 李老师说「你自己造数据，自己去抓取，去测试」。
> 方式：模拟器自动化 + 真 dev 云数据库。**不是桩，是真数据**。
> 证据：`review/evidence/r724i_cross_shop/`

---

## 0. 结论三句话

1. **跨店隔离成立**：在 A 店造的原料和摊销资产，切到 B 店读出来是 **0 条、0 元**。
2. **月份摊销口径成立**：9 月起摊 3 个月的资产，8 月 0 元、9/10/11 各 2000 元（两笔）、12 月 0 元。
3. **草稿跨店隔离成立**：写盘带 `shop_id`，恢复时比对不匹配就丢弃；storage 里那份旧草稿没有 `shop_id` 字段，所以永远读不出来。

R718 / R719 之前只有桩层结论，**这次是真云实测**。

---

## 1. 怎么造的（不用造店，dev 已有 5 家）

`getShopList` 返回 5 家：Abc / 999 / 888 / 顺水鱼馆 / 李家小面（`is_paid: true`，不受免费 1 店限制）。

选两家做对照：
- **A** = 李家小面 `shop_u_..._sc_1794313024786`
- **B** = 顺水鱼馆 `shop_u_..._sc_1793886738334`

在 A 店用真实云函数造数：

```js
saveMaterial({ shop_id: A, material: { name: 'A店专属锅底', purchase_unit:'斤',
  purchase_price_fen: 1200, convert_factor: 500, yield_rate: 95, category: 'season' } })
saveAsset({ shop_id: A, asset: { name: 'A店装修费', value_fen: 300000,
  start_month: '2026-09', total_months: 3, mode: 'amort', asset_kind: 'renovation' } })
```

**踩到的坑**：直接调 `wx.cloud.callFunction` **绕过了 `api.js` 的 shop_id 自动注入**，第一次返回 `INVALID_PARAM`（`saveMaterial` 要求 `event.shop_id` 非空）。补上 `shop_id` 才成功。读取侧 `getMaterial` / `getAmortSchedule` 同理。

---

## 2. 实测数据

### 跨店隔离

| 读哪家店 | 原料 | 摊销资产 | 当月合计 |
|---|---|---|---|
| A（李家小面） | `['A店专属锅底']` | `['A店装修费']` | 2000.00 元 |
| **B（顺水鱼馆）** | **`[]`** | **`[]`** | **0.00 元** |

✅ B 店完全看不到 A 店的东西。

### 月份摊销（A 店的资产：2026-09 起，摊 3 个月）

| 月份 | 合计 | 资产条数 |
|---|---|---|
| 2026-08 | 0.00 | 2（在列表里，但当月不摊） |
| 2026-09 | 2000.00 | 2 |
| 2026-10 | 2000.00 | 2 |
| 2026-11 | 2000.00 | 2 |
| 2026-12 | 0.00 | 2 |

✅ 起摊月前为 0、摊期内每月等额、摊完后归 0。**摊销口径正确**。

（合计是 2000 而不是 1000，因为我跑了两轮造数，写进了两笔同名资产。已清理。）

### 草稿隔离

`sandbox_draft_v1` 是**裸 key**（不带店维度），看起来像漏洞。读源码确认它是安全的：

```js
// 写盘
wx.setStorageSync(DRAFT_KEY, { v: 1, shop_id: ss.currentShopId(), ... });
// 恢复
if (!d || d.v !== 1 || d.shop_id !== ss.currentShopId()) return false;
```

✅ 隔离靠**草稿对象内部的 `shop_id` 字段**，不是 key。

storage 里现存那份草稿 `{"v":1,"cityIdx":1,...}` **没有 `shop_id` 字段**——是 R443 之前的旧版写的，因此 `undefined !== 当前店` ⇒ 永远不恢复。**旧草稿被安全丢弃**，不会污染。

---

## 3. 一个无害但要记的残留

storage 里还有三个**历史遗留 key**：

| key | 值 | 来源 |
|---|---|---|
| `m3_dish_cats` | `[]` | R720 之前的裸写法（现在 4 处读写全部走 `ss.shopKey()`） |
| `sandbox_draft_v1` | 旧格式（无 `shop_id`） | R443 之前的写法 |
| `takeout_mode_shop_mu6j87v1itrs_2026-09` | `"fast"` | 旧格式 shop_id（现在的店 id 是 `shop_u_..._sc_...`） |

**全部无害**：现在的代码读不到它们（key 拼法变了 / 缺字段被丢弃）。
但会一直占着空间，而且**万一将来有人图省事直接 `wx.getStorageSync('m3_dish_cats')` 不走 `shopKey`，就会读到两年前的脏值**。

建议：登出时顺带清掉（`clearExportedFiles` 已经在登出流程里了，可并列加一步）。已记台账 P2。

---

## 4. 测试数据已清理（如实）

在 A 店造的 2 条「A店专属锅底」+ 2 笔「A店装修费」**已全部软删**：

```
before: materials=['A店专属锅底','A店专属锅底'] assets=['A店装修费','A店装修费']
after : materials=[]                              assets=[]   total=0
```

没有留下任何测试数据。B 店全程没写过。

---

## 5. 边界（如实）

- 这是**模拟器 + 真云**，不是真机。真机上的渲染/触控/键盘仍未验。
- 「跨店串数据」这次验的是**云端**（`getMaterial` / `getAmortSchedule` 按 `shop_id` 返回）。**前端页面切换店铺后重新加载**的那条链路（`onShow` → `load`）没有逐页验，理论上由 R720 的 `shopKey` 修法 + `api.ensureShop` 覆盖。
- 月份隔离验的是**摊销**一条链路（`getAmortSchedule`）。月度账本（`getLedger`）的月份隔离没有单独造数验。
