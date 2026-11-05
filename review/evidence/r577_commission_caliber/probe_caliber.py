# -*- coding: utf-8 -*-
"""R577 · 「外卖抽成 18~23%」到底是什么口径 —— 用真实账单把 8 种算法全算出来。

背景争议：
  · 我方 R573 结论：佣金（技术服务费）只占商品金额 2.47%，含配送 11.46% ⇒ 认为 18~23% 偏高
  · 李老师质疑：行业里外卖抽成通常就是那么高
  ⇒ 高度怀疑是**分母不同**（我方用商品原价，是最大分母），而不是谁算错。

纪律：只读原件、Decimal 到分、逐行加总、不手抄任何数字。
"""
import warnings
from decimal import Decimal, ROUND_HALF_UP
warnings.filterwarnings("ignore")
import openpyxl

SRC = r"C:/Users/lzj/Downloads/efd9ca3857d64c9791e84fded6166513.xlsx"
rows = list(openpyxl.load_workbook(SRC, read_only=True, data_only=True)["外卖账单明细"].iter_rows(values_only=True))
hdr = [("" if c is None else str(c).strip()) for c in rows[0]]
data = rows[1:]
i = {c: hdr.index(c) for c in hdr}


def n(v):
    if v is None:
        return Decimal(0)
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "--"):
        return Decimal(0)
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        x = Decimal(s)
    except Exception:
        return Decimal(0)
    return -x if neg else x


tot = lambda c: sum((n(r[i[c]]) for r in data), Decimal(0))
pct = lambda a, b: (a / b * 100).quantize(Decimal("0.01"), ROUND_HALF_UP) if b else Decimal(0)

goods = tot("商品金额")
pack = tot("打包费")
gross_before = goods + pack                       # 优惠前总额
tech = tot("技术服务费")
ship = tot("配送服务费")
mer_subsidy = sum((tot(c) for c in hdr if c.startswith("商家") and ("补贴" in c or "券" in c)), Decimal(0))
plat_subsidy = sum((tot(c) for c in hdr if c.startswith("平台") and ("补贴" in c or "券" in c or "立减" in c)), Decimal(0))
net = tot("结算金额")

print("=" * 78)
print("原始合计（元，账单内全部行）")
print("  商品金额            ", goods)
print("  打包费              ", pack)
print("  优惠前总额(商品+打包)", gross_before)
print("  商家承担补贴        ", mer_subsidy)
print("  平台承担补贴        ", plat_subsidy)
print("  技术服务费(佣金)    ", tech)
print("  配送服务费          ", ship)
print("  平台服务费(冗余汇总)", tot("平台服务费"))
print("  结算金额(商家实收)  ", net)
print("  验算 商品+打包+商家补贴+佣金+配送 =", gross_before + mer_subsidy + tech + ship)

print("\n" + "=" * 78)
print("同一笔佣金，8 种分母 ⇒ 8 个「抽成率」（这就是争议根源）")
rows_out = [
    ("① 佣金 / 商品金额（我方 R573 用的）", tech, goods),
    ("② 佣金 / 优惠前总额(商品+打包)", tech, gross_before),
    ("③ 佣金 / 优惠后金额(商品−商家补贴)", tech, goods + mer_subsidy),
    ("④ 佣金 / 结算金额(商家实收)", tech, net),
    ("⑤ (佣金+配送) / 商品金额", tech + ship, goods),
    ("⑥ (佣金+配送) / 优惠前总额", tech + ship, gross_before),
    ("⑦ (佣金+配送) / 结算金额(商家实收)", tech + ship, net),
    ("⑧ (优惠前总额−结算) / 优惠前总额", gross_before - net, gross_before),
]
for label, a, b in rows_out:
    print("  %-40s %8s 元  = %6s%%" % (label, a, pct(a, b)))

print("\n" + "=" * 78)
print("账单自己声明的费率 vs 实际反算")
rates = {}
for k in ("抽佣费率", "技术服务费折扣系数"):
    if k in hdr:
        vals = sorted({str(r[i[k]]) for r in data if r[i[k]] not in (None, "")})
        print("  %s 取值 = %s" % (k, vals))
        rates[k] = vals
print("  ⇒ 若名义费率 = 抽佣费率 × 折扣系数，再乘哪个基数能对上佣金？")
if "抽佣费率" in hdr:
    r0 = n(data[0][i["抽佣费率"]])
    k0 = n(data[0][i["技术服务费折扣系数"]]) if "技术服务费折扣系数" in hdr else Decimal(1)
    print("     首行 抽佣费率=%s × 折扣=%s = %s%%" % (r0, k0, (r0 * k0).quantize(Decimal("0.01"))))
    print("     实际 佣金/优惠后 = %s%%   /商品金额 = %s%%" % (pct(tech, goods + mer_subsidy), pct(tech, goods)))

print("\n" + "=" * 78)
print("老板看到的三个数（手机端）")
print("  营业额/优惠前 ", gross_before, "  结算/到账 ", net, "  差额 ", gross_before - net)
print("  差额构成：商家自己贴的补贴 %s + 平台佣金 %s + 配送费 %s"
      % (mer_subsidy, tech, ship))
print("  ⇒ 差额里 %.1f%% 是**老板自己贴的**，不是平台收走的"
      % (mer_subsidy / (gross_before - net) * 100))
