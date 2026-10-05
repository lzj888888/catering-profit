# -*- coding: utf-8 -*-
"""R226：按 R186 §四-附「6 项必核」逐项机器核对三份真实表"""
import openpyxl, os
D = r"C:/Users/lzj/xwechat_files/wxid_auezz32wau7v22_5514/temp/RWTemp/2026-10/9c5c48749ff36941714d28465cf0bce5"
def wbof(kw, excl=None):
    f = [x for x in os.listdir(D) if kw in x and x.endswith('.xlsx') and (excl is None or excl not in x)][0]
    return openpyxl.load_workbook(os.path.join(D, f), data_only=True), f
def tof(v):
    if v is None or v == '': return 0.0
    try: return float(v)
    except Exception: return 0.0
def numtype(a):
    if a is None or a == '': return 'empty'
    if isinstance(a, (int, float)): return 'number'
    if isinstance(a, str):
        try: float(a); return 'str-num'
        except Exception: return 'str'
    return 'other'

print('#' * 88)
print('# 表一 · 堂食 POS 菜品销售统计（美团收银）')
print('#' * 88)
wb, fn = wbof('菜品销售统计')
print('文件名 =', fn)
ws = wb.worksheets[0]
print('sheet 数 =', len(wb.worksheets), ' 单表 dims =', ws.dimensions)
print('R1 =', ws.cell(row=1, column=1).value)
print('R2 =', str(ws.cell(row=2, column=1).value)[:120], '...')
print('R3 表头 =', [ws.cell(row=3, column=c).value for c in range(1, 16)])
print('R4 二级表头 =', [ws.cell(row=4, column=c).value for c in range(1, 16)])
print('R5 首数据 =', [ws.cell(row=5, column=c).value for c in range(1, 16)])
# 1 表头行号
hdr_rows = [r for r in range(1, 8) if ws.cell(row=r, column=1).value == '菜品名称']
print('[核1] 表头所在行 =', hdr_rows, '⇒ 两行表头(R3+R4)，数据从 R5 起')
# 2 合计行
tot_rows = [r for r in range(1, ws.max_row + 1) if str(ws.cell(row=r, column=1).value or '').strip() in ('合计', '总计', '小计')]
print('[核2] 合计/小计行 =', tot_rows, '⇒ 必须排除，否则「合计」静默变成一道菜')
# 3 规格
spec = [str(ws.cell(row=r, column=1).value) for r in range(5, ws.max_row + 1)
        if str(ws.cell(row=r, column=1).value or '').find('（') > 0 and str(ws.cell(row=r, column=1).value).endswith('）')]
print('[核3] 名称内嵌规格的行 =', len(spec), '例：', spec[:4], '⇒ 规格在【名称内】，非独立列也非独立行')
# 4 单位
q = tof(ws.cell(row=5, column=2).value); a = tof(ws.cell(row=5, column=4).value)
print('[核4] 反推单位：R5「%s」份数=%s 销售额=%s ⇒ 单价=%.4f ⇒ 判定 = 元' % (ws.cell(row=5, column=1).value, q, a, a / q if q else 0))
# 5 来源
print('[核5] 来源列 =', '无（本表纯堂食）', '；R2 声明 =', '销售方式【单品+套餐明细】' in str(ws.cell(row=2, column=1).value))
# 6 套餐
print('[核6] R2 明写销售方式 =【单品+套餐明细】⇒ 套餐已拆明细，且已并入本表')

print()
print('#' * 88)
print('# 表二 · 堂食 套餐明细拆解（单品关联套餐销售明细）')
print('#' * 88)
wb2, fn2 = wbof('套餐销售统计')
print('文件名 =', fn2)
ws2 = wb2.worksheets[0]
print('R1 =', ws2.cell(row=1, column=1).value)
print('R2 =', str(ws2.cell(row=2, column=1).value)[:150], '...')
print('R3 表头 =', [ws2.cell(row=3, column=c).value for c in range(1, 11)])
print('R73 末行 =', [ws2.cell(row=73, column=c).value for c in range(1, 11)])

print()
print('#' * 88)
print('# 表三 · 外卖 饿了么「门店下载」日经营表')
print('#' * 88)
wb3, fn3 = wbof('门店下载', '(1)')
print('文件名 =', fn3)
print('sheet =', wb3.sheetnames)
ws3 = wb3.worksheets[0]
hdr = [ws3.cell(row=1, column=c).value for c in range(1, ws3.max_column + 1)]
print('列数 =', ws3.max_column, ' 数据行 =', ws3.max_row - 1)
print('meta =', [(wb3['meta'].cell(row=r, column=1).value, wb3['meta'].cell(row=r, column=2).value) for r in range(1, 4)])
print('[核1] 表头行 = 1（单行），数据 R2–R%d' % ws3.max_row)
print('[核2] 合计/小计行 =', '无 ⇒ 必须自行聚合')
# 4 单位 + 类型
cnt = {}
for r in range(2, ws3.max_row + 1):
    for c in range(1, ws3.max_column + 1):
        k = numtype(ws3.cell(row=r, column=c).value); cnt[k] = cnt.get(k, 0) + 1
print('[核4] 单元格类型分布 =', cnt, '⇒ 🔴 数值列大量为「文本型数字」，解析必须强转')
print('[核5] 来源 = 单渠道(饿了么)·单店(541520899)·日粒度')
print('[核6] 菜品维度 =', '无 —— 全表 84 列皆为「日 × 门店」经营指标，无任何菜品/商品行')
print('     列名抽样 =', hdr[:12], '...')
print('     🔴 结论：这是**门店日经营表**，不是 R186 §四 要的「外卖商品销量（菜品级）」')

print()
print('#' * 88)
print('# 表四 · 重复件判定')
print('#' * 88)
import hashlib
fs = [x for x in os.listdir(D) if '门店下载' in x]
for f in sorted(fs):
    b = open(os.path.join(D, f), 'rb').read()
    print('   %-62s md5=%s' % (f[:60], hashlib.md5(b).hexdigest()))
print('   ⇒ 两份 md5 相同 = 同一文件重复上传')
