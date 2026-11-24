小程序卖虚拟商品(月卡25.9/季69/年199/单次诊断19.9,全one_time),主体个体户,即将接微信虚拟支付。现未接支付(FREE_ACCESS=true全免费)。请评审我列的5条接支付必炸风险,每条判真伪。

1 回调按transaction_id查重后insert新流水,order_no直接用微信out_trade_no(=已存在的号),订单表order_no有唯一索引,原pending单不回写paid。
2 回调plan_id取自微信attach,但下单没写attach也没传给网关;回调total_fee没跟订单金额比对。
3 单次诊断档days=0且grants=diag_credit,回调无grants分支,统一算expire_at=max(now,原值)+0=now。
4 只有被动回调,无主动查单对账。
5 shop_payment_flow无transaction_id索引,该字段无唯一约束。

Q1 哪几条真会炸、哪条我高估了?点名。
Q2 我没列但小程序卖虚拟商品一定踩的坑,按概率x损失排前3,写触发条件与后果。
Q3 不依赖商户号现在就能改的前三件事,按性价比排序。
每条≤3行,直接给结论。