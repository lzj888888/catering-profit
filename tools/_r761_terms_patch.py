#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# R761：代金券口径纠偏（face=实付）+ 限用张数提示 + 第三段「填活动后毛利率反算」文案
# 双副本逐字同步，保留 CRLF（本仓 terms.js 是 CRLF 单源）
import hashlib

FILES = ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']

# 1) 代金券字段：券面额 → 实付多少钱（口径纠偏）
OLD_FACE = "    promoParamFace: '券面额',"
NEW_FACE = ("    // 🔴 R761 口径纠偏：face = 实付（花80买100面额就填80），统一算 实付÷抵额。\r\n"
            "    //   旧文案「券面额」让老板把「80代100」填成80却按减额算成2折 —— 与心智相反。\r\n"
            "    promoParamFace: '实付多少钱',\r\n"
            "    promoParamFaceHint: '80代100填80；满100减30填70',\r\n"
            "    promoParamLimit: '每单限用几张',\r\n"
            "    promoLimitPrefix: '要凑满',\r\n"
            "    promoLimitSuffix: '元，才能用最多这几张（几折不随张数变）',")

# 2) 第三段：填活动后毛利率反算。插在 promoFoot 之前
OLD_FOOT = "    promoFoot: '只做算术推演：毛利率与流水由你自己填，结果取决于这些数准不准。',"
NEW_FOOT = ("    // 🔴 R761 第三段：李老师原话「毛利率变20%，要做多少流水覆盖原来水平」——\r\n"
            "    //   直接填活动后毛利率，反算要打几折、流水×几倍、单量×几倍。\r\n"
            "    promoSecReverse: '三、我已经知道活动后毛利率，倒推要做多少',\r\n"
            "    promoReverseIntro: '比如正常毛利50%，做活动后只剩20%，填20就能倒推',\r\n"
            "    promoTargetMarginLabel: '活动后毛利率',\r\n"
            "    promoTargetMarginHint: '活动做完，每一百块流水里还剩多少毛利',\r\n"
            "    promoReverseEmpty: '填上现在和活动后的毛利率，就能倒推',\r\n"
            "    promoReverseBad: '活动后毛利率必须大于0、且低于现在的毛利率',\r\n"
            "    promoResReverseDiscount: '相当于打',\r\n"
            "    promoResReverseNeed: '要做到这些才持平',\r\n"
            + OLD_FOOT + "\r\n")

for p in FILES:
    s = open(p, encoding='utf-8', newline='').read()
    assert s.count(OLD_FACE) == 1, (p, 'face', s.count(OLD_FACE))
    assert s.count(OLD_FOOT) == 1, (p, 'foot', s.count(OLD_FOOT))
    s = s.replace(OLD_FACE, NEW_FACE).replace(OLD_FOOT, NEW_FOOT)
    open(p, 'w', encoding='utf-8', newline='').write(s)
    b = open(p, 'rb').read()
    print(p, 'md5=', hashlib.md5(b).hexdigest()[:12],
          'CRLF=', b.count(b'\r\n'), 'LF=', b.count(b'\n') - b.count(b'\r\n'))
