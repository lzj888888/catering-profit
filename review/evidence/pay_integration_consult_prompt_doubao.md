小程序接微信虚拟支付方案会诊（只给方案判断，不写代码，每问≤6行）。
背景：个体户+工具类目，云开发，4档一次性道具(25.9月/69季/年199/单次诊断19.9)，不建订阅。全免费期(FREE_ACCESS)，未接真实支付。规则已核完别重核：道具直购wx.requestVirtualPayment、signData服务端生成、outTradeNo一次性(8-32字符不能_开头)、发货只认xpay_goods_deliver_notify且回调最多重试15次要幂等、iOS不能主动退只能3秒应答Apple问询、Android可主动退(refund_order限JSAPI现网单)。
现状：payCallback是普通支付v3报文(Wechatpay-Signature/total_fee/attach)，按transaction_id查重后insert新流水、复用微信单号作order_no，而订单表order_no有唯一索引⇒接支付第一笔就撞；attach没写也没校验金额⇒季年卡按30天发；单次诊断grants=diag_credit分流未实现会清零已付费月卡；updateExpire先读后写并发买两次只加一次；无transaction_id索引、无主动查单；iOS一刀切禁买已过时。
Q1 链路选型：新建xpayNotify并存 / 原地改payCallback / 冻结旧的全新写，选哪个？否掉另外两个的理由？旧payCallback/payRenew/payQueryEntitlement怎么处置？
Q2 分期：按不依赖商户号现在能做vs必须等资质才能做切两期，列事项与顺序，点名3件P0硬门槛。
Q3 MVP：卖出第一单并正确发货最少要哪些组件，按依赖顺序列，标出缺了就炸的。
Q4 幂等并发：针对15次重试+乱序+并发两笔，给发货/收权的幂等键、订单状态机、防买两次只加一次的具体字段做法。
Q5 iOS：无沙箱真扣款回款45-60天，第一版同步做吗？3秒退款问询首发必须还是可后置？
Q6 最大风险：最可能翻车的一件事，触发条件+后果+现在就能做的预防。
每问标Q1~Q6，直接给结论和理由。