# -*- coding: utf-8 -*-
"""美团外卖结算账单 · 逐行勾稽核验（R177）"""
import sys, os, json
from collections import Counter

sys.path.insert(0, r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r163_waimai')
import parse_bill as pb

PATH = r'C:\Users\lzj\Downloads\09bbd01042244a1fa98e0d0f1963211b.xlsx'
sheets = pb.load(PATH)
print("sheets:", [(n, len(r)) for n, r in sheets])

# ---------- 订单明细 ----------
name, rows = sheets[1]
hdr = {c: v for c, v in rows[0].items()}
W = max(hdr.keys())
COL = {v: c for c, v in hdr.items()}
body = rows[1:]

def g(r, key):
    return pb.to_num(r.get(COL[key])) if key in COL else None

def sv(r, key):
    return r.get(COL[key], '') if key in COL else ''

print("\n=== 行数 %d ===" % len(body))
for k in ['交易类型', '交易描述', '订单状态', '结算状态', '配送方式', '用户支付方式', '费率']:
    c = Counter((sv(r, k) or '(空)') for r in body)
    print("%-10s %s" % (k, dict(c.most_common(8))))

dates = sorted(set(sv(r, '账单日期') for r in body if sv(r, '账单日期')))
print("账单日期范围: %s ~ %s (%d 个不同日期)" % (dates[0], dates[-1], len(dates)))

print("\n=== 逐行勾稽 ===")
FORMULAS = {
    'A1 商品总价+打包费+商家补贴+平台服务费':
        lambda r: (g(r, '商品总价') or 0) + (g(r, '打包费') or 0) + (g(r, '商家对顾客的活动补贴') or 0) + (g(r, '平台服务费(含佣金和配送服务费)') or 0),
    'A2 A1+公益捐款':
        lambda r: (g(r, '商品总价') or 0) + (g(r, '打包费') or 0) + (g(r, '商家对顾客的活动补贴') or 0) + (g(r, '平台服务费(含佣金和配送服务费)') or 0) + (g(r, '公益捐款') or 0),
    'A3 A2+美团活动补贴':
        lambda r: (g(r, '商品总价') or 0) + (g(r, '打包费') or 0) + (g(r, '商家对顾客的活动补贴') or 0) + (g(r, '平台服务费(含佣金和配送服务费)') or 0) + (g(r, '公益捐款') or 0) + (g(r, '美团活动补贴') or 0),
    'A4 A2+佣金保底':
        lambda r: (g(r, '商品总价') or 0) + (g(r, '打包费') or 0) + (g(r, '商家对顾客的活动补贴') or 0) + (g(r, '平台服务费(含佣金和配送服务费)') or 0) + (g(r, '佣金保底') or 0),
    'A5 A2-美团活动补贴':
        lambda r: (g(r, '商品总价') or 0) + (g(r, '打包费') or 0) + (g(r, '商家对顾客的活动补贴') or 0) + (g(r, '平台服务费(含佣金和配送服务费)') or 0) - (g(r, '美团活动补贴') or 0),
}
for label, fn in FORMULAS.items():
    bad, sdev = 0, 0.0
    for r in body:
        net = g(r, '商家应收款')
        if net is None:
            continue
        d = round(fn(r) - net, 2)
        if abs(d) > 0.01:
            bad += 1
            sdev += d
    print("  %-38s 不符 %3d 行 / 合计偏差 %+.2f" % (label, bad, sdev))

print("\n=== 等式 E1：平台服务费 = 佣金(实付) + 配送服务费(含补贴) ===")
bad = []
for i, r in enumerate(body, 2):
    tot = g(r, '平台服务费(含佣金和配送服务费)')
    a, b = g(r, '佣金(实付)'), g(r, '配送服务费(含补贴)')
    if tot is None and a is None and b is None:
        continue
    calc = round((a or 0) + (b or 0), 2)
    if tot is None or abs(calc - tot) > 0.01:
        bad.append((i, tot, a, b, calc, sv(r, '订单号')))
print("  不符 %d 行" % len(bad))
for x in bad[:10]:
    print("   行%d 平台服务费=%s 佣金=%s 配送=%s 算得=%s 单号=%s" % x)

print("\n=== 偏差行详查（口径 A2 偏差最大 8 行）===")
tmp = []
for i, r in enumerate(body, 2):
    net = g(r, '商家应收款')
    if net is None:
        continue
    f = FORMULAS['A2 A1+公益捐款'](r)
    tmp.append((abs(f - net), i, r, net, f))
tmp.sort(key=lambda x: -x[0])
for _, i, r, net, f in tmp[:8]:
    print(" 行%-3d 应收=%8s | 商品%8s 打包%6s 商家补贴%9s 平台服务费%8s 公益%6s | 算得=%8.2f 偏差=%+.2f | %s %s"
          % (i, net, g(r, '商品总价'), g(r, '打包费'), g(r, '商家对顾客的活动补贴'),
             g(r, '平台服务费(含佣金和配送服务费)'), g(r, '公益捐款'), f, f - net,
             sv(r, '交易类型'), sv(r, '订单状态')))

print("\n=== 合计 ===")
tot = {}
for k in ['商家应收款', '商品总价', '打包费', '商家对顾客的活动补贴', '美团活动补贴',
          '平台服务费(含佣金和配送服务费)', '商家代金券商家补贴', '商家代金券美团补贴',
          '公益捐款', '佣金(实付)', '配送服务费(含补贴)', '佣金保底', '保底',
          '距离加价', '价格加价', '用户支付配送费', '用户线上支付金额', '用户线下支付金额',
          '平台服务费返还', '佣金补贴', '配送服务费优惠', '配送服务费补贴']:
    vals = [g(r, k) for r in body]
    vals = [v for v in vals if v is not None]
    tot[k] = round(sum(vals), 2) if vals else None
for k, v in tot.items():
    print("  %-32s %s" % (k, v))

print("\n商家补贴 + 美团补贴 = %s" % round((tot['商家对顾客的活动补贴'] or 0) + (tot['美团活动补贴'] or 0), 2))
print("商品总价 + 打包费 = %s" % round((tot['商品总价'] or 0) + (tot['打包费'] or 0), 2))

# ---------- 账单明细（逐日）----------
print("\n=== 表1 账单明细（逐日结算）===")
n1, r1 = sheets[0]
h1 = {c: v for c, v in r1[1].items()}
print("  表头:", [h1.get(c, '') for c in range(1, 10)])
body1 = r1[2:]
print("  行数:", len(body1))
s = 0.0
for r in body1:
    v = pb.to_num(r.get(5))
    if v is not None:
        s += v
print("  账单金额合计:", round(s, 2))
for r in body1[:5]:
    print("   ", ' | '.join(str(r.get(c, '')) for c in range(1, 10)))

# ---------- 汇总信息 ----------
print("\n=== 表3 汇总信息（原样）===")
n3, r3 = sheets[2]
for r in r3:
    print("   ", ' | '.join(str(r.get(c, '')) for c in range(1, 6)))

# ---------- 账户余额流水 ----------
print("\n=== 表4 账户余额流水 前5行 ===")
n4, r4 = sheets[3]
for r in r4[:6]:
    print("   ", ' | '.join(str(r.get(c, '')) for c in range(1, 8)))
print("   行数:", len(r4))
