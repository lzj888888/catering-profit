# 三司会诊题面：店算小程序「接支付」方案定稿

## 背景（真实现状，别假设）

- 产品：「店算·盈利分析」微信小程序，主体=个体工商户（已认证），服务类目=工具，备案已提交待管局审核。云开发架构，dev 环境 cloud1-4dgphoxy337f2a25，prod 未建。
- 商业模式：免费 Excel 盈亏平衡表引流 → 小程序内付费解锁深度功能。定价 4 档：真实利润月 25.9 / 季 69 / 年 199 / 深度诊断单次 19.9，全部 one_time，**不建自动续费订阅**。
- 团队：4 人。决策=老板；我=门禁/套件/判读；inscode=写 cloudfunctions/ 与 miniprogram/ 源码（不碰 specs）；dsh=只读复审+变异。总线=Git 仓库+文件，不靠聊天转述。
- 纪律：先审后合、fail-closed、不采信 AI 自述、数字可复现；已有 166 套 gate/verify_all 守卫，其中 7 套守支付结构（check_paywall_coverage / check_entitlement_flow / check_diag_entitlement / check_ios_pay / check_pay_orders_stub / check_hub_paytag / check_paywall_tracking）。

## 规则（已用官方文档+元宝/豆包/DeepSeek/桌面豆包核完，本次不要重核，直接采信）

1. 走微信虚拟支付：个体户可开，需已认证+主体信息完备+小程序备案；工具类目覆盖所售虚拟商品（本次不再质疑规则，只处理落地）。
2. 下单是道具直购 `wx.requestVirtualPayment`（mode=short_series_goods），signData/paySig/signature 必须服务端生成；后台先建 4 个道具，goodsPrice 与后台一致否则 -15013；outTradeNo 8–32 字符、不能 `_` 开头、每单一次性、重试换新号否则 -15002。
3. 发货唯一可信依据 = 服务端 `xpay_goods_deliver_notify`；前端 success 只代表调起；回调失败最多重试 15 次 ⇒ 发货/收权必须幂等。
4. 退款：Android 可主动退（refund_order，限 JSAPI 现网单）；iOS 开发者不能主动退，只能 3 秒内应答 Apple 问询（result_code 0 建议退/1 拒绝，连续 3 次不应答交 Apple 判），收到 xpay_refund_notify 后收权。
5. 费率限时：Android 当前 1%/标准 10%/T+3；iOS 当前 12%/标准 17%/45–60 天。iOS 需小程序简称+开通 IAP+用户 iOS15&微信8.0.68+单笔≥1元+大陆 App Store；Apple 支付无沙箱，只能现网真机真扣款。
6. 10 万/月限额只属个人主体，个体户档未列但不等于无风控。

## 代码现状（本次会诊的核心约束，全部带文件:行）

- `utils/featureFlags.js:71` FREE_ACCESS_MODE = !PAYWALL_ENABLED，当前全免费；`cloudfunctions/common/payFlags.js::FREE_ACCESS` 必须同源等值。
- `utils/paywall.js:64,98-111,179` iOS 一律 `showIOSBlocked()`（一刀切禁买，已过时）；iOS 满足四条件时应走 IAP。
- `cloudfunctions/payCreateOrder/service.js:11` `ENABLE_REAL_PAYMENT=false`；`:35` 返回 pay_params=null；`:16-18` genOrderNo 生成 `PO`+时间戳 base36+随机（当前是业务单号，不是虚拟支付 outTradeNo）。
- `cloudfunctions/payCallback/*` 是**普通微信支付 v3 报文**（Wechatpay-Signature / total_fee / attach），按 transaction_id 查重后 **insert 新流水**、复用微信 out_trade_no 作 order_no，而 `initDb/collections.js:70` 的 `idx_pay_order` 是 `unique{order_no}` ⇒ 撞唯一索引、原 pending 单不回写。
- 回调 `attach` 取 plan_id，但下单根本没写 attach、金额也不比对 ⇒ 季/年卡按 30 天发。
- `plan_diag_single` 的 `grants:diag_credit` 分流未实现（initDb 注释已预警），days:0 会把 expire_at 写成 now，可清零已付费月卡。
- `shop_entitlement.expire_at` 的 `updateExpire` 先读后写 ⇒ 并发支付丢一次加时（买两次只加一次，无报错）。
- 权益集 `shop_payment_flow` 无 transaction_id 索引/唯一约束；无主动查单/对账（全仓 queryOrder 零命中）。
- `terms.js:3962` 全端同一句「7 天全额退」，iOS 无法主动退 ⇒ 必须分端。
- _profile/支付包：现有 10 个 pay* / admin* 云函数；无套餐列表接口（paywall.js 只渲染单按钮固定月卡）；getPlan 是 M2 沙盘方案不是套餐。

## 任务：给出「接支付」定稿方案（不是重核规则）

请回答以下 6 问，**每问 ≤8 行、直接给结论与理由，不要复述背景**：

Q1 **链路选型**：现有 payCallback 是普通支付 v3 协议、虚拟支付是 xpay_* 事件族。是「新建 xpayNotify 与旧链路并存」还是「原地改造 payCallback」还是「冻结旧函数、全新建」？给出你选的那个和另外两个被否的理由。旧 payCallback / payRenew / payQueryEntitlement 如何处置（保留/改/删）？

Q2 **分期与动手顺序**：按「不依赖商户号现在能做」vs「必须等备案/商户号/道具/类目确认才能做」切两期，各列具体事项与顺序。哪三件是 P0 硬门槛（不做就一开真实支付就炸）？

Q3 **最小可上线闭环（MVP）**：要卖出第一单并正确发货，最少需要哪些组件/函数/前端动作？按依赖顺序列，标出哪些是"缺了就收不到钱或发了错权益"。

Q4 **幂等与并发**：针对「15 次重试 + 可能乱序 + 并发两笔支付」，给出发货/收权的幂等键设计、订单状态机、以及防「买两次只加一次」的具体做法（写清用哪个字段做 CAS/乐观锁）。

Q5 **iOS 排期**：iOS 无沙箱、只能现网真机真扣款、回款 45–60 天、需小程序简称+IAP。第一版是否同步做 iOS？若做，3 秒退款问询函数是必须首发还是可以后置？给出理由。

Q6 **最大风险**：这份方案如果只按上述做，最可能翻车的一件事是什么？给出触发条件、后果、以及现在就能做的预防动作。

每问独立成段，标 Q1~Q6。不要写代码实现，只要方案判断。
