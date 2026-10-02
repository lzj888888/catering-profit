# -*- coding: utf-8 -*-
"""R193：给 i18n 双副本注入新增文案键（站级入口补全）。
🔴 单源纪律：miniprogram/i18n/terms.js 与 specs/dev-specs/i18n/terms.js 必须逐字一致（改完 md5 校验）。
"""
import io, hashlib

FILES = [
    'miniprogram/i18n/terms.js',
    'specs/dev-specs/i18n/terms.js',
]

# ① exp 组（「我的」页三行新入口 + 客服兜底）
ANCHOR_EXP = "    feedbackHint: '使用中遇到问题，点这里反馈',\n"
ADD_EXP = (
    "    // R193：站级兜底入口 —— 订单/订阅（此前只有到期弹条能进）、客服、使用指引\n"
    "    ordersEntry: '我的订阅 / 订单',\n"
    "    serviceEntry: '联系客服',\n"
    "    guideEntry: '使用指引',\n"
    "    guideBody: '① 先建店铺：首页顶部店铺名，可切换或新建。\\n② 再录一个月：M1 把房租、水电、食材等填进去，就能看到参考利润。\\n③ 再算菜品：M3 建菜品成本卡，看每道菜赚多少、该卖多少钱。\\n④ 想开店先试算：M2 填投入和每月固定支出，算保本营业额。',\n"
    "    // 客服会话拉不起时的兜底（未绑客服人员 / 基础库过低）\n"
    "    serviceNotOpen: '客服暂未开通，可先在「意见反馈」里留言',\n"
    "    guideOk: '知道了',\n"
)

# ② m2 组（沙盘草稿：上次输入恢复 + 清空重填）
ANCHOR_M2 = "    calc: '开始测算',\n"
ADD_M2 = (
    "    // R193：M2 算完即丢 —— 本地草稿（零云端改动）\n"
    "    draftRestored: '已载入上次填的数，继续改即可',\n"
    "    clearDraft: '清空重填',\n"
    "    draftCleared: '已清空，可重新填写',\n"
)

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    assert s.count(ANCHOR_EXP) == 1, ('exp anchor', p, s.count(ANCHOR_EXP))
    assert s.count(ANCHOR_M2) == 1, ('m2 anchor', p, s.count(ANCHOR_M2))
    s = s.replace(ANCHOR_EXP, ANCHOR_EXP + ADD_EXP, 1)
    s = s.replace(ANCHOR_M2, ANCHOR_M2 + ADD_M2, 1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('written', p, len(s))

h = [hashlib.md5(io.open(p, 'rb').read()).hexdigest() for p in FILES]
print('md5:', h)
assert h[0] == h[1], 'MD5 MISMATCH'
print('MD5 OK')
