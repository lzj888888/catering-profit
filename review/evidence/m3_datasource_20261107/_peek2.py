# -*- coding: utf-8 -*-
"""深挖：列全名 + 关键列唯一值 + 是否有团购/核销字样。"""
import openpyxl
from collections import Counter

def uniq(ws, col_idx, limit=8, header_row=1):
    c = Counter()
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i < header_row:
            continue
        if col_idx < len(r):
            c[str(r[col_idx]).strip()] += 1
    return c.most_common(limit), sum(c.values())

# ---------- 1. taobao_goods 列全名 ----------
f = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit\_probe_tmp\taobao_goods.xlsx"
wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
ws = wb["data"]
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]
print("[1] 淘宝闪购·商品下载  共 %d 列 / %d 行数据" % (len(hdr), len(rows) - 1))
for i, h in enumerate(hdr):
    print("    %2d. %s" % (i, h))
print("    日期范围:", rows[1][0], "→", rows[-1][0])
names = set(r[3] for r in rows[1:] if r[3])
print("    商品数:", len(names), "| 前5:", list(names)[:5])
wb.close()

# ---------- 2. jd_order 82 列 + 渠道/类型分布 ----------
f2 = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit\_probe_tmp\jd_order.xlsx"
wb = openpyxl.load_workbook(f2, read_only=True, data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
grp, hdr = rows[0], rows[1]
print("\n[2] 京东秒送·订单对账单  共 %d 列 / %d 行数据" % (len(hdr), len(rows) - 2))
for i, h in enumerate(hdr):
    g = grp[i] if i < len(grp) and grp[i] else ""
    print("    %2d. [%s] %s" % (i, g, h))
for name, idx in [("订单渠道", 6), ("订单类型", 7), ("订单二级类型", 8), ("履约方式", 11),
                  ("对账单业务类型", 5)]:
    u, tot = uniq(ws, idx, 10, 2)
    print("    %s 分布(共%d行): %s" % (name, tot, u))
wb.close()

# ---------- 3. 淘宝闪购账单：业务类型里有没有团购 ----------
f3 = r"C:\Users\lzj\Desktop\02_经营财务\淘宝闪购.xlsx"
wb = openpyxl.load_workbook(f3, read_only=True, data_only=True)
ws = wb["外卖账单明细"]
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]
print("\n[3] 淘宝闪购·外卖账单明细  共 %d 列 / %d 行数据" % (len(hdr), len(rows) - 1))
print("    全部列名:", " | ".join(str(h) for h in hdr))
for name, idx in [("业务类型", 12), ("子业务类型", 13), ("订单类型", 5)]:
    u, tot = uniq(ws, idx, 12, 1)
    print("    %s 分布: %s" % (name, u))
# 全表扫团购/核销/到店
kw = ["团购", "核销", "到店", "自提", "券"]
hits = {}
for si, ws2 in enumerate(wb.worksheets):
    for ri, r in enumerate(ws2.iter_rows(values_only=True)):
        for ci, v in enumerate(r):
            if v is None:
                continue
            s = str(v)
            for k in kw:
                if k in s:
                    hits.setdefault((ws2.title, k), []).append((ri + 1, ci + 1, s[:30]))
print("    团购/核销/到店 字样命中:", {k: len(v) for k, v in hits.items()} or "0 处")
for k, v in list(hits.items())[:6]:
    print("      ", k, v[:3])
wb.close()

# ---------- 4. tangshi.xlsx 真实内容 ----------
f4 = r"C:\Users\lzj\Desktop\tangshi.xlsx"
wb = openpyxl.load_workbook(f4, data_only=True)
print("\n[4] tangshi.xlsx  sheets=", wb.sheetnames)
for ws in wb.worksheets:
    print("    -- %s  %d行 x %d列" % (ws.title, ws.max_row, ws.max_column))
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i >= 4:
            break
        print("       ", [str(v)[:24] if v is not None else "" for v in r][:12])
wb.close()
