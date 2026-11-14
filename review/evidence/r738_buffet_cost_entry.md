# R738 · 自助线食材消耗：把「死指路」补成闭环

> 李老师 2026-11-15：「继续完善需要完善的。」
> 承接 R737 遗留待办第一条：`m3_buffet_food_cost_total` 后端读写都有、前端全仓无写入入口。

## 一、问题（一句话）

菜品复核页写着「**待填写（在「设置」页填本月自助食材消耗）**」，
而店铺设置页（`subpkg/tools/shop/setting`）**从来没有这个输入框** —— 提示把老板指向一块空地。

这类缺陷的共同特征：**不报错、不崩、门禁全绿**。
因为没有任何断言要求「提示里指的那条路必须真的存在」。

## 二、定位（全仓扫描，不是猜）

| 环节 | 状态 | 证据 |
|---|---|---|
| 写侧 | ✅ 存在 | `saveShopSetting/index.js:135` 收 `buffet_food_cost_total`（非负整数·分；`null`=删行） |
| 读侧 | ✅ 存在 | `getDishReview/index.js:140` 直读 `shop_switch` |
| 算侧 | ✅ 存在 | `computeCoverage` → 人均成本 / 人均毛利率 / 实际成本率 / 行业基准带 |
| 前端入口 | ❌ **零** | `grep -rn "buffet_food_cost\|自助" subpkg/ pages/` ⇒ 只有文案，没有 `<input>` |
| 文案指路 | ❌ **指向空地** | `reviewBuffetNoCost`、`reviewBuffetHint` 两处都写「在『设置』页填写」 |

结论：这不是「功能没做」，是**最后一段 UI 没接上**，而文案已经替它承诺了。

## 三、做法

入口放到**看见「待填写」的那一行旁边**（复核页 = 自助餐块），不是放回设置页：

- 与 2026-09-20「把库存/摊销开关从设置页迁到月度录入页」同一条决策：
  **放到真正要用到的计算步骤旁边**，老板不用跳页、也不用记住在哪儿填。
- 填完立刻整页重算（人均食材成本 / 人均毛利率 / 实际成本率三处都吃这个值）。

### 三处细节（都是这轮踩出来的）

1. **单位**：老板按「元」填，库内一律「分」整数（全仓铁律）。
   换算必须是十进制安全形态 `Math.round(Number((num * 100).toFixed(10)))` ——
   朴素的 `num * 100` 会算出 `7.000000000000001` 这种非整数分（`check_money_precision` C-④ 当场拦下）。
   R272 的旧文案更狠：直接写「（单位：分）」，等于让老板自己乘 100。

2. **清空 ≠ 填 0**：输入框删空再保存 ⇒ 传 `null`（后端删行，撤销这个数）；
   填 `0` 也是合法值。两者语义不同，前端不能合并。

3. **跨月提醒（这轮最重要的发现）**：该键是 `shop_switch` 里的**店铺级单值**，不按月存。
   老板 11 月填了 24,000，12 月不更新 ⇒ 12 月的人均成本会用 11 月的消耗去除 12 月的份数，
   数字看着合理、实际是错的。⇒ 出参补 `foodCostUpdatedAt`，页面回显「已录 ¥24,000.00（2026-11-10）」，
   月份对不上再补一句「这个数是别的月份填的，请按本月实际更新」。
   ⚠️ 顺带修了一处会让提醒永不触发的缺陷：`saveShopSetting` 首次写入走 insert 分支且**没写 `updated_at`**
   ⇒ 第一次填写的那批数据永远没有时间戳 ⇒ 最该提醒的对象恰恰提醒不到。已补 `updated_at: now`。

## 四、验证（`tools/check_buffet_cost_entry.js` · 25 断言）

| 组 | 断什么 | 为什么必须真跑 |
|---|---|---|
| A 接线点 | 输入框/按钮/两个方法/幂等键都在；**文案不再指路到设置页**；后端出参带 total+时间 | 死指路的反面判据：提示不能指向不存在的地方 |
| B 行为面（真跑页面） | 回显 24000.00 / 空态 / 24000→2400000 分 / 0.07→7 分 / 负数不外发 / 清空→null / 失败不卡死按钮 | 只在真机上才会安静出错的地方 |
| C 后端 | `foodCostTotalFen`、`foodCostUpdatedAt`、人均成本口径未变、insert 带 `updated_at` | 出参口径 = 前端能不能回显的前提 |
| D 跨月 | 10 月录的 + 11 月统计 ⇒ 提醒；同月 ⇒ 不提醒（对照，防恒真） | 单值 vs 按月的语义差 |
| E 变异回灌 | 去掉元→分换算 ⇒ B-③ 转红；跨月比较改恒 false ⇒ D-① 转红 | 证明断言不是恒真 |
| F 自失效 | 断言数 ≥18、t 映射在位 | 防守卫被掏空 |

```
===== 自助线食材消耗录入守卫结果：25 通过 / 0 失败 =====
```

## 五、边界（诚实登记）

1. **仍是店铺级单值**，不按月存。真正的修法是按月存（`shop_switch` 加月份维度或新集合），
   本轮用「录入时间 + 跨月提醒」把风险显性化，**没有**改成按月——那要动数据模型，得先拍板。
2. 自助餐块在「更多分析」折叠区里（R281 O2 的取舍）：老板不展开就看不到「待填写」。
   本轮**没有**去动折叠结构（那是既定产品决策，不属于本轮缺口）。
3. 只有 `category='buffet'` 的销量行才进这个口径；快餐/自助的判定仍由导入时打标决定。

## 六、改动文件

- `cloudfunctions/getDishReview/service.js`：`computeCoverage` 第 4 参 `opts`，buffet 出参加 `foodCostTotalFen` / `foodCostUpdatedAt`
- `cloudfunctions/getDishReview/index.js`：读 `bsRow.updated_at` 并透传
- `cloudfunctions/saveShopSetting/index.js`：首次 insert 补 `updated_at`
- `pages/m3/dishreview/index.js`：`onBuffetCostInput` / `onSaveBuffetCost` + 回显 / 跨月判定
- `pages/m3/dishreview/index.wxml` / `.wxss`：就地输入行（G1 字号 ≥28rpx、G2 触控 ≥88rpx、G3 `adjust-position`+`cursor-spacing`）
- `miniprogram/i18n/terms.js`（+ `specs/dev-specs/i18n/terms.js` 双副本同步）：删死指路文案，补 7 个键
- `tools/check_money_precision.js`：登记一处元→分（`IDENT|num * 100|#1`，money）
- `tools/check_buffet_cost_entry.js`：**新增**守卫（25 断言）
- `verify_all.js`：注册 `buffet-cost-entry`，套件 318 → **319**（追加在列表末尾——C3 按位置核对「第 N 套件」，中间插队会让后面 8 个套件序号错位，本轮实测踩到）
- 门禁 319/319
