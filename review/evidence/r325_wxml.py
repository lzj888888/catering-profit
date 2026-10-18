# -*- coding: utf-8 -*-
"""R325：矩阵结果区插入现金卡（wxml + wxss）。"""
import io

# ---------- wxml ----------
p = 'pages/sandbox/matrix.wxml'
s = io.open(p, encoding='utf-8').read()
anchor = """      <view class="insight none" wx:elif="{{result.insight}}">{{t.insightNone}}</view>
"""
assert s.count(anchor) == 1
CARD = anchor + """
      <!-- 🔴 R325：最后一道闸 —— 钱够不够开 / 能撑几个月。
           上面答「稳态能不能赚钱」，这里答「有没有命等到稳态」；两件事，不重复。 -->
      <view class="cash-card">
        <view class="cash-title">{{t.cashTitle}}</view>
        <view class="cash-lead">{{t.cashLead}}</view>
        <view class="cash-row">
          <text class="cash-lb">{{t.cashRentLabel}}</text>
          <input class="cash-inp" type="digit" value="{{cash.rentYuan}}" data-key="rentYuan" bindinput="onCashInput" adjust-position="{{true}}" cursor-spacing="20" placeholder="元" />
        </view>
        <view class="cash-row">
          <text class="cash-lb">{{t.cashBudgetLabel}}</text>
          <input class="cash-inp" type="digit" value="{{cash.budgetYuan}}" data-key="budgetYuan" bindinput="onCashInput" adjust-position="{{true}}" cursor-spacing="20" placeholder="元" />
        </view>
        <view class="cash-row">
          <text class="cash-lb">{{t.cashEquipLabel}}</text>
          <input class="cash-inp" type="digit" value="{{cash.equipYuan}}" data-key="equipYuan" bindinput="onCashInput" adjust-position="{{true}}" cursor-spacing="20" placeholder="元" />
        </view>
        <view class="cash-row">
          <text class="cash-lb">{{t.cashStockLabel}}</text>
          <input class="cash-inp" type="digit" value="{{cash.stockYuan}}" data-key="stockYuan" bindinput="onCashInput" adjust-position="{{true}}" cursor-spacing="20" placeholder="元" />
        </view>
        <block wx:if="{{cashRes}}">
          <view class="cash-need">{{cashRes.needText}}</view>
          <view class="cash-parts">{{cashRes.partsText}}</view>
          <view class="cash-verdict {{cashRes.levelCls}}">{{cashRes.verdictText}}</view>
          <view class="cash-note" wx:if="{{cashRes.noteText}}">{{cashRes.noteText}}</view>
        </block>
        <view class="cash-note">{{t.cashDepositNote}}</view>
      </view>
"""
s = s.replace(anchor, CARD, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('wxml ok')

# ---------- wxss ----------
p2 = 'pages/sandbox/matrix.wxss'
c = io.open(p2, encoding='utf-8').read()
if '.cash-card' not in c:
    c = c.rstrip('\n') + """

/* 🔴 R325：钱够不够开 · 能撑几个月
   ⚠️ 字号一律 ≥28rpx（AD-G1 可读性红线：老板多老花眼），层级只靠颜色/字重区分。 */
.cash-card { margin-top: 20rpx; padding: 24rpx; border-top: 1rpx solid #f0f0f0; }
.cash-title { font-size: 32rpx; font-weight: 600; color: #1a1a1a; }
.cash-lead { font-size: 28rpx; color: #8a97a8; margin-top: 8rpx; line-height: 1.5; }
.cash-row { display: flex; align-items: center; margin-top: 16rpx; }
.cash-lb { flex: 0 0 300rpx; font-size: 28rpx; color: #333; }
.cash-inp { flex: 1; height: 64rpx; font-size: 30rpx; text-align: right; border-bottom: 1rpx solid #e6e6e6; }
.cash-need { font-size: 32rpx; font-weight: 600; color: #1a1a1a; margin-top: 20rpx; }
.cash-parts { font-size: 28rpx; color: #8a97a8; margin-top: 8rpx; line-height: 1.5; }
.cash-verdict { font-size: 30rpx; font-weight: 600; margin-top: 16rpx; }
.cash-verdict.ok { color: #1f7a4d; }
.cash-verdict.warn { color: #b3491d; }
.cash-note { font-size: 28rpx; color: #8a97a8; margin-top: 10rpx; line-height: 1.5; }
"""
    io.open(p2, 'w', encoding='utf-8', newline='').write(c)
print('wxss ok')
