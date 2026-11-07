# -*- coding: utf-8 -*-
"""第三层：团购列是否有值、收银销量表全列、微信账单真实结构。"""
import openpyxl
from collections import Counter

# ---------- A. 京东团购四列是否有值 ----------
f = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit\_probe_tmp\jd_order.xlsx"
wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
hdr = rows[1]
print("[A] 京东对账单 团购/核销列取值情况（第19~22列，共%d行数据）" % (len(rows) - 2))
for idx in [19, 20, 21, 22]:
    vals = [r[idx] for r in rows[2:] if idx < len(r)]
    nonempty = [v for v in vals if v not in (None, "", "-")]
    print("    第%d列 %s : 非空 %d / %d  样本=%s"
          % (idx, hdr[idx], len(nonempty), len(vals), nonempty[:3] if nonempty else "（全空）"))
# 订单类型=正向订单的行，看营业/支出几列是否可用来算单均
print("    正向订单行示例（主订单号/应结/原价/服务费/用户支付货款）:")
n = 0
for r in rows[2:]:
    if r[7] == "正向订单":
        print("      ", r[13], "| 应结", r[23], "| 原价", r[24], "| 服务费", r[31],
              "| 配送费", r[32], "| 用户货款", r[36])
        n += 1
        if n >= 3:
            break
wb.close()

# ---------- B. tangshi.xlsx 全列 + 是否含渠道/团购 ----------
f2 = r"C:\Users\lzj\Desktop\tangshi.xlsx"
wb = openpyxl.load_workbook(f2, data_only=True)
ws = wb["菜品销售统计"]
print("\n[B] tangshi.xlsx「菜品销售统计」 %d行 x %d列" % (ws.max_row, ws.max_column))
rows = list(ws.iter_rows(values_only=True))
print("    标题行:", rows[0][0])
print("    日期行:", rows[1][0])
print("    表头(row3):", [str(v) if v else "" for v in rows[2]])
print("    子表头(row4):", [str(v) if v else "" for v in rows[3]])
print("    数据样本(row5-7):")
for r in rows[4:7]:
    print("      ", [str(v)[:16] if v is not None else "" for v in r])
# 全表扫渠道/团购/抖音/美团关键字
kw = ["团购", "核销", "抖音", "美团", "外卖", "堂食", "渠道", "平台"]
hit = Counter()
for r in rows:
    for v in r:
        if v is None:
            continue
        s = str(v)
        for k in kw:
            if k in s:
                hit[k] += 1
print("    关键字命中:", dict(hit) or "0 处")
# 尾部几行（看有没有合计/渠道行）
print("    尾部 5 行:")
for r in rows[-5:]:
    print("      ", [str(v)[:18] if v is not None else "" for v in r])
wb.close()

# ---------- C. 微信支付账单真实结构 ----------
f3 = r"C:\Users\lzj\Desktop\02_经营财务\耙三样_耙牛肉2026-08-01_2026-08-31微信支付账单.xlsx"
wb = openpyxl.load_workbook(f3, data_only=True)
print("\n[C] 微信支付账单 sheets=", wb.sheetnames)
for ws in wb.worksheets:
    print("    -- %s  %d行 x %d列" % (ws.title, ws.max_row, ws.max_column))
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i >= 3:
            break
        print("       ", [str(v)[:20] if v is not None else "" for v in r][:10])
wb.close()
