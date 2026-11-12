# -*- coding: utf-8 -*-
"""R718 · 生成两套「真能导入」的餐饮账单 + 机器可读 fixture。

两套账在三个维度上都不同（店 / 月 / 平台），用于压 M3 数据隔离：
  账 A：观音桥店 / 2026-09 / 美团 + 堂食收银
  账 B：解放碑店 / 2026-10 / 饿了么 + 堂食收银
所有数字由本脚本从同一份原始行算出并写进 fixture.json，守卫独立重算比对
（不采信本脚本自述）。
"""
import json, os, io, csv
import openpyxl
from openpyxl import Workbook

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
matrix = {}   # 堂食 xlsx 的 openpyxl 真读回 cells

# ============ 原始行（唯一真源）============
# 外卖形态 C：日期 / 商品名 / 商品销量 / 商品销售额（元）
TAKEAWAY = {
    'A': dict(shop='shop_guanyinqiao', shop_name='老巷小面·观音桥店', month='2026-09', platform='meituan',
              rows=[('20260905', '小面', 30, 360.00), ('20260905', '牛肉面', 20, 480.00),
                    ('20260906', '小面', 25, 300.00), ('20260906', '牛肉面', 15, 360.00)]),
    'B': dict(shop='shop_jiefangbei', shop_name='老巷小面·解放碑店', month='2026-10', platform='eleme',
              rows=[('20261005', '小面', 10, 120.00), ('20261005', '抄手', 8, 96.00),
                    ('20261006', '小面', 12, 144.00), ('20261006', '抄手', 6, 72.00)]),
}
# 堂食形态 A：《菜品销售统计》（区间末日做 biz_date），菜品收入(元)
DINE = {
    'A': dict(period='2026/09/07 至 2026/09/13', biz_date='2026-09-13',
              rows=[('小面', 120, 1440.00), ('牛肉面', 80, 1920.00), ('抄手', 60, 720.00)]),
    'B': dict(period='2026/10/05 至 2026/10/11', biz_date='2026-10-11',
              rows=[('米线', 50, 800.00), ('肥肠面', 40, 880.00), ('抄手', 30, 360.00)]),
}
# M1 月度账本（getLedger 出参形态；金额分）
LEDGER = {
    'A': dict(month='2026-09', dine_in_fen=408000, takeaway_fen=150000, material_cost_fen=250000),
    'B': dict(month='2026-10', dine_in_fen=204000, takeaway_fen=43200, material_cost_fen=120000),
}
# 成本卡（各店独立）
CARDS = {
    'A': [dict(card_code='A_XM', name='小面', price_fen=1200, total_cost_fen=400),
          dict(card_code='A_NRM', name='牛肉面', price_fen=2400, total_cost_fen=900),
          dict(card_code='A_CS', name='抄手', price_fen=1200, total_cost_fen=500)],
    'B': [dict(card_code='B_XM', name='小面', price_fen=1200, total_cost_fen=420),
          dict(card_code='B_CS', name='抄手', price_fen=1200, total_cost_fen=520),
          dict(card_code='B_MX', name='米线', price_fen=1600, total_cost_fen=600),
          dict(card_code='B_FCM', name='肥肠面', price_fen=2200, total_cost_fen=850)],
}

def fen(y):
    return int(round(y * 100))

# ============ 1. 外卖 CSV（UTF-8 BOM，Excel 直接双击不乱码）============
for tag, d in TAKEAWAY.items():
    p = os.path.join(OUT, '账%s_外卖商品销量_%s_%s.csv' % (tag, d['month'].replace('-', ''), d['platform']))
    with io.open(p, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['日期', '商品名', '商品销量', '商品销售额'])
        for r in d['rows']:
            w.writerow([r[0], r[1], r[2], '%.2f' % r[3]])
    print('写出', os.path.basename(p))

# ============ 2. 堂食 xlsx（二级表头，形态 A 真结构）============
for tag, d in DINE.items():
    wb = Workbook()
    ws = wb.active
    ws.title = '菜品销售统计'
    ws.append(['菜品销售统计'])
    ws.append(['营业日期：【%s】；销售方式：【单品+套餐明细】；统计方式：【菜品名称】；统计规则：【同名菜品合并统计】' % d['period']])
    ws.append(['菜品名称', '销售数量', '销售数量占比', '销售额(元)', '销售额占比',
               '菜品收入(元)', '菜品收入占比', '菜品优惠(元)', '菜品优惠占比'])
    ws.append(['', '', '', '', '', '', '', '', ''])
    tot_qty = sum(r[1] for r in d['rows'])
    tot_inc = sum(r[2] for r in d['rows'])
    for name, qty, inc in d['rows']:
        ws.append([name, qty, round(qty / tot_qty, 4), inc, round(inc / tot_inc, 4),
                   inc, round(inc / tot_inc, 4), 0, 0])
    ws.append(['合计', tot_qty, 1, tot_inc, 1, tot_inc, 1, 0, 0])
    p = os.path.join(OUT, '账%s_堂食菜品销售统计_%s.xlsx' % (tag, d['biz_date'].replace('-', '')))
    wb.save(p)
    print('写出', os.path.basename(p))
    # 🔴 R718：用 openpyxl **真读回**，把读回的 cells 落成机器可读副本。
    #   守卫（node，仓库内没有 xlsx 依赖）读这份副本喂生产解析器 ⇒ 输入是「真读回结果」，
    #   不是「写进去的值」。避免「我生成的我以为能读」的自述式取证。
    wb2 = openpyxl.load_workbook(p, data_only=True)
    ws2 = wb2['菜品销售统计']
    readback = [[('' if c is None else c) for c in row]
                for row in ws2.iter_rows(values_only=True)]
    matrix[tag] = {'file': os.path.basename(p), 'sheet': '菜品销售统计',
                   'readback_by': 'openpyxl', 'cells': readback}

# ============ 3. fixture.json（守卫唯一输入，含独立可复算期望）============
fx = {'meta': {
        'purpose': 'R718 两套账隔离审计：同店/跨店、同月/跨月、同平台/跨平台',
        'generated_by': 'review/evidence/r718_two_books/make_bills.py',
        'unit': '金额一律分(fen)；比例百分数',
      }, 'books': {}}
for tag in ('A', 'B'):
    t = TAKEAWAY[tag]
    dn = DINE[tag]
    lg = LEDGER[tag]
    fx['books'][tag] = {
        'shop_id': t['shop'], 'shop_name': t['shop_name'], 'month': t['month'],
        'takeaway_platform': t['platform'],
        'takeaway_rows': [list(r) for r in t['rows']],
        'dine_period': dn['period'], 'dine_biz_date': dn['biz_date'],
        'dine_rows': [list(r) for r in dn['rows']],
        'ledger': lg, 'cards': CARDS[tag],
        'expect': {
            'takeaway_qty': sum(r[2] for r in t['rows']),
            'takeaway_amount_fen': sum(fen(r[3]) for r in t['rows']),
            'dine_qty': sum(r[1] for r in dn['rows']),
            'dine_amount_fen': sum(fen(r[2]) for r in dn['rows']),
            # M1 实际菜品毛利率：菜品口径收入 = 堂食 + 外卖商品总价
            'actual_income_fen': lg['dine_in_fen'] + lg['takeaway_fen'],
            'food_cost_fen': lg['material_cost_fen'],
            # 标准菜单毛利率（售价加权）：1 - Σcost/Σprice
            'menu_margin_pct': round((1 - sum(c['total_cost_fen'] for c in CARDS[tag])
                                     / sum(c['price_fen'] for c in CARDS[tag])) * 100, 2),
        },
    }
with io.open(os.path.join(OUT, 'fixture.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(fx, f, ensure_ascii=False, indent=2)
print('写出 fixture.json')
fx['xlsx_readback'] = matrix
with io.open(os.path.join(OUT, 'bills_matrix.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(matrix, f, ensure_ascii=False, indent=2)
print('写出 bills_matrix.json（openpyxl 真读回 cells）')
