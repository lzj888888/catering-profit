# -*- coding: utf-8 -*-
"""
R573 · 淘宝闪购(=饿了么) 账单 xlsx 现场取证（只读原件，不改写、不手抄）

源文件：C:/Users/lzj/Downloads/efd9ca3857d64c9791e84fded6166513.xlsx  sheet=外卖账单明细
纪律：金额一律 Decimal；所有结论由本脚本打印，禁止在任何文档里手抄数字。
"""
import warnings
from collections import Counter
from decimal import Decimal

warnings.filterwarnings("ignore")
import openpyxl

SRC = r"C:/Users/lzj/Downloads/efd9ca3857d64c9791e84fded6166513.xlsx"
SHEET = "外卖账单明细"

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb[SHEET]
rows = list(ws.iter_rows(values_only=True))
hdr = [("" if c is None else str(c).strip()) for c in rows[0]]
data = rows[1:]


def idx(name):
    return hdr.index(name)


def num(v):
    if v is None:
        return Decimal(0)
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "--"):
        return Decimal(0)
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        n = Decimal(s)
    except Exception:
        return Decimal(0)
    return -n if neg else n


def colsum(cols):
    return sum((sum(num(r[idx(c)]) for r in data) for c in cols), Decimal(0))


print("=" * 78)
print("[0] 形态：行数 =", len(data), " 列数 =", len(hdr))

# ---- 1. 饿了么同源证据：配送方式 / 门店 ----
print("\n[1] 饿了么同源直接证据")
print("    配送方式取值分布 =", dict(Counter(str(r[idx("配送方式")]) for r in data)))
print("    门店ID 去重     =", sorted({str(r[idx("门店ID")]) for r in data}))
print("    门店名称 去重   =", sorted({str(r[idx("门店名称")]) for r in data}))

bd = [str(r[idx("账单日期")]) for r in data if r[idx("账单日期")]]
print("    账单日期区间     =", min(bd), "~", max(bd), " 去重天数 =", len(set(bd)))
sd = [str(r[idx("结算日期")]) for r in data if r[idx("结算日期")]]
print("    结算日期样本     =", sd[0], "（账单日期样本", bd[0], "）")

# ---- 2. 订单类型分布 ----
print("\n[2] 订单类型分布 =", dict(Counter(str(r[idx("订单类型")]) for r in data)))

# ---- 3. 补贴列家族与各自合计 ----
merchant_cols = [c for c in hdr if c.startswith("商家") and ("补贴" in c or "券" in c)]
platform_cols = [c for c in hdr if c.startswith("平台") and ("补贴" in c or "券" in c or "立减" in c)]
agent_cols = [c for c in hdr if c.startswith("代理商") and ("补贴" in c or "券" in c)]
other_sub_cols = ["外部补贴"]

print("\n[3] 补贴列家族")
print("    商家承担 =", merchant_cols, "->", colsum(merchant_cols))
print("    平台承担 =", platform_cols, "->", colsum(platform_cols))
print("    代理商   =", agent_cols, "->", colsum(agent_cols))
print("    外部补贴 =", other_sub_cols, "->", colsum(other_sub_cols))

# ---- 4. 费用类列 ----
fee_cols = ["平台服务费", "技术服务费", "优惠商品技术服务费", "非优惠商品技术服务费",
            "超抢手一口价技术服务费", "配送服务费", "增值服务费（店铺推广）", "募捐金额",
            "履约-增值服务费", "增值-慢必赔服务费", "增值-弱驻店服务费", "先享后付服务费"]
missing = [c for c in fee_cols if c not in hdr]
print("\n[4] 费用类（缺列检查 =", missing or "无", ")")
for c in fee_cols:
    if c in hdr:
        print("    %-26s = %s" % (c, colsum([c])))

# ---- 5. 到手等式复核 ----
net = colsum(["结算金额"])
goods = colsum(["商品金额"])
pack = colsum(["打包费"])
mer = colsum(merchant_cols)
fee = colsum([c for c in fee_cols if c in hdr])
lhs = goods + pack + mer + fee
print("\n[5] 到手等式（预期：结算金额 = 商品金额 + 打包费 + 商家补贴(负) + 费用(负)）")
print("    Σ商品金额   =", goods)
print("    Σ打包费     =", pack)
print("    Σ商家补贴   =", mer)
print("    Σ费用类     =", fee)
print("    左侧合计     =", lhs)
print("    Σ结算金额   =", net)
print("    差额         =", lhs - net)

# ---- 6. 用户实付侧（交叉验证来源）----
pay_cols = ["用户实付金额（现金）", "用户实付金额（福利额度）", "用户实付金额（储值卡）", "用户支付配送费"]
print("\n[6] 用户支付侧")
for c in pay_cols:
    if c in hdr:
        print("    %-26s = %s" % (c, colsum([c])))
print("    用户支付合计 =", colsum([c for c in pay_cols if c in hdr]))

# ---- 7. 逐行抽查前 5 行自洽性 ----
print("\n[7] 逐行抽查（商品+打包+商家补贴+费用 vs 结算金额）")
row_cols = ["商品金额", "打包费"] + merchant_cols + [c for c in fee_cols if c in hdr]
for k in range(5):
    r = data[k]
    s = sum(num(r[idx(c)]) for c in row_cols)
    n = num(r[idx("结算金额")])
    print("    R%d  订单=%s  逐项=%s  结算金额=%s  差=%s" % (k + 2, r[idx("订单编号")], s, n, s - n))
print("=" * 78)
