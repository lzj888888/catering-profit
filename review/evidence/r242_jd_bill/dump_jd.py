# review/evidence/r242_jd_bill/dump_jd.py —— 零依赖 xlsx 行/列 dump（京东对账单取证用）
# 只用 stdlib（zipfile + xml），绕开 openpyxl read_only 少读的坑。
import sys, zipfile, re
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def col_idx(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    if not m: return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n

def load(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            txt = ''.join(t.text or '' for t in si.iter(NS + 't'))
            shared.append(txt)
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = []
    for r in sheet.iter(NS + 'row'):
        cells = {}
        for c in r.findall(NS + 'c'):
            v = c.find(NS + 'v')
            raw = v.text if v is not None else None
            t = c.get('t')
            if t == 's' and raw is not None:
                val = shared[int(raw)] if int(raw) < len(shared) else ''
            elif t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter(NS + 't'))
            else:
                val = raw
            cells[col_idx(c.get('r'))] = val
        n = max(cells) if cells else 0
        rows.append([cells.get(i + 1) for i in range(n)])
    return rows

if __name__ == '__main__':
    p = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    rows = load(p)
    print('总行数 =', len(rows), '| 最大列数 =', max(len(r) for r in rows))
    w = max(len(r) for r in rows[:3])
    print('\n--- 表头两级（列号: R1 | R2）---')
    for i in range(w):
        a = rows[0][i] if i < len(rows[0]) else None
        b = rows[1][i] if i < len(rows[1]) else None
        print('  %2d  %-22s | %s' % (i + 1, a, b))
    print('\n--- 前 %d 条数据行（R3 起）---' % n)
    for k in range(2, min(2 + n, len(rows))):
        print('  [第%d行] %s' % (k + 1, rows[k]))
    print('\n--- 末 3 行 ---')
    for k in range(max(0, len(rows) - 3), len(rows)):
        print('  [第%d行] %s' % (k + 1, rows[k]))
