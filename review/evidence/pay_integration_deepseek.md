**Q1 链路选型**
选「冻结旧函数、全新建」。理由：xpay_* 事件族与微信支付 v3 报文在验签、字段、幂等语义上完全不同，原地改造 payCallback 等于把两套协议塞进一个函数，166 套 gate 里 7 套支付守卫的断言会全部失效，且旧函数已带「insert 新流水撞 idx_pay_order」的硬伤，改造面大于重写面。并存方案被否：两套回调同时在线，任何一笔订单都可能被旧链路误判为已支付，fail-closed 纪律下不允许双写入口。处置：payCallback 冻结（保留代码、路由摘除、加 `DEPRECATED` 注释与 gate 断言其不被调用）；payRenew 删除（one_time 无续费语义）；payQueryEntitlement 保留但改为只读权益查询，不参与发货。

**Q2 分期与动手顺序**
一期（不依赖商户号）：① 新建 xpayNotify 骨架 + 幂等表结构（含 transaction_id 唯一索引）；② 订单状态机与 CAS 字段落库；③ plan_diag_single 的 grants 分流实现；④ updateExpire 改原子写；⑤ terms.js 分端退款文案；⑥ 7 套支付 gate 按新链路重写断言。二期（等备案/商户号/道具）：① 后台建 4 个道具并核对 goodsPrice；② payCreateOrder 切 ENABLE_REAL_PAYMENT 并生成合规 outTradeNo；③ 服务端 signData/paySig/signature；④ 前端 paywall 渲染 4 档；⑤ 真机联调。P0 三件硬门槛：xpayNotify 幂等键（transaction_id 唯一）落地、订单状态机 CAS 落地、plan_diag_single 分流落地——任一不做，一开真实支付就重复发货或清零已付费权益。

**Q3 最小可上线闭环**
依赖顺序：① 后台 4 道具（缺则 -15013，收不到钱）；② payCreateOrder 生成 outTradeNo + 服务端签名（缺则调不起支付）；③ 前端 `wx.requestVirtualPayment` 调起（缺则无单）；④ xpayNotify 验签 + 幂等发货（缺则收钱不发货）；⑤ 权益写入 + expire_at 原子加时（缺则发了错权益）；⑥ 前端支付后查权益刷新（缺则用户看不到已解锁）。其中 ②④⑤ 是「缺了就收不到钱或发了错权益」，①③⑥ 缺了是体验问题不是资损。旧 payCallback 不在此闭环内。

**Q4 幂等与并发**
幂等键：`transaction_id` 建唯一索引，发货前 `INSERT ... ON CONFLICT DO NOTHING`，插入成功才执行发货，重复回调直接短路返回成功。订单状态机：`pending → paid → delivered`，只允许单向推进，回调只处理 `pending` 态。防「买两次只加一次」：`shop_entitlement` 加 `version` 字段做乐观锁，`UPDATE ... SET expire_at = expire_at + interval, version = version + 1 WHERE id = ? AND version = ?`，影响行数为 0 则重读重试（上限 3 次）。乱序处理：以 `transaction_id` 去重后按 `create_time` 排序落库，晚到的旧单不覆盖新 expire_at，用 `GREATEST(expire_at, new_expire_at)` 兜底。

**Q5 iOS 排期**
第一版不同步做 iOS。理由：iOS 无沙箱只能现网真扣款，4 人团队在 Android 链路未跑通前并行 iOS，等于把唯一能验证的现网环境当测试环境用，回款 45–60 天意味着任何退款纠纷的现金流压力延后暴露。3 秒退款问询函数必须首发——不是「可以后置」，是「不做就别开 iOS」：连续 3 次不应答交 Apple 判，等于把退款裁决权拱手让人，且 xpay_refund_notify 收权逻辑与 Android 共用，后置会导致收权路径分叉。iOS 排期放在 Android 首单验证通过 + 退款问询函数与 Android 共用收权逻辑联调通过之后。

**Q6 最大风险**
最可能翻车：xpayNotify 验签通过但 `attach`/金额比对缺失，导致季/年卡按 30 天发（现状已存在此 bug，新链路若照搬会继承）。触发条件：下单未写 attach 或回调未比对 goodsPrice 与 plan 映射。后果：用户付 199 年卡只得 30 天，客诉 + 退款 + 平台风控。现在就能做：payCreateOrder 落库时强制写 `plan_id` 与 `amount`，xpayNotify 发货前断言 `amount === plan.price` 且 `plan_id` 在白名单内，不匹配则拒发并告警；同时把该断言写进 check_entitlement_flow gate，作为 fail-closed 硬门槛。