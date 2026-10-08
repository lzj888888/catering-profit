# review/evidence/r242_jd_bill/jd_analyze.py —— 京东「对账单下载」逐行勾稽（零依赖，复用 dump_jd 读表）
# 产出：分组统计 + 逐行等式检验 + 锚点合计。
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dump_jd import load

C = {  # 列号(1-based) → 名（取 R2 二级表头，已实测）
    '应结金额': 24, '订单原价': 25, '餐盒费': 26, '包装费': 27, '商家自送配送费': 28,
    '平台运费补贴': 29, '商家承担货款补贴': 30, '商家承担运费补贴': 31,
    '总服务费': 32, '配送费开票': 33, '商家承担小费': 34, '基础服务费': 35, '平台补贴暂扣': 36,
    '用户支付货款': 37, '总补贴': 41, '平台总补贴': 42, '平台货款补贴': 43,
    '商家承担补贴': 46, '开票金额': 55,
    '订单类型': 8, '订单渠道': 7, '主订单号': 14, '结算单号': 71, '结算周期': 72,
    '下单时间': 11, '预计付款日期': 78, '结算单状态': 79, '账期': 70,
}
INCOME = ['订单原价', '餐盒费', '包装费', '商家自送配送费', '平台运费补贴']
EXPENSE = ['商家承担货款补贴', '商家承担运费补贴', '总服务费', '配送费开票', '商家承担小费', '基础服务费', '平台补贴暂扣']


def num(v):
    if v is None or v == '':
        return 0.0
    try:
        return float(str(v).replace(',', ''))
    except ValueError:
        return 0.0


def cell(row, name):
    i = C[name] - 1
    return row[i] if i < len(row) else None


def main():
    rows = load(sys.argv[1])
    data = rows[2:]                       # R1 一级表头 / R2 二级表头 / R3 起数据
    print('数据行数 =', len(data), '（总行 %d − 2 行表头）' % len(rows))

    # ---- 1 按订单类型分组 ----
    g = collections.defaultdict(lambda: {'n': 0, '应结': 0.0, '原价': 0.0})
    for r in data:
        t = cell(r, '订单类型')
        g[t]['n'] += 1
        g[t]['应结'] += num(cell(r, '应结金额'))
        g[t]['原价'] += num(cell(r, '订单原价'))
    print('\n=== 按「订单类型」分组（列8）===')
    for t, v in sorted(g.items(), key=lambda x: -x[1]['n']):
        print('  %-14s 行=%-4d Σ应结=%10.2f  Σ订单原价=%10.2f' % (t, v['n'], v['应结'], v['原价']))
    print('  %-14s 行=%-4d Σ应结=%10.2f  Σ订单原价=%10.2f' % ('【全表】', len(data),
          sum(v['应结'] for v in g.values()), sum(v['原价'] for v in g.values())))

    # ---- 2 逐行等式：应结 = Σ营业收入 + Σ支出 ----
    bad = []
    for k, r in enumerate(data):
        lhs = num(cell(r, '应结金额'))
        rhs = sum(num(cell(r, n)) for n in INCOME) + sum(num(cell(r, n)) for n in EXPENSE)
        if abs(lhs - rhs) > 0.005:
            bad.append((k + 3, cell(r, '订单类型'), lhs, round(rhs, 2)))
    print('\n=== 逐行等式：应结金额 == Σ(营业收入) + Σ(支出) ===')
    print('  检验行数 = %d · 不成立 = %d' % (len(data), len(bad)))
    for b in bad[:10]:
        print('    第%d行 %s 应结=%s 右式=%s' % b)

    # ---- 3 订单号是否重复（行键判据）----
    no = [str(cell(r, '主订单号')) for r in data]
    dup = [k for k, v in collections.Counter(no).items() if v > 1]
    print('\n=== 主订单号重复情况 ===')
    print('  唯一订单号 = %d / 总行 %d · 重复订单号 = %d 个' % (len(set(no)), len(no), len(dup)))
    for d in dup[:3]:
        sub = [r for r in data if str(cell(r, '主订单号')) == d]
        print('    %s → %d 行，类型=%s' % (d, len(sub), [cell(x, '订单类型') for x in sub]))

    # ---- 4 账期 / 结算 ----
    print('\n=== 账期与结算 ===')
    print('  结算单号 =', sorted(set(str(cell(r, '结算单号')) for r in data)))
    print('  账期 =', sorted(set(str(cell(r, '账期')) for r in data))[:3], '...共',
          len(set(str(cell(r, '账期')) for r in data)), '个')
    print('  结算周期 =', sorted(set(str(cell(r, '结算周期')) for r in data)))
    print('  预计付款日期 =', sorted(set(str(cell(r, '预计付款日期')) for r in data))[:4])
    print('  结算单状态 =', sorted(set(str(cell(r, '结算单状态')) for r in data)))
    t = sorted(set(str(cell(r, '下单时间'))[:10] for r in data))
    print('  下单日期范围 =', t[0], '~', t[-1])


if __name__ == '__main__':
    main()
