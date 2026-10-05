# -*- coding: utf-8 -*-
"""R227 · 三份真实销售表的「经营诊断」重算（只读，不改源文件）

输入：微信临时目录下 3 份 xlsx（2 份 md5 相同 = 重复上传）
输出：review/evidence/r227_sales_review/r227_report.out.txt
判据：所有数字都由本脚本现算，不抄 R226 结论（若与 R226 一致 = 互证）
"""
import sys, io, os, hashlib
from openpyxl import load_workbook

D = r"C:\Users\lzj\xwechat_files\wxid_auezz32wau7v22_5514\temp\RWTemp\2026-10\9c5c48749ff36941714d28465cf0bce5"
F_COMBO = os.path.join(D, "耙三样_耙牛肉_套餐销售统计_2026-10-05_19_02_53_mt956492lk_1791198174340.xlsx")
F_STORE = os.path.join(D, "门店下载_20260907至20260913__5366951484_20261005190640294.xlsx")
F_STORE1 = os.path.join(D, "门店下载_20260907至20260913__5366951484_20261005190640294(1).xlsx")
F_DISH = os.path.join(D, "耙三样_耙牛肉_菜品销售统计_2026-10-05_19_01_42_mt956492lk_1791198102677.xlsx")

OUT = []
def w(s=""):
    OUT.append(str(s))

def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(65536), b""):
            h.update(b)
    return h.hexdigest()

def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace(",", "")
    if s == "": return None
    try: return float(s)
    except ValueError: return None

def rows_of(ws, min_row=1):
    out = []
    for r in ws.iter_rows(min_row=min_row, values_only=True):
        out.append(list(r))
    return out

# ---------------------------------------------------------------- 0 文件同一性
w("=" * 78)
w("0. 文件同一性（md5）")
w("=" * 78)
for p in (F_COMBO, F_STORE, F_STORE1, F_DISH):
    if os.path.exists(p):
        w(f"  {md5(p)}  {os.path.getsize(p):>8}  {os.path.basename(p)}")
    else:
        w(f"  (缺失) {p}")
w("  ⇒ 两份「门店下载」md5 相同 = 同一文件重复上传；菜品表是同目录第 4 份（未随消息引用）")
w()

# ---------------------------------------------------------------- 1 外卖日经营
w("=" * 78)
w("1. 外卖（饿了么）门店日经营 · 2026-09-07~09-13")
w("=" * 78)
wb = load_workbook(F_STORE, data_only=True)
ws = wb["data"]
rs = rows_of(ws)
hdr = rs[0]
body = [r for r in rs[1:] if r[0] not in (None, "")]
w(f"  表头列数 = {len([h for h in hdr if h])}；数据行 = {len(body)}")
idx = {}
for i, h in enumerate(hdr):
    if h: idx[str(h)] = i
def col(r, name):
    i = idx.get(name)
    return num(r[i]) if i is not None and i < len(r) else None

sums = {}
for name in ["有效订单","无效订单","收入","营业额","商品销售额","打包费","商家应收配送费",
             "支出","平台技术服务费","履约技术服务费","智能满减服务费","退单费用","其他支出",
             "顾客实付总额","曝光人数","进店人数","下单人数","新客下单人数","老客下单人数",
             "曝光次数","进店次数","下单次数","有效订单","活动订单数",
             "活动补贴","代金券补贴","配送费补贴","智能满减补贴",
             "活动总补贴","饿了么补贴","代理商补贴",
             "商家活动成本（含满减活动）","商家活动成本（不含满减活动）",
             "上架商品数","有交易商品数","库存不足商品数","差评订单数","投诉订单数",
             "出餐超时订单数","商责退单数","拒单数","近7日复购人数","近30日复购人数"]:
    vals = [col(r, name) for r in body]
    vals = [v for v in vals if v is not None]
    if vals: sums[name] = sum(vals)

w("  -- 经营总量 --")
for k in ["有效订单","收入","营业额","商品销售额","打包费","顾客实付总额","支出"]:
    if k in sums: w(f"    {k:<12} {sums[k]:>12.2f}")
w(f"    单均营业额    {sums['营业额']/sums['有效订单']:>12.2f}")
w(f"    单均到手      {sums['收入']/sums['有效订单']:>12.2f}")
w(f"    到手率        {sums['收入']/sums['营业额']*100:>12.2f} %")
w()
w("  -- 费用结构（÷ 营业额）--")
base = sums["营业额"]
for k in ["平台技术服务费","履约技术服务费","智能满减服务费","退单费用","其他支出",
          "商家活动成本（含满减活动）","商家活动成本（不含满减活动）","活动总补贴"]:
    if k in sums:
        w(f"    {k:<22} {sums[k]:>10.2f}  = {sums[k]/base*100:>6.2f} %")
w(f"    {'平台两项技术服务费合计':<22} {sums['平台技术服务费']+sums['履约技术服务费']:>10.2f}  = "
  f"{(sums['平台技术服务费']+sums['履约技术服务费'])/base*100:>6.2f} %")
w()
w("  -- 流量漏斗（人数口径）--")
ex, en, od = sums["曝光人数"], sums["进店人数"], sums["下单人数"]
w(f"    曝光 {ex:.0f}  →  进店 {en:.0f}（{en/ex*100:.2f}%）  →  下单 {od:.0f}"
  f"（进店→下单 {od/en*100:.2f}% / 曝光→下单 {od/ex*100:.2f}%）")
w(f"    下单人数中新客 {sums['新客下单人数']:.0f} 老客 {sums['老客下单人数']:.0f}"
  f"  ⇒ 老客占 {sums['老客下单人数']/od*100:.1f}%")
w()
w()
w("  -- 商品与履约（🔴 快照类指标：给逐日值，不可求和）--")
for k in ["上架商品数","有交易商品数","库存不足商品数","近7日复购人数","近30日复购人数"]:
    vals = [col(r, k) for r in body]
    vals = [v for v in vals if v is not None]
    if vals:
        w(f"    {k:<12} 逐日 {[int(v) for v in vals]}  区间 {min(vals):.0f}~{max(vals):.0f}  均值 {sum(vals)/len(vals):.1f}")
for k in ["差评订单数","投诉订单数","出餐超时订单数","商责退单数","拒单数","活动订单数"]:
    if k in sums: w(f"    {k:<12} 7日合计 {sums[k]:.0f}")
w(f"    活动订单占比  {sums['活动订单数']/sums['有效订单']*100:.1f} %  ⇒ 每一单都靠活动")
w()
w("  -- 逐日明细（单均到手 / 营销力度 / 投入产出比 / 有交易商品数）--")
w(f"    {'日期':<12}{'订单':>5}{'营业额':>10}{'到手':>10}{'单均到手':>10}"
  f"{'营销力度(含)':>13}{'投入产出比':>11}{'有交易商品':>11}{'库存不足':>9}")
for r in body:
    d = str(r[0])[:10]
    o = col(r, "有效订单") or 0
    inc = col(r, "收入") or 0
    rev = col(r, "营业额") or 0
    w(f"    {d:<12}{o:>5.0f}{rev:>10.2f}{inc:>10.2f}{(inc/o if o else 0):>10.2f}"
      f"{(col(r,'营销力度（含满减活动）') or 0):>13.4f}{(col(r,'投入产出比') or 0):>11.4f}"
      f"{(col(r,'有交易商品数') or 0):>11.0f}{(col(r,'库存不足商品数') or 0):>9.0f}")
w()
w("  -- 🔎 口径待定（本数据判不了，勿当结论）--")
# 投入产出比 反推基数
w(f"    {'日期':<12}{'投入产出比':>11}{'营业额/该比':>13}{'活动总补贴':>12}{'商家活动成本(含)':>17}")
for r in body:
    d = str(r[0])[:10]
    ip = col(r, "投入产出比") or 0
    rev = col(r, "营业额") or 0
    w(f"    {d:<12}{ip:>11.4f}{(rev/ip if ip else 0):>13.2f}"
      f"{(col(r,'活动总补贴') or 0):>12.2f}{(col(r,'商家活动成本（含满减活动）') or 0):>17.2f}")
w("    ⇒ 反推基数与「活动总补贴」「商家活动成本」均不等 ⇒ 投入产出比/营销力度 口径未定")
w()
wb.close()

# ---------------------------------------------------------------- 2 堂食菜品表
w("=" * 78)
w("2. 堂食菜品销售统计（美团收银 · 2026-09-07~09-13）")
w("=" * 78)
wb = load_workbook(F_DISH, data_only=True)
ws = wb["菜品销售统计"]
rs = rows_of(ws)
w(f"  维度 A1:O{len(rs)}；R3 一级表头 + R4 二级表头 ⇒ 数据自 R5 起")
data = []
tot_row = None
for r in rs[4:]:
    nm = r[0]
    if nm is None or str(nm).strip() == "":
        continue
    nm = str(nm).strip()
    if nm == "合计":
        tot_row = r
        continue
    data.append({
        "名称": nm,
        "销售数量": num(r[1]) or 0,
        "销售额": num(r[3]) or 0,
        "菜品收入": num(r[5]) or 0,
        "菜品优惠": num(r[7]) or 0,
    })
w(f"  菜品行数 = {len(data)}；合计行{'有' if tot_row else '无'}")
S_qty = sum(d["销售数量"] for d in data)
S_amt = sum(d["销售额"] for d in data)
S_inc = sum(d["菜品收入"] for d in data)
S_dis = sum(d["菜品优惠"] for d in data)
w(f"  我方聚合：数量 {S_qty:.1f} / 销售额 {S_amt:.2f} / 收入 {S_inc:.2f} / 优惠 {S_dis:.2f}")
if tot_row:
    w(f"  表内合计：数量 {num(tot_row[1])} / 销售额 {num(tot_row[3])} / 收入 {num(tot_row[5])} / 优惠 {num(tot_row[7])}")
w()
data.sort(key=lambda d: -d["销售额"])
w("  -- Top 15（按销售额）--")
w(f"    {'#':>3} {'菜品':<16}{'数量':>9}{'销售额':>11}{'收入':>11}{'优惠':>10}{'量占比':>8}{'额占比':>8}")
cum = 0.0
for i, d in enumerate(data[:15], 1):
    cum += d["销售额"]
    w(f"    {i:>3} {d['名称'][:16]:<16}{d['销售数量']:>9.1f}{d['销售额']:>11.2f}"
      f"{d['菜品收入']:>11.2f}{d['菜品优惠']:>10.2f}"
      f"{d['销售数量']/S_qty*100:>7.2f}%{d['销售额']/S_amt*100:>7.2f}%")
w()
# 帕累托
acc, n80, n90 = 0.0, None, None
for i, d in enumerate(data, 1):
    acc += d["销售额"]
    if n80 is None and acc >= S_amt * 0.8: n80 = i
    if n90 is None and acc >= S_amt * 0.9: n90 = i
w(f"  -- 集中度 --")
w(f"    前 {n80} 道菜（{n80/len(data)*100:.1f}% 的 SKU）贡献 80% 销售额")
w(f"    前 {n90} 道菜（{n90/len(data)*100:.1f}% 的 SKU）贡献 90% 销售额")
zero = [d for d in data if d["销售额"] <= 0]
w(f"    零销售额菜品 = {len(zero)} 道；销售额 < 100 元的菜品 = {len([d for d in data if d['销售额']<100])} 道")
w()
w("  -- 末 15 名（长尾）--")
for d in data[-15:]:
    w(f"      {d['名称'][:20]:<20}{d['销售数量']:>8.1f}{d['销售额']:>10.2f}{d['菜品优惠']:>10.2f}")
w()
w("  -- 优惠结构 --")
w(f"    有优惠的菜品 {len([d for d in data if d['菜品优惠']>0])} 道 / 共 {len(data)} 道")
w(f"    优惠总额 {S_dis:.2f} = 销售额的 {S_dis/S_amt*100:.2f}%")
top_dis = sorted(data, key=lambda d: -d["菜品优惠"])[:8]
w(f"    优惠额 Top8：")
for d in top_dis:
    w(f"      {d['名称'][:18]:<18} 优惠 {d['菜品优惠']:>9.2f}  销售额 {d['销售额']:>9.2f}"
      f"  优惠率 {d['菜品优惠']/d['销售额']*100 if d['销售额'] else 0:>6.2f}%")
w()
wb.close()

# ---------------------------------------------------------------- 3 套餐表
w("=" * 78)
w("3. 套餐销售统计 · 单品关联套餐销售明细")
w("=" * 78)
wb = load_workbook(F_COMBO, data_only=True)
ws = wb["单品关联套餐销售明细"]
rs = rows_of(ws)
hdr = rs[2]
w(f"  R2 口径声明：{str(rs[1][0]) if rs[1][0] else ''}")
w(f"  R3 表头：{[str(h) for h in hdr if h]}")
rows = []
for r in rs[3:]:
    if r[0] in (None, "") or r[2] in (None, ""):
        continue
    rows.append({
        "编码": r[0], "套餐": str(r[1] or "").strip(), "单品": str(r[2] or "").strip(),
        "大类": str(r[5] or "").strip(),
        "数量": num(r[6]) or 0, "销售额": num(r[7]) or 0,
        "优惠": num(r[8]) or 0, "收入": num(r[9]) or 0,
    })
w(f"  明细行 = {len(rows)}")
C_amt = sum(r["销售额"] for r in rows)
C_inc = sum(r["收入"] for r in rows)
C_dis = sum(r["优惠"] for r in rows)
w(f"  合计：销售额 {C_amt:.2f} / 收入 {C_inc:.2f} / 优惠 {C_dis:.2f}")
w()
from collections import defaultdict
g = defaultdict(lambda: {"n": 0, "qty": 0.0, "amt": 0.0, "inc": 0.0, "dis": 0.0})
for r in rows:
    k = r["套餐"]
    g[k]["n"] += 1
    for f in ("qty", "amt", "inc", "dis"):
        pass
    g[k]["qty"] += r["数量"]; g[k]["amt"] += r["销售额"]
    g[k]["inc"] += r["收入"]; g[k]["dis"] += r["优惠"]
w(f"  -- 套餐个数 = {len(g)}（按套餐名聚）--")
w(f"    {'套餐名':<46}{'明细行':>6}{'销售额':>10}{'收入':>10}{'优惠':>9}")
for k, v in sorted(g.items(), key=lambda kv: -kv[1]["amt"]):
    w(f"    {k[:46]:<46}{v['n']:>6}{v['amt']:>10.2f}{v['inc']:>10.2f}{v['dis']:>9.2f}")
w()
# 平台归属
pf = defaultdict(lambda: [0, 0.0, 0.0])
for r in rows:
    p = "美团" if r["套餐"].startswith("美团团购") else ("抖音" if r["套餐"].startswith("抖音团购") else "其他")
    pf[p][0] += r["数量"]; pf[p][1] += r["销售额"]; pf[p][2] += r["收入"]
w("  -- 按平台 --")
for p, v in sorted(pf.items(), key=lambda kv: -kv[1][1]):
    w(f"    {p:<6} 数量 {v[0]:>8.1f}  销售额 {v[1]:>10.2f}  收入 {v[2]:>10.2f}")
w()
# 单品聚合（团购套餐里的单品）
gi = defaultdict(lambda: [0.0, 0.0, 0.0])
for r in rows:
    gi[r["单品"]][0] += r["数量"]; gi[r["单品"]][1] += r["销售额"]; gi[r["单品"]][2] += r["收入"]
w(f"  -- 套餐内单品去重后 = {len(gi)} 种，Top 15（按销售额）--")
for k, v in sorted(gi.items(), key=lambda kv: -kv[1][1])[:15]:
    w(f"    {k[:20]:<20}{v[0]:>8.1f}{v[1]:>10.2f}{v[2]:>10.2f}")
w()
# 菜品大类分布（已知错配，仅列分布）
gc = defaultdict(lambda: [0.0, 0.0])
for r in rows:
    gc[r["大类"]][0] += r["销售额"]; gc[r["大类"]][1] += r["数量"]
w("  -- 表内「菜品大类」分布（⚠️ R226 已证该列错配，仅列分布）--")
for k, v in sorted(gc.items(), key=lambda kv: -kv[1][0]):
    w(f"    {k[:20]:<20} 销售额 {v[0]:>10.2f}  数量 {v[1]:>8.1f}")
w()
wb.close()

# ---------------------------------------------------------------- 4 交叉校验
w("=" * 78)
w("4. 交叉校验：套餐明细 vs 堂食菜品表（R226 结论复算）")
w("=" * 78)
wb = load_workbook(F_DISH, data_only=True)
dish_names = {}
for r in rows_of(wb["菜品销售统计"])[4:]:
    if r[0] is None or str(r[0]).strip() in ("", "合计"): continue
    dish_names[str(r[0]).strip()] = (num(r[1]) or 0, num(r[3]) or 0)
wb.close()
hit = [n for n in gi if n in dish_names]
w(f"  套餐内单品 {len(gi)} 种，命中堂食菜品表 {len(hit)} 种"
  f"（{len(hit)/len(gi)*100:.1f}%）")
w(f"  ⇒ {'✅ 证实：套餐构成已被并入菜品表，两张表不能相加' if len(hit)==len(gi) else '⚠️ 与 R226 结论不符，需复查'}")
w(f"     相加会虚增：{C_amt:.2f} 元 = 堂食销售额的 {C_amt/S_amt*100:.2f}%")
w()
w("=" * 78)
w("5. 合并口径（堂食 + 外卖，不含重复计）")
w("=" * 78)
w(f"  堂食（菜品口径）销售额   {S_amt:>10.2f}")
w(f"  外卖营业额               {base:>10.2f}")
w(f"  合计                     {S_amt+base:>10.2f}")
w(f"  外卖占比                 {base/(S_amt+base)*100:>10.2f} %")
w(f"  团购套餐（已含在堂食内） {C_amt:>10.2f}  = 堂食的 {C_amt/S_amt*100:.2f}%")
w()

# ---------------------------------------------------------------- 6 诊断摘要
w("=" * 78)
w("6. 诊断摘要（本轮新增，均现算）")
w("=" * 78)
od = sums["有效订单"]
w("  【外卖】")
w(f"    单均营业额 {base/od:.2f} 元 → 单均到手 {sums['收入']/od:.2f} 元"
  f"（每单被平台+活动拿走 {100-sums['收入']/base*100:.2f}%）")
w(f"    最大失血点：商家活动成本 {sums['商家活动成本（含满减活动）']:.2f} 元 = 营业额 "
  f"{sums['商家活动成本（含满减活动）']/base*100:.2f}%，占全部支出的 "
  f"{sums['商家活动成本（含满减活动）']/sums['支出']*100:.1f}%")
w(f"    流量：曝光 {sums['曝光人数']:.0f} → 进店 {sums['进店人数']:.0f}"
  f"（{sums['进店人数']/sums['曝光人数']*100:.2f}%）→ 下单 {od:.0f}"
  f"（{od/sums['进店人数']*100:.2f}% / 曝光→下单 {od/sums['曝光人数']*100:.2f}%）")
w(f"    活动订单占比 {sums['活动订单数']/od*100:.1f}% ⇒ 不投活动 = 没单")
w("  【堂食】")
w(f"    第 1 名「{data[0]['名称']}」占销售额 {data[0]['销售额']/S_amt*100:.2f}%、"
  f"占销量 {data[0]['销售数量']/S_qty*100:.2f}% ⇒ 单 SKU 依赖")
w(f"    帕累托：前 {n80} 道（{n80/len(data)*100:.1f}% SKU）才到 80%；"
  f"销售额 < 100 元的菜品 {len([d for d in data if d['销售额']<100])} 道"
  f"（{len([d for d in data if d['销售额']<100])/len(data)*100:.1f}%）")
banner = [d for d in data if d["名称"].startswith("耙牛肉")]
if banner:
    b = banner[0]
    w(f"    🔎 招牌菜「{b['名称']}」堂食 7 天 {b['销售数量']:.0f} 份 / {b['销售额']:.2f} 元"
      f" = 堂食销售额的 {b['销售额']/S_amt*100:.2f}%")
gi_banner = {k: v for k, v in gi.items() if k.startswith("耙牛肉")}
for k, v in gi_banner.items():
    w(f"       ↔ 但在团购套餐内 {k} = {v[1]:.2f} 元 = 套餐销售额的 {v[1]/C_amt*100:.2f}%")
w("  【团购】")
w(f"    {len(g)} 个套餐 / 销售额 {C_amt:.2f} 元 = 堂食的 {C_amt/S_amt*100:.2f}%")
for p, v in sorted(pf.items(), key=lambda kv: -kv[1][1]):
    w(f"      {p:<4} 销售额 {v[1]:>8.2f}（占团购 {v[1]/C_amt*100:>5.1f}%）收入 {v[2]:>8.2f}")
w("  【数据质量（可直接喂 M3.33 解析规范）】")
names = sorted(gi.keys())
w(f"    套餐内单品名共 {len(names)} 种：{ ' / '.join(names) }")
pairs = [("小料","自助小料"), ("联系吧员免费停","联系吧员免费停车")]
for a, b in pairs:
    if a in gi and b in gi:
        w(f"    ⚠️ 近似重复 SKU：「{a}」{gi[a][1]:.2f} 元 与 「{b}」{gi[b][1]:.2f} 元"
          f"（同一实物、两种写法，未归并 ⇒ 归并错会拆散单品口径）")
w("    ⚠️ 同规格套餐跨平台销售额差 2 倍（美团 4人餐 376.00 / 抖音 四人餐 188.00）")
w("      ⇒ 两平台「销售额」列口径不同，跨平台求和前必须先对齐")
w("    ⚠️ 堂食菜品表混入非菜品 SKU（鞋刷 / 抽纸 / 棒棒糖 / 碎冰冰 / 雪糕…）")
w("      ⇒ 食材成本率、菜品毛利口径会被污染，须加白名单过滤")
w()

txt = "\n".join(OUT)
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "r227_report.out.txt")
with io.open(dest, "w", encoding="utf-8") as f:
    f.write(txt + "\n")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
print(txt)
