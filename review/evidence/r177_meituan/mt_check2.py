# -*- coding: utf-8 -*-
"""美团账单 · 按交易类型分组 / 有效订单口径 / 非外卖行归位（R177 补充）"""
import sys
from collections import Counter

sys.path.insert(0, r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r163_waimai')
import parse_bill as pb

PATH = r'C:\Users\lzj\Downloads\09bbd01042244a1fa98e0d0f1963211b.xlsx'
sheets = pb.load(PATH)
name, rows = sheets[1]
hdr = {c: v for c, v in rows[0].items()}
COL = {v: c for c, v in hdr.items()}
body = rows[1:]

def g(r, key):
    return pb.to_num(r.get(COL[key])) if key in COL else None

def sv(r, key):
    return r.get(COL[key], '') if key in COL else ''

print("=== 按交易类型分组 ===")
for tt in ['外卖订单', '流量助手节省转入广告', '保险']:
    sub = [r for r in body if sv(r, '交易类型') == tt]
    keys = ['商家应收款', '商品总价', '打包费', '商家对顾客的活动补贴', '美团活动补贴',
            '平台服务费(含佣金和配送服务费)', '佣金(实付)', '配送服务费(含补贴)']
    print("\n[%s] %d 行" % (tt, len(sub)))
    for k in keys:
        vals = [g(r, k) for r in sub]
        vals = [v for v in vals if v is not None]
        if vals:
            print("   %-30s Σ=%.2f (有值 %d 行)" % (k, sum(vals), len(vals)))
    print("   订单状态:", dict(Counter((sv(r, '订单状态') or '(空)') for r in sub)))
    print("   交易描述:", dict(Counter((sv(r, '交易描述') or '(空)') for r in sub).most_common(5)))

print("\n=== 外卖订单行的状态分布与金额 ===")
sub = [r for r in body if sv(r, '交易类型') == '外卖订单']
for st in ['订单完成', '订单取消', '订单已处理']:
    s2 = [r for r in sub if sv(r, '订单状态') == st]
    if not s2:
        continue
    net = sum(g(r, '商家应收款') or 0 for r in s2)
    print("  %-8s %2d 笔  应收合计 %.2f" % (st, len(s2), net))
    if st != '订单完成':
        for r in s2:
            print("      单号=%s 应收=%s 商品=%s 打包=%s 补贴=%s 服务费=%s 时间=%s 描述=%s"
                  % (sv(r, '订单号'), g(r, '商家应收款'), g(r, '商品总价'), g(r, '打包费'),
                     g(r, '商家对顾客的活动补贴'), g(r, '平台服务费(含佣金和配送服务费)'),
                     sv(r, '完成时间'), sv(r, '交易描述')))

print("\n=== 非外卖行（广告 / 保险）逐行 ===")
for r in body:
    tt = sv(r, '交易类型')
    if tt in ('流量助手节省转入广告', '保险'):
        print("  %-14s 应收=%8s 日期=%s 描述=%s 订单号=%s" % (tt, g(r, '商家应收款'),
              sv(r, '账单日期'), sv(r, '交易描述'), sv(r, '订单号')))

print("\n=== 归位验算 ===")
def tot_of(keys, sub):
    s = 0.0
    for r in sub:
        for k in keys:
            v = g(r, k)
            if v is not None:
                s += v
    return round(s, 2)

order = [r for r in body if sv(r, '交易类型') == '外卖订单']
ad = [r for r in body if sv(r, '交易类型') == '流量助手节省转入广告']
ins = [r for r in body if sv(r, '交易类型') == '保险']
allr = body

print("  外卖订单 应收           = %.2f" % tot_of(['商家应收款'], order))
print("  广告转入 应收           = %.2f" % tot_of(['商家应收款'], ad))
print("  保险     应收           = %.2f" % tot_of(['商家应收款'], ins))
print("  三类相加                = %.2f" % round(tot_of(['商家应收款'], order + ad + ins), 2))
print("  全部行 应收             = %.2f" % tot_of(['商家应收款'], allr))
print()
print("  外卖订单：商品总价+打包费+商家补贴+服务费 = %.2f" % round(
    tot_of(['商品总价', '打包费', '商家对顾客的活动补贴', '平台服务费(含佣金和配送服务费)'], order), 2))
print("  单看外卖订单行的 应收   = %.2f" % tot_of(['商家应收款'], order))
print()
print("  广告 %s + 保险 %s = %.2f" % (tot_of(['商家应收款'], ad), tot_of(['商家应收款'], ins),
      round(tot_of(['商家应收款'], ad) + tot_of(['商家应收款'], ins), 2)))
print("  1747.95 + 广告 + 保险 = %.2f" % round(1747.95 - tot_of(['商家应收款'], ad) - tot_of(['商家应收款'], ins), 2))

print("\n=== 「商品数量」列样值 ===")
c = COL.get('商品数量')
print("  有值行数:", sum(1 for r in body if r.get(c, '') not in ('', None)))
print("  样值:", [r.get(c) for r in body[:5]])

print("\n=== 汇总信息表（原样 9 行）===")
n3, r3 = sheets[2]
for r in r3:
    print("   ", ' | '.join(str(r.get(cc, '')) for cc in range(1, 6)))

print("\n=== 账单明细：非零行 ===")
n1, r1 = sheets[0]
b1 = r1[2:]
for r in b1:
    v = pb.to_num(r.get(5))
    if v:
        print("  %s  账单金额=%s  结算日期=%s  账期=%s" % (r.get(4), v, r.get(8), r.get(7)))
print("  账单明细非零行数:", sum(1 for r in b1 if pb.to_num(r.get(5))))
