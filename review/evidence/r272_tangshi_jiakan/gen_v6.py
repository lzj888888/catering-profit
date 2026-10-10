# -*- coding: utf-8 -*-
"""R272 堂食建卡 v6 —— 全 20 道作业单（生产引擎已复算 20/20）

输入：card_payload_20.json（verify_cards_20.js 用生产引擎 calcCostCard 复算通过后落盘）
输出：堂食建卡作业单_全20道_引擎已验证.xlsx
"""
import json
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
PAY = os.path.join(HERE, 'card_payload_20.json')
OUT = os.path.join(HERE, '堂食建卡作业单_全20道_引擎已验证.xlsx')

with open(PAY, encoding='utf-8') as f:
    cards = json.load(f)

# 售价 / 份数 / 销售额（来自销售统计 xlsx，销售额 ÷ 份数 = 实际成交均价）
META = {
    '小面': (1033.00, 139, '面食'), '抄手': (940.00, 75, '面食'), '韭叶': (916.00, 128, '面食'),
    '米线': (628.00, 88, '面食'), '耙牛肉（半斤）': (412.83, 13, '招牌菜'),
    '耙牛筋（半斤）': (324.29, 10, '招牌菜'), '毛血旺': (248.00, 6, '招牌菜'),
    '小料': (140.89, 32, '蘸料台'), '耙肥肠（四两）': (140.40, 6, '招牌菜'),
    '泡椒酸菜鱼': (134.40, 4, '江湖菜'), '肥肠二两': (128.00, 8, '面食'),
    '韭菜炒蛋': (128.00, 8, '炒菜'), '肥肠三两': (126.00, 7, '面食'),
    '刀削': (114.00, 16, '面食'), '水煮肉片': (114.00, 3, '江湖菜'),
    '牛肉滑': (108.18, 6, '火锅涮品'), '杂酱二两': (96.00, 8, '面食'),
    '红汤大锅': (93.64, 5, '锅底'), '牛肉三两': (90.00, 5, '面食'),
    '蛋炒饭': (90.00, 9, '主食'),
}

THIN = Side(style='thin', color='D0D0D0')
BD = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
H_FILL = PatternFill('solid', fgColor='1F4E79')
H_FONT = Font(color='FFFFFF', bold=True, size=11)
WARN = PatternFill('solid', fgColor='FFC7CE')
CAUT = PatternFill('solid', fgColor='FFEB9C')
GOOD = PatternFill('solid', fgColor='C6EFCE')
TITLE = Font(bold=True, size=13)


def style_header(ws, row=1, ncol=None):
    ncol = ncol or ws.max_column
    for c in range(1, ncol + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = H_FILL
        cell.font = H_FONT
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = BD


def autosize(ws, maxw=52):
    for col in range(1, ws.max_column + 1):
        w = 0
        for r in range(1, ws.max_row + 1):
            v = ws.cell(row=r, column=col).value
            if v is None:
                continue
            s = str(v)
            # 中文按 2 宽估
            n = sum(2 if ord(ch) > 127 else 1 for ch in s)
            w = max(w, n)
        ws.column_dimensions[get_column_letter(col)].width = min(max(w + 2, 8), maxw)


wb = openpyxl.Workbook()

# ============ ① 20 张卡总览（引擎复算） ============
ws = wb.active
ws.title = '①20张卡总览'
ws.append(['R272 堂食建卡 · 全 20 张（免费档卡上限）｜成本已用生产引擎 calcCostCard 复算 20/20 对上'])
ws['A1'].font = TITLE
ws.append([])
hdr = ['序', '批次', '菜名', '类别', '本月销售额(元)', '份数', '实际售价(元)',
       '查证成本(元)', '引擎成本(元)', '差(元)', '毛利率%', '校验', '提醒']
ws.append(hdr)
style_header(ws, row=3, ncol=len(hdr))

order = sorted(cards, key=lambda c: -META.get(c['name'], (0, 0, ''))[0])
tot_amt = 0.0
for i, c in enumerate(order, 1):
    amt, cnt, cat = META.get(c['name'], (0, 0, c.get('category', '')))
    tot_amt += amt
    price = c['price_fen'] / 100
    eng = c['engine_cost_fen'] / 100
    chk = c['check_cost_yuan']
    diff = round(abs(eng - chk), 3)
    mg = c['engine_margin_pct']
    if mg < 40:
        note, fill = '⚠️ 毛利<40%，优先复核/调价', WARN
    elif mg < 45:
        note, fill = '贴红线，建议盯控', CAUT
    else:
        note, fill = '', GOOD
    batch = '首批' if i <= 7 else '第二批'
    ws.append([i, batch, c['name'], cat, amt, cnt, round(price, 2),
               chk, round(eng, 2), diff, mg, 'OK', note])
    for cc in range(1, len(hdr) + 1):
        ws.cell(row=ws.max_row, column=cc).border = BD
    ws.cell(row=ws.max_row, column=12).fill = fill
    if note:
        ws.cell(row=ws.max_row, column=13).fill = fill

ws.append([])
ws.append(['合计', '', '20 张卡', '', round(tot_amt, 2), sum(META.get(c['name'], (0, 0, ''))[1] for c in cards),
           '', '', '', '', '', '20/20 OK',
           '占全表 33146.2 元 = %.2f%%' % (tot_amt / 33146.2 * 100)])
for cc in range(1, len(hdr) + 1):
    ws.cell(row=ws.max_row, column=cc).font = Font(bold=True)
autosize(ws)
ws.freeze_panes = 'A4'

# ============ ② 逐原料明细（照填建卡页） ============
ws2 = wb.create_sheet('②逐原料明细')
ws2.append(['R272 · 20 张卡的逐原料明细 —— 建卡页照此填写（input_type=2 手工行，无需先录原料档案）'])
ws2['A1'].font = TITLE
ws2.append([])
hdr2 = ['菜名', '序', '原料名', '克数(净料)', '净料单位成本(万分/克)', '本行成本(元)', '备注']
ws2.append(hdr2)
style_header(ws2, row=3, ncol=len(hdr2))
for c in order:
    for j, l in enumerate(c['lines'], 1):
        row = [c['name'], j, l['name'], l['quantity'], l['net_unit_cost'],
               round(l['quantity'] * l['net_unit_cost'] / 10000, 4),
               '固定金额项(quantity=1)' if l['quantity'] == 1 and l['net_unit_cost'] >= 1000 else '']
        ws2.append(row)
        for cc in range(1, len(hdr2) + 1):
            ws2.cell(row=ws2.max_row, column=cc).border = BD
    ws2.append([c['name'], '', '—— 小计 ——', '', '', round(c['engine_cost_fen'] / 100, 2),
                '售价 %.2f 元 · 毛利 %s%%' % (c['price_fen'] / 100, c['engine_margin_pct'])])
    for cc in range(1, len(hdr2) + 1):
        ws2.cell(row=ws2.max_row, column=cc).font = Font(bold=True)
autosize(ws2)
ws2.freeze_panes = 'A4'

# ============ ③ 单位口径说明 ============
ws3 = wb.create_sheet('③单位口径')
rows3 = [
    ['单位口径（与生产引擎 calcCostCard 一致，别按自己的理解填）', ''],
    ['', ''],
    ['项', '说明'],
    ['net_unit_cost', '净料单位成本，单位 = 万分/克 的整数'],
    ['行成本(元)', 'quantity(克) × net_unit_cost ÷ 10000'],
    ['克数填什么', '填「净料重」。出成率折损已经含在 net_unit_cost 里，不要在克数上再乘一次'],
    ['net_unit_cost 怎么来', '元/斤 × 2000 ÷ 出成率%　（例：生肥肠 14.5 元/斤、出成 55% → 14.5×2000÷55 ≈ 527）'],
    ['固定金额项', '骨汤 / 卤料 / 调味等没有克数的项 → quantity=1，net_unit_cost = 元 × 10000'],
    ['input_type', '全部 = 2（手工行），无需先在原料档案里建原料'],
    ['售价口径', '实际成交均价 = 销售额 ÷ 份数，不是菜单定价'],
    ['', ''],
    ['本轮修正（重要）', ''],
    ['v5 的数据错误', 'v5「②第二批13道」把耙肥肠（四两）成本写成 16.10 元、毛利 31.2%，'],
    ['', '但 16.10 是 v1「我的估算」；豆包 v2 查证值 = 11.55 元。'],
    ['修正后', '耙肥肠（四两）：售价 23.40 元 − 成本 11.55 元 ⇒ 毛利率 50.6%，不是 31.2%'],
    ['影响', '「全表毛利最低」的结论随之改变：真正最低的是 牛肉滑 30.2%，其次 耙牛肉 35.8%'],
]
for r in rows3:
    ws3.append(r)
ws3['A1'].font = TITLE
style_header(ws3, row=3, ncol=2)
for rr in (13, 14, 15, 16):
    ws3.cell(row=rr, column=1).font = Font(bold=True)
autosize(ws3, maxw=90)

# ============ ④ 低毛利预警 ============
ws4 = wb.create_sheet('④低毛利预警')
ws4.append(['毛利率排序（由低到高）—— 用实际售价算，不是菜单价'])
ws4['A1'].font = TITLE
ws4.append([])
hdr4 = ['排名', '菜名', '售价(元)', '成本(元)', '毛利率%', '本月销售额(元)', '份数', '建议']
ws4.append(hdr4)
style_header(ws4, row=3, ncol=len(hdr4))
low = sorted(cards, key=lambda c: c['engine_margin_pct'])
for i, c in enumerate(low, 1):
    amt, cnt, _ = META.get(c['name'], (0, 0, ''))
    mg = c['engine_margin_pct']
    if mg < 35:
        adv, fill = '严重：招牌菜却最低毛利，复核配方或调价/控占比', WARN
    elif mg < 40:
        adv, fill = '低于 40%，优先复核', WARN
    elif mg < 45:
        adv, fill = '贴红线，盯控采购价波动', CAUT
    else:
        adv, fill = '正常', GOOD
    ws4.append([i, c['name'], round(c['price_fen'] / 100, 2), round(c['engine_cost_fen'] / 100, 2),
                mg, amt, cnt, adv])
    for cc in range(1, len(hdr4) + 1):
        ws4.cell(row=ws4.max_row, column=cc).border = BD
    ws4.cell(row=ws4.max_row, column=5).fill = fill
autosize(ws4)
ws4.freeze_panes = 'A4'

# ============ ⑤ 建卡执行 SOP ============
ws5 = wb.create_sheet('⑤建卡执行SOP')
sop = [
    ['建卡执行 SOP（一条命令建 20 张卡）', ''],
    ['', ''],
    ['步骤', '命令 / 动作'],
    ['1. 开自动化端口',
     'cli.bat auto --project C:/Users/lzj/WorkBuddy/Claw/catering-profit --auto-port 9420'],
    ['', '（若 IDE 弹 Windows 防火墙警报 ⇒ 必须点「允许访问」，否则 9420 不监听）'],
    ['2. 探活（只取 shop_id，不建卡）',
     'node build_cards_auto.js --dry-run'],
    ['3. 正式建卡',
     'node build_cards_auto.js'],
    ['', 'NODE_PATH 需指向 mpauto/node_modules；结果落 build_result.json'],
    ['4. 判据', '看 build_result.json：ok == total == 20，且每张卡有 card_code'],
    ['', ''],
    ['注意', ''],
    ['免费档上限', 'M3 免费 q = 20 张卡 ⇒ 这 20 张正好用满；再建会撞 FEATURE_LOCKED 付费墙'],
    ['幂等', '每张带 client_request_id（r272_<菜名>_<ts>），重跑不会重复建卡'],
    ['已建过首批 7 道？', '若已建过，重跑会走幂等跳过；必要时先查 shop_cost_card 现有卡数'],
    ['', ''],
    ['建卡后顺带验证（真机/模拟器）', ''],
    ['R264 覆盖率条', '覆盖率按金额算；口径仍为 A 档（分母=全表 33146.2）⇒ 20 张卡 = 18.1%'],
    ['C 档口径', '分母剔零售 + 自助计入分子 ⇒ 91.0%。属口径变更，需李老师批准后才改码'],
    ['R271 防翻倍', '数据导入→故意换平台→应三行红字+按钮变灰；改回后恢复（需扫新预览码）'],
]
for r in sop:
    ws5.append(r)
ws5['A1'].font = TITLE
style_header(ws5, row=3, ncol=2)
autosize(ws5, maxw=95)

wb.save(OUT)
print('SAVED:', OUT)
print('CARDS:', len(cards), 'TOTAL_AMT:', round(tot_amt, 2),
      'COVERAGE: %.2f%%' % (tot_amt / 33146.2 * 100))
