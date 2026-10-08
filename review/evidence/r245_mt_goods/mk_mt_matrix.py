# -*- coding: utf-8 -*-
# R245 · 美团「商品」销量表 → 机器可读矩阵 + 独立复算锚点
#
# 【来源与证据分级（必须写清，别把合成/转码当真值）】
#   原始文件 ：review/evidence/r242_mt_goods/mt_goods_20260907_20260913.csv（GBK，md5 347fc8ea…）
#   本脚本读 ：review/evidence/r242_mt_goods/_v2_utf8_bom.csv（**同一份数据的 UTF-8+BOM 转码副本**）
#   🔴 为什么要转码：云端 xlsx 读无 BOM 的 CSV 走单字节路径 ⇒ GBK 中文全毁，这是**上传侧/编码**问题，
#      不属本批《平台档案化 v2》P7（列名别名）/P8（紧凑日期）范围，方案已明载不在此层解决。
#      ⇒ 本矩阵只用于验证**列名与日期**两道判据，不证明编码链路。
#   ✅ 业务数值：逐字来自真文件（转码不改数字），锚点由本脚本**独立复算**（不采信任何工具自报口径）。
import json, os, io, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'r242_mt_goods', '_v2_utf8_bom.csv')

with io.open(SRC, 'r', encoding='utf-8-sig') as f:
    lines = [l.rstrip('\r\n') for l in f if l.strip('\r\n') != '']
rows = [l.split(',') for l in lines]
header = rows[0]
data = rows[1:]

# ---------- 独立复算（手算口径，不从被测模块读回）----------
def num(s):
    s = (s or '').strip()
    if s in ('', '-', '--'):
        return None
    return float(s)

iDate = header.index('日期')
iName = header.index('商品名')
iQty = header.index('商品销量')
iSales = header.index('商品销售额')
iQr = header.index('销量占比')
iSr = header.index('销售额占比')

total_qty = 0
total_sales = 0.0
per_day = collections.OrderedDict()
per_day_ratio = collections.OrderedDict()
names = []
zero_rows = []
for r in data:
    d, nm = r[iDate], r[iName]
    q = int(num(r[iQty]) or 0)
    s = num(r[iSales]) or 0.0
    total_qty += q
    total_sales += s
    per_day.setdefault(d, {'qty': 0, 'sales': 0.0})
    per_day[d]['qty'] += q
    per_day[d]['sales'] += s
    per_day_ratio.setdefault(d, {'qr': 0.0, 'sr': 0.0})
    per_day_ratio[d]['qr'] += num(r[iQr]) or 0.0
    per_day_ratio[d]['sr'] += num(r[iSr]) or 0.0
    if nm not in names:
        names.append(nm)
    if s == 0.0 and q > 0:
        zero_rows.append((d, nm, q))

out = []
out.append('R245 · 美团「商品」销量表 独立复算锚点（来源：真文件 UTF-8 转码副本；编码链路不在本批范围）')
out.append('文件        : %s' % os.path.relpath(SRC, HERE))
out.append('结构        : %d 行（1 表头 + %d 数据）× %d 列' % (len(rows), len(data), len(header)))
out.append('列          : %s' % ','.join(header))
out.append('')
out.append('[锚点] Σ销量            = %d' % total_qty)
out.append('[锚点] Σ商品销售额      = %.2f 元（=%d 分）' % (total_sales, round(total_sales * 100)))
out.append('[锚点] 覆盖天数         = %d（%s）' % (len(per_day), ' / '.join(sorted(per_day))))
out.append('[锚点] 去重商品数       = %d' % len(names))
for d in sorted(per_day):
    out.append('         %s：Σ销量 %d · Σ销售额 %.2f' % (d, per_day[d]['qty'], per_day[d]['sales']))
out.append('')
out.append('[交叉校验] 每日占比和（应≈1.0，误差 ≤0.001 属源端四舍五入）')
for d in sorted(per_day_ratio):
    qr = per_day_ratio[d]['qr']
    sr = per_day_ratio[d]['sr']
    out.append('         %s：销量占比 %.4f · 销售额占比 %.4f  |Δ|=%s/%s'
               % (d, qr, sr, 'ok' if abs(qr - 1) <= 0.001 else 'BAD',
                  'ok' if abs(sr - 1) <= 0.001 else 'BAD'))
out.append('')
out.append('[零元行] amount=0 且 qty>0（v1.7 C-5 应单列，按名聚合）')
for d, nm, q in zero_rows:
    out.append('         %s  %s  qty=%d' % (d, nm, q))
agg = collections.OrderedDict()
for d, nm, q in zero_rows:
    agg[nm] = agg.get(nm, 0) + q
for nm in agg:
    out.append('[锚点] 零元聚合：%s qty=%d' % (nm, agg[nm]))
out.append('')
out.append('[锚点] 紧凑日期样例      = %s（normalizeDate 应得 %s-%s-%s）'
           % (data[0][iDate], data[0][iDate][0:4], data[0][iDate][4:6], data[0][iDate][6:8]))

txt = '\n'.join(out) + '\n'
with io.open(os.path.join(HERE, 'recalc_anchors.out.txt'), 'w', encoding='utf-8') as f:
    f.write(txt)
with io.open(os.path.join(HERE, 'mt_goods_matrix.json'), 'w', encoding='utf-8') as f:
    f.write(json.dumps({'header': header, 'rows': rows}, ensure_ascii=False, indent=1))
print(txt)
print('[written] mt_goods_matrix.json (%d 行 × %d 列)' % (len(rows), len(header)))
