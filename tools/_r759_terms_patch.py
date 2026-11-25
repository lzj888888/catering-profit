# R759 文案双副本同步补丁（一次性脚本，跑完可留作证据）
# 用 newline='' 保留 CRLF，避免 Edit 把行尾翻成 LF（本仓 R190 坑）
import hashlib

OLD_START = "    promoIntro: "
OLD_END = "    // R693"

NEW = """    // ===== R759 按李老师纠偏重构：折扣换算是主角，回本测算是次要 =====
    //   原话：「买2送1相当于打几折…最终大部分都去到『是打了几折』这个问题；
    //          然后有一个是做活动降低毛利率了，需要多少回到原来的利润水平。」
    promoIntro: '先算「这个活动等于几折」——选活动、填规则，不用填任何店里数据。想再看「做完要多少才回到原来的利润」，往下填。',
    // 第一段（主）：活动 → 几折
    promoSecConvert: '一、这个活动相当于几折',
    promoKindLabel: '活动形式',
    promoKindOff: '直接打折',
    promoKindThreshold: '满多少减多少',
    promoKindBogo: '买几赠几',
    promoKindNth: '第 N 件半价',
    promoKindVoucher: '代金券',
    promoKindShare: '同行免单',
    promoKindStored: '储值赠金',
    promoKindOffset: '积分抵现',
    promoKindDirect: '时段/品类限定',
    promoParamDiscount: '打几折（8 折填 0.8）',
    promoParamThreshold: '满多少',
    promoParamCut: '减多少',
    promoParamBuy: '买几份',
    promoParamFree: '赠/免几份',
    promoParamN: '第几件半价',
    promoParamFace: '券面额',
    promoParamPeople: '几个人同行',
    promoParamPrincipal: '充值金额',
    promoParamBonus: '赠送金额',
    promoParamPayable: '应付金额',
    promoParamOffset: '抵现金额',
    promoResDiscount: '相当于打',
    promoZheUnit: '折',
    promoFormulaPrefix: '怎么算：',
    promoConvertEmpty: '选好活动、填上规则，这里就出折扣',
    promoConvertBad: '规则还没填全或填得不对——比如买几赠几要填两个大于 0 的数',
    // 第二段（次）：回本测算（才要毛利率）
    promoSecBack: '二、做完要多少才回到原来的利润',
    promoBackIntro: '活动把毛利率拉低了——填这三个数，看要做多少流水、卖多少单才保住原来的利润。不填就只看上面的折扣换算。',
    promoMarginLabel: '现在毛利率',
    promoMarginHint: '（售价 − 成本）÷ 售价。例：卖 20 元、成本 8 元 ⇒ 60%',
    promoRevenueLabel: '现在一天流水',
    promoRevenueHint: '填了才知道「要做多少钱」；不填只算要涨几成',
    promoPriceLabel: '现在客单价',
    promoPriceHint: '填了才知道「要卖多少单」——单数才是真实压力',
    promoYuanUnit: '元',
    promoOrdersUnit: '单',
    promoBackEmpty: '填上「现在毛利率」，才算得出回到原利润要做多少',
    promoBackBad: '这个折扣会让毛利率降到 0 以下，做一单亏一单——别做',
    promoResTitle: '算下来是这样',
    promoResNewMargin: '活动后毛利率',
    promoResOrdersNow: '现在一天',
    promoResRevenue: '流水要做到',
    promoResOrders: '一天要卖',
    promoResTraffic: '客人要多来',
    promoResCritical: '再低就亏：最低只能打',
    promoResCriticalHint: '低于这个折扣，卖一件亏一件',
    promoFoot: '只做算术推演：毛利率与流水由你自己填，结果取决于这些数准不准。',
"""

paths = ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']
digests = []
for p in paths:
    s = open(p, encoding='utf-8', newline='').read()
    a = s.index(OLD_START)
    b = s.index(OLD_END, a)
    s = s[:a] + NEW + s[b:]
    open(p, 'w', encoding='utf-8', newline='').write(s)
    digests.append(hashlib.md5(open(p, 'rb').read()).hexdigest())
    print('patched', p)

print('md5 equal:', digests[0] == digests[1], digests[0][:12])
assert digests[0] == digests[1], '双副本不一致'
