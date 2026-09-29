# -*- coding: utf-8 -*-
"""R178：比对 桌面上《微信支付账单.xlsx》与 之前 Downloads 哈希名文件 是否同一份。
判据：md5 / 订单号集合 / 商家应收款求和 / 交易类型分布 / 逐行差异
"""
import sys, os, io, hashlib, zipfile
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

FILES = {
    'A_Desktop_微信支付账单': r'C:\Users\lzj\Desktop\耙三样_耙牛肉2026-08-01_2026-08-31微信支付账单.xlsx',
    'B_Downloads_hash':      r'C:\Users\lzj\Downloads\09bbd01042244a1fa98e0d0f1963211b.xlsx',
}

def md5(p):
    h = hashlib.md5()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def size(p):
    return os.path.getsize(p)

try:
    import openpyxl
except ImportError:
    print('NO openpyxl')
    sys.exit(1)

print('=== 0. 文件指纹 ===')
for k, p in FILES.items():
    ok = os.path.exists(p)
    print(' %-24s exists=%s' % (k, ok))
    if ok:
        print('   size=%d  md5=%s' % (size(p), md5(p)))

print()
print('=== 1. 逐表结构 ===')
struct = {}
for k, p in FILES.items():
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    struct[k] = {}
    print('--- %s ---' % k)
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        struct[k][ws.title] = rows
        print('  %-10s rows=%d cols=%d' % (ws.title, len(rows), max((len(r) for r in rows), default=0)))
    wb.close()

print()
print('=== 2. 订单明细：表头是否一致 ===')
for k in FILES:
    rows = struct[k]['订单明细']
    hdr = rows[0]
    print(' %-24s ncol=%d' % (k, len(hdr)))
ha = struct['A_Desktop_微信支付账单']['订单明细'][0]
hb = struct['B_Downloads_hash']['订单明细'][0]
print(' 表头完全一致:', ha == hb)
if ha != hb:
    for i, (x, y) in enumerate(zip(ha, hb)):
        if x != y:
            print('   diff col %d: A=%r  B=%r' % (i + 1, x, y))
    if len(ha) != len(hb):
        print('   列数不同 %d vs %d' % (len(ha), len(hb)))

print()
print('=== 3. 订单明细：行级比对 ===')
ra = struct['A_Desktop_微信支付账单']['订单明细'][1:]
rb = struct['B_Downloads_hash']['订单明细'][1:]
print(' A 数据行=%d   B 数据行=%d' % (len(ra), len(rb)))

hdr = list(ha)
def colidx(name):
    for i, h in enumerate(hdr):
        if h and str(h).strip() == name:
            return i
    return None

i_oid = colidx('订单号')
i_type = colidx('交易类型')
i_net = colidx('商家应收款')
print(' 列定位: 订单号=%s 交易类型=%s 商家应收款=%s' % (i_oid, i_type, i_net))

def sig(rows):
    """行键 = 结算id+订单号+交易类型+交易描述（R177 定的行键）"""
    ic = colidx('结算id'); idesc = colidx('交易描述')
    out = {}
    for r in rows:
        key = tuple(str(r[i]) if i is not None and i < len(r) else '' for i in (ic, i_oid, i_type, idesc))
        out[key] = out.get(key, 0) + 1
    return out

sa, sb = sig(ra), sig(rb)
print(' A 唯一行键=%d   B 唯一行键=%d' % (len(sa), len(sb)))
only_a = set(sa) - set(sb)
only_b = set(sb) - set(sa)
print(' 只在 A 出现: %d' % len(only_a))
for k_ in list(only_a)[:10]:
    print('   A-only:', k_)
print(' 只在 B 出现: %d' % len(only_b))
for k_ in list(only_b)[:10]:
    print('   B-only:', k_)

def num(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).replace(',', '').replace('元', '').strip()
    if s in ('', '-', '--'): return 0.0
    try: return float(s)
    except Exception: return 0.0

suma = round(sum(num(r[i_net]) for r in ra if i_net is not None), 2)
sumb = round(sum(num(r[i_net]) for r in rb if i_net is not None), 2)
print(' 商家应收款求和: A=%s  B=%s  相等=%s' % (suma, sumb, suma == sumb))

print()
print('=== 4. 交易类型分布（R177 核心口径）===')
def typedist(rows):
    d = defaultdict(lambda: [0, 0.0])
    for r in rows:
        t = str(r[i_type]).strip() if i_type is not None and i_type < len(r) else ''
        d[t][0] += 1
        d[t][1] += num(r[i_net]) if i_net is not None else 0.0
    return d
da, db = typedist(ra), typedist(rb)
allt = sorted(set(da) | set(db))
print(' %-28s %-18s %-18s' % ('交易类型', 'A 行/金额', 'B 行/金额'))
for t in allt:
    a = da.get(t, [0, 0.0]); b = db.get(t, [0, 0.0])
    flag = '' if (a[0] == b[0] and round(a[1], 2) == round(b[1], 2)) else '   <-- DIFF'
    print(' %-28s %-18s %-18s%s' % (t, '%d / %.2f' % (a[0], a[1]), '%d / %.2f' % (b[0], b[1]), flag))

print()
print('=== 5. 汇总信息 ===')
for k in FILES:
    rows = struct[k]['汇总信息']
    print('--- %s (%d 行) ---' % (k, len(rows)))
    for r in rows:
        vals = [x for x in r if x not in (None, '')]
        if vals:
            print('   ', vals)

print()
print('=== 6. 逐格差异（定位 98 vs 97）===')
# 找 A 中 B 没有的行
if len(ra) >= len(rb):
    longer, shorter, lk, sk = ra, rb, 'A', 'B'
else:
    longer, shorter, lk, sk = rb, ra, 'B', 'A'
set_s = set(sig(shorter))
extra = []
for r in longer:
    ic = colidx('结算id'); idesc = colidx('交易描述')
    key = tuple(str(r[i]) if i is not None and i < len(r) else '' for i in (ic, i_oid, i_type, idesc))
    if key not in set_s:
        extra.append(r)
print(' %s 比 %s 多 %d 行（按行键）' % (lk, sk, len(extra)))
for r in extra[:5]:
    print('   订单号=%r 类型=%r 描述=%r 应收款=%r 状态=%r' % (
        r[i_oid] if i_oid is not None else None,
        r[i_type] if i_type is not None else None,
        r[colidx('交易描述')] if colidx('交易描述') is not None else None,
        r[i_net] if i_net is not None else None,
        r[colidx('订单状态')] if colidx('订单状态') is not None else None))

print()
print('=== 结论 ===')
same_md5 = md5(FILES['A_Desktop_微信支付账单']) == md5(FILES['B_Downloads_hash'])
print(' md5 相同:', same_md5)
print(' 行键集合相同:', set(sa) == set(sb), '(A=%d B=%d)' % (len(sa), len(sb)))
print(' 应收款总和相同:', suma == sumb)
