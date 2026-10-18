# -*- coding: utf-8 -*-
"""R325c：补齐 t 映射（js 引用的每个 T.cash* 都必须在映射里赋值），并加「引用集 ⊆ 赋值集」断言。"""
import io

# 1) matrix.js：t 映射补齐
p = 'pages/sandbox/matrix.js'
s = io.open(p, encoding='utf-8').read()
a = "      cashYuanPh: M.cashYuanPh,"
assert s.count(a) == 1
ADD = """      cashYuanPh: M.cashYuanPh,
      // 🔴 下面这些是 buildCash() 里直接读 T.xxx 的键 —— 少一个就是 undefined（文案变成空/报错，且不报任何错）
      cashNeedText: M.cashNeedText,
      cashPartsText: M.cashPartsText,
      cashEquipMissing: M.cashEquipMissing,
      cashStockMissing: M.cashStockMissing,
      cashRemainText: M.cashRemainText,
      cashLevelSafe: M.cashLevelSafe,
      cashLevelTight: M.cashLevelTight,
      cashLevelDanger: M.cashLevelDanger,
      cashLevelShort: M.cashLevelShort,
      cashNeedBudget: M.cashNeedBudget,
      cashIncompleteNote: M.cashIncompleteNote,
      cashWan: M.cashWan,"""
s = s.replace(a, ADD, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)

# 2) wxml：noteText 恒空，删掉该行（避免留一个永不渲染的死分支）
p2 = 'pages/sandbox/matrix.wxml'
w = io.open(p2, encoding='utf-8').read()
dead = '          <view class="cash-note" wx:if="{{cashRes.noteText}}">{{cashRes.noteText}}</view>\n'
assert w.count(dead) == 1
w = w.replace(dead, '', 1)
io.open(p2, 'w', encoding='utf-8', newline='').write(w)

# 3) terms：删掉未被引用的 cashRunwayUnknown（避免「定义了不用」）
for q in ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']:
    t = io.open(q, encoding='utf-8').read()
    line = "    cashRunwayUnknown: '撑几个月算不出（这一档没有有效保本数据）',\n"
    assert t.count(line) == 1, (q, t.count(line))
    t = t.replace(line, '', 1)
    io.open(q, 'w', encoding='utf-8', newline='').write(t)

print('ok')
