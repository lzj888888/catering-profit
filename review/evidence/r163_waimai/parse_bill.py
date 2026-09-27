# -*- coding: utf-8 -*-
"""
零依赖 xlsx 账单探列 / 对账脚本（R163 · 为明早美团外卖账单准备）
只用 Python 标准库（zipfile + xml.etree）——本机没有 openpyxl / pandas 也能跑。

用法：
  python parse_bill.py <xlsx路径>                 # 列出所有工作表 + 表头候选
  python parse_bill.py <xlsx路径> --sheet 1       # 打印第 1 个表（1-based）全部列名 + 每列求和 + 样例行
  python parse_bill.py <xlsx路径> --sheet 1 --rows 5
  python parse_bill.py <xlsx路径> --sheet 1 --json out.json

拿到列名后，把真实列名填进下面的 ALIASES（左边是我方口径固定键，右边是平台列名），
再跑一次就会自动做「逐行 + 汇总」等式校验（到手 = 优惠前 − 商家补贴 − 佣金 − 配送费 − 其他）。
"""
import io, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

# ===== 别名表：拿到美团真实列名后填这里（支持多个候选名，按顺序匹配）=====
# 左 = 我方口径固定键（不要改）；右 = 平台账单里的列名候选
ALIASES = {
    'order_id':      ['订单号', '订单编号', '订单ID'],
    'biz_type':      ['业务类型', '订单类型', '业务线'],
    'bill_date':     ['账单日期', '下单日期', '订单完成时间', '结算日期'],
    'gross':         ['优惠前总额', '商品金额', '订单金额', '优惠前金额', '原价金额'],
    'pack':          ['打包费', '餐盒费'],
    'subsidy_m':     ['商家活动补贴', '商家承担活动补贴', '商家活动成本', '商家优惠金额'],
    'subsidy_vouch': ['商家代金券补贴', '商家承担代金券', '商家券补贴'],
    'subsidy_deliv': ['商家配送费活动补贴', '商家承担配送费活动', '商家配送活动补贴'],
    'commission':    ['佣金', '技术服务费', '平台服务费', '佣金金额'],
    'delivery_fee':  ['配送服务费', '履约服务费', '配送费', '物流服务费'],
    'other_fee':     ['其他支出', '其他费用', '其他扣款', '杂项'],
    'net':           ['结算金额', '商家到手', '商家实收', '应结算金额', '到手金额'],
    'qty':           ['有效订单', '有效订单数', '订单数'],
}

MONEY_KEYS = ['gross', 'pack', 'subsidy_m', 'subsidy_vouch', 'subsidy_deliv',
              'commission', 'delivery_fee', 'other_fee', 'net']


def col_idx(ref):
    """'AB12' -> 27（1-based 列号）"""
    m = re.match(r'([A-Z]+)', ref or '')
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n


def load(path):
    """返回 [(sheet_name, [[cell,...], ...]), ...]"""
    z = zipfile.ZipFile(path)
    names = z.namelist()

    shared = []
    if 'xl/sharedStrings.xml' in names:
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))

    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {}
    if 'xl/_rels/workbook.xml.rels' in names:
        rr = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        for rel in rr:
            rels[rel.get('Id')] = rel.get('Target')

    out = []
    for sh in wb.find(NS + 'sheets'):
        name = sh.get('name')
        rid = sh.get(RNS + 'id')
        tgt = rels.get(rid, '')
        if tgt.startswith('/'):
            tgt = tgt[1:]
        elif not tgt.startswith('xl/'):
            tgt = 'xl/' + tgt
        if tgt not in names:
            out.append((name, []))
            continue
        sroot = ET.fromstring(z.read(tgt))
        rows = []
        for row in sroot.iter(NS + 'row'):
            cells = {}
            for c in row.findall(NS + 'c'):
                i = col_idx(c.get('r'))
                t = c.get('t')
                v = c.find(NS + 'v')
                isn = c.find(NS + 'is')
                if t == 's' and v is not None:
                    val = shared[int(v.text)] if v.text and int(v.text) < len(shared) else ''
                elif t == 'inlineStr' and isn is not None:
                    val = ''.join(x.text or '' for x in isn.iter(NS + 't'))
                elif v is not None:
                    val = v.text
                else:
                    val = ''
                if val is not None and str(val).strip() != '':
                    cells[i] = str(val).strip()
            rows.append(cells)
        out.append((name, rows))
    return out


def to_num(s):
    if s is None:
        return None
    s = str(s).replace(',', '').replace('¥', '').replace('￥', '').strip()
    if s in ('', '-', '--'):
        return None
    neg = s.startswith('(') and s.endswith(')')
    if neg:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def flat(rows, width):
    """稀疏 dict 行 -> 定宽列表"""
    return [[r.get(i, '') for i in range(1, width + 1)] for r in rows]


def width_of(rows):
    return max([max(r.keys()) if r else 0 for r in rows] or [0])


def guess_header(rows):
    """表头行 = 前 5 行里「非空文本格最多」的那一行"""
    best, bi = -1, 0
    for i, r in enumerate(rows[:5]):
        txt = sum(1 for k, v in r.items() if v and to_num(v) is None)
        if txt > best:
            best, bi = txt, i
    return bi


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 2
    path = argv[0]
    if not os.path.exists(path):
        print('文件不存在：' + path)
        return 2
    sheet = None
    nrows = 3
    jout = None
    for i, a in enumerate(argv[1:]):
        if a == '--sheet':
            sheet = int(argv[2 + i])
        elif a == '--rows':
            nrows = int(argv[2 + i])
        elif a == '--json':
            jout = argv[2 + i]

    sheets = load(path)
    print('文件：%s' % path)
    print('工作表 %d 个：' % len(sheets))
    for i, (nm, rows) in enumerate(sheets, 1):
        print('  [%d] %-28s 行数=%d 列数=%d' % (i, nm, len(rows), width_of(rows)))

    if sheet is None:
        # 概览模式：每个表都打表头候选
        for i, (nm, rows) in enumerate(sheets, 1):
            if not rows:
                continue
            w = width_of(rows)
            hi = guess_header(rows)
            hdr = [rows[hi].get(c, '') for c in range(1, w + 1)]
            print('\n===== [%d] %s =====' % (i, nm))
            print('表头行 = 第 %d 行；列名（列号:名）：' % (hi + 1))
            for c in range(1, w + 1):
                if hdr[c - 1]:
                    print('   %3d  %s' % (c, hdr[c - 1]))
        print('\n提示：用 --sheet N 看某个表的样例行与每列求和。')
        return 0

    nm, rows = sheets[sheet - 1]
    if not rows:
        print('该表为空')
        return 0
    w = width_of(rows)
    hi = guess_header(rows)
    hdr = [rows[hi].get(c, '') for c in range(1, w + 1)]
    body = rows[hi + 1:]
    print('\n===== 表 [%d] %s =====  数据行 %d（表头第 %d 行）' % (sheet, nm, len(body), hi + 1))

    print('\n--- 列名 + 每列求和（仅数值列有值）---')
    sums = {}
    for c in range(1, w + 1):
        vals = [to_num(r.get(c)) for r in body]
        vals = [v for v in vals if v is not None]
        sums[c] = round(sum(vals), 2) if vals else None
        print('  %3d  %-30s %s' % (c, hdr[c - 1] or '(无表头)', ('Σ=%s' % sums[c]) if vals else ''))

    print('\n--- 前 %d 行样例 ---' % nrows)
    for r in body[:nrows]:
        print('  ' + ' | '.join((r.get(c, '')[:16]) for c in range(1, w + 1)))

    # ===== 别名映射 =====
    colmap = {}
    for key, cands in ALIASES.items():
        for cand in cands:
            for c in range(1, w + 1):
                if (hdr[c - 1] or '').strip() == cand:
                    colmap[key] = c
                    break
            if key in colmap:
                break
    print('\n--- 别名映射结果（命中 %d / %d）---' % (len(colmap), len(ALIASES)))
    for k in ALIASES:
        print('  %-14s -> %s' % (k, ('列%d「%s」' % (colmap[k], hdr[colmap[k] - 1])) if k in colmap else '❌ 未命中'))

    # ===== 等式校验（需要核心列齐备）=====
    # ⚠ R163 实测（淘宝闪购 156 行）：**打包费是加项、不是减项**。
    #   到手 = 商品金额 + 打包费 − 商家补贴 − 佣金 − 配送服务费 − 其他
    #   若 gross 已是「优惠前总额」(含打包费)，再打包费会双加 ⇒ 两种口径都算，让数据自己说话。
    need = ['gross', 'net']
    if all(k in colmap for k in need):
        print('\n--- 等式校验（两种口径都算：打包费作为加项 / 不加）---')
        tot = {k: 0.0 for k in MONEY_KEYS}
        # ---- 第 1 遍：探测平台「符号约定」----
        # 淘宝：扣减列本身记负数（−791.68）⇒ 直接相加；美团可能记正数 ⇒ 需相减。
        # 判据：取 gross>0 的正常行，看补贴列多数为负 ⇒ factor=+1（原样加），否则 factor=−1（相减）。
        probe_keys = [k for k in ['subsidy_m', 'subsidy_vouch', 'subsidy_deliv',
                                  'commission', 'delivery_fee', 'other_fee'] if k in colmap]
        neg = pos = 0
        for r in body:
            g = to_num(r.get(colmap['gross']))
            if g is None or g <= 0:
                continue  # 退单行符号天然相反，不参与探测
            for k in probe_keys:
                v = to_num(r.get(colmap[k]))
                if v is None or v == 0:
                    continue
                if v < 0:
                    neg += 1
                else:
                    pos += 1
        factor = 1 if neg >= pos else -1
        print('  符号约定探测：正常行里扣减列 负%d / 正%d ⇒ 用 %s（%s）'
              % (neg, pos, '原样相加' if factor == 1 else '取反相减',
                 '平台记负数' if factor == 1 else '平台记正数'))

        def raw(k, r):
            return to_num(r.get(colmap[k])) if k in colmap else None

        bad_p, bad_n = [], []
        checked = 0
        sum_with, sum_no = 0.0, 0.0
        for ri, r in enumerate(body, hi + 2):
            gross = to_num(r.get(colmap['gross']))
            net = to_num(r.get(colmap['net']))
            if gross is None and net is None:
                continue
            sub_r = sum(raw(k, r) or 0 for k in ['subsidy_m', 'subsidy_vouch', 'subsidy_deliv'])
            com_r = raw('commission', r) or 0
            dlv_r = raw('delivery_fee', r) or 0
            oth_r = raw('other_fee', r) or 0
            pk_r = raw('pack', r) or 0
            sub, com, dlv, oth = (factor * v for v in (sub_r, com_r, dlv_r, oth_r))
            c_with = round((gross or 0) + pk_r + sub + com + dlv + oth, 2)
            c_no = round((gross or 0) + sub + com + dlv + oth, 2)
            sum_with += c_with
            sum_no += c_no
            checked += 1
            for k in MONEY_KEYS:
                v = raw(k, r)
                if v is not None:
                    tot[k] += v
            if net is not None:
                if abs(c_with - net) > 0.01:
                    bad_p.append((ri, gross, pk_r, round(sub, 2), round(com, 2),
                                  round(dlv, 2), round(oth, 2), c_with, net))
                if abs(c_no - net) > 0.01:
                    bad_n.append((ri, gross, pk_r, round(sub, 2), round(com, 2),
                                  round(dlv, 2), round(oth, 2), c_no, net))
        has_pack = 'pack' in colmap
        print('  已核 %d 行' % checked)
        if has_pack:
            print('  口径A（打包费作加项）：不符 %d 行 %s' % (len(bad_p), '✔ 吻合' if not bad_p else ''))
        print('  口径B（不加打包费）  ：不符 %d 行 %s' % (len(bad_n), '✔ 吻合' if not bad_n else ''))
        if has_pack and len(bad_p) != len(bad_n):
            win = 'A（gross 不含打包费，打包费单列加回）' if len(bad_p) < len(bad_n) else 'B（gross 已含打包费）'
            print('  ⇒ 该账单口径判为：%s' % win)
        print('  合计：优惠前 %s / 打包费 %s / 商家补贴 %s / 佣金 %s / 配送费 %s / 其他 %s / 到手 %s'
              % (round(tot['gross'], 2), round(tot['pack'], 2),
                 round(sum(tot[k] for k in ['subsidy_m', 'subsidy_vouch', 'subsidy_deliv']), 2),
                 round(tot['commission'], 2), round(tot['delivery_fee'], 2),
                 round(tot['other_fee'], 2), round(tot['net'], 2)))
        print('  加总校验：口径A 算得 %s / 口径B 算得 %s / 实际到手 %s'
              % (round(sum_with, 2), round(sum_no, 2), round(tot['net'], 2)))
        show = bad_p if (has_pack and len(bad_p) <= len(bad_n)) else bad_n
        for b in show[:10]:
            print('    ⚠ 第%d行 优惠前%s +打包%s −补贴%s −佣金%s −配送%s −其他%s = %s ≠ 到手%s' % b)
        if len(show) > 10:
            print('    … 另有 %d 行' % (len(show) - 10))
    else:
        print('\n（缺 %s 列 ⇒ 跳过等式校验；把真实列名填进脚本顶部 ALIASES 后再跑）'
              % '/'.join(k for k in need if k not in colmap))

    if jout:
        data = {'file': path, 'sheet': nm, 'header': hdr, 'sums': sums,
                'colmap': colmap, 'rows': len(body),
                'totals': {k: round(v, 2) for k, v in tot.items()}}
        io.open(jout, 'w', encoding='utf-8', newline='').write(
            json.dumps(data, ensure_ascii=False, indent=2))
        print('\n已写出：' + jout)
    return 0


if __name__ == '__main__':
    sys.exit(main())
