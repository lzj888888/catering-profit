# R724d · R1-8 首页行为守卫（附：先纠正了我自己的一个错误）

> 2026-11-12 · 继续「零前置」项。
> 守卫：`tools/check_home_page_stub.js`（32 断言 / 7 段）｜ 全量：**298/298**

---

## 0. 先纠正上一轮的错误

我在 R1-8 里写的 `next_action` 是「revenue 优先」。实际核查发现 **`subpkg/biz/revenue/index.js` 早就有桩**：`check_revenue_page.js` 用 `global.Page` 真跑了 `buildView`（第 146/170/179 行）。

**是我记错了，不是它没守卫。** 本轮不用拍脑袋排序，改成机器扫：

> 34 个 `Page` 页面 × 26 个用桩的 `tools` 脚本 ⇒ **真正零桩的 8 个**：
> `pages/index/index.js`、`material/index`、`month/amortize`、`month/assetEdit`、`tools/pay/orders`、`sandbox/compare`、`sandbox/list`、`shop/setting`

按「零桩 × 流量」排，**首页第一**：每个老板每次打开小程序，第一眼就是它，错了不用点任何东西就能看见。

---

## 1. 首页最贵的四类静默错误

### ① 权益分流接错（本轮重点）

R493 的规则：免费档显示**经营参考利润**（`operation_ref_profit_fen`），付费档才显示**会计利润**（`total_factor_real_profit_fen`）。

接反了会怎样：免费档首页显示会计利润，与月首页、结果页对不上——**这正是 R484/R493 花两轮要消灭的困惑**，而且全程零报错。

用两个**数值不同**的字段（9160.00 vs 7777.00）才能真验出分流；若两值相同，接反也看不出来。

### ② 三态塌成两态

`profitKnown` 这个标志就是为「未确定 ≠ 无数据」存在的：取数回来前不能先闪一帧「还没有本月数据」。无 `account_id` 时必须走空态，**绝不能渲染 ¥0.00**（老板会读成「这个月一分没赚」）。

### ③ hero 三列把 0 渲染出来

任一项为 0 就整行不显示。渲染 `¥0` 会被读成「这店没花钱 / 没赚钱」。毛利率在营收为 0 时分母不存在，也必须留空。

### ④ tabBar 页用 `navigateTo`

`pages/m3/hub` 是 tabBar 页，`navigateTo` 到 tabBar 页微信**直接失败**（R199 踩过，表现是「点了没反应」）。

---

## 2. 断言清单（32 条）

| 组 | 条数 | 覆盖 |
|---|---|---|
| **A** 权益分流 | 6 | 付费取会计利润 / 免费取参考口径 / **标签也跟口径走** / 免费档参考口径缺失**不许拿会计利润顶** / 权益接口失败走空态 |
| **B** 三态 | 4 | 无 account_id 走空态 / 非有限数走空态 / 读账本失败**静默**（不弹 toast）/ 初值 `profitKnown=false` |
| **C** hero 三列 | 4 | 营收 0 留空 / 毛利率 0 留空 / 成本 0 留空 / 正常值走「X.X万」+ 百分比取整 |
| **D** `wanText` | 5 | 9999 / 10000 / 86000 / 0 / 非数 |
| **E** bootstrap | 5 | 成功写 shopName + `setShopContext` / 无店态触发引导 / 失败 toast + 停 loading / 缺名不渲染 undefined |
| **F** 跳转与生命周期 | 4 | M3 入口必须 `switchTab` / 四个普通入口 `navigateTo` / `onShow` 每次重拉 / 下拉刷新真停 |
| **M** 变异回灌 | 4 | 免费也取会计利润 / 拆两道账本判据 / 营收 0 也渲染 / 改 `navigateTo` |

---

## 3. 一个意外收获：页面本来是「双保险」

`M-2` 第一版只拆了一道 `account_id` 判据，**没有退化**。读源码才发现页面有两道：

1. `if (!d || !d.account_id) return;`（早退）
2. `if (d.account_id && typeof fen === 'number' && Number.isFinite(fen))`（进数据分支前再判一次）

所以「只拆一道不退化」是**正确行为**，不是守卫失灵。把变异改成**同时拆两道**后才真退化。

这件事值得记下来：**变异没让断言红，不一定是守卫没分辨力，可能是产品本身有冗余保护。** 判断前先读代码，别急着放松断言。

---

## 4. 边界（如实）

- 全在 L2 桩层。**未上真机**，不验视觉。
- `F-③ onShow 每次重拉` 这条只验到「onShow 被调用且不报错」，**没有真验「改完店名回来看到新名」**——那需要模拟两次调用之间的数据变化，属真机轮。
- 台账 R1-8 仍 **deferred**：剩 7 个零桩页，按风险排在 `next_action` 里（amortize → material/index → assetEdit → shop/setting → pay/orders → sandbox 两个）。

---

## 5. 台账与计数

- R1-8 未销账，`evidence` 换成「实扫 34 页 × 26 桩型工具，零桩 8 个」，`next_action` 写明剩余 7 个的优先顺序。
- 套件 **297 → 298**，三处声明同步。
