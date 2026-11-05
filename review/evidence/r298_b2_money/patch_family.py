# -*- coding: utf-8 -*-
"""R298 · B2 补漏：同族「元→分 / 元→2位小数」裸换算 → 十进制安全形态。

两阶段写入纪律：
  阶段 1  对每个锚点在**内存**里断言命中次数 == 1（含替换后的连锁影响），任一失败 ⇒ 拒绝落盘。
  阶段 2  全部通过后才统一写回；写回**一律纯 LF**（本仓 3 个文件存在「工作树 CRLF / index LF」
          行尾漂移 + git status 假报干净，写 LF 既消隐患又得最小 diff）。

用法：
  python review/evidence/r298_b2_money/patch_family.py --dry     # 只校验不写
  python review/evidence/r298_b2_money/patch_family.py           # 校验并写
"""
import hashlib
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

SAFE = 'Math.round(Number(({X} * 100).toFixed(10)))'
SAFE_R2 = 'Math.round(Number(({X} * 100).toFixed(10))) / 100'

EDITS = [
    # ---------------- A. 元 → 整数分（yuan2fen）----------------
    ('cloudfunctions/calcBom/selftest.js',
     'Math.round(lineNetCostYuan(l.quantity, l.net_unit_cost) * 100)',
     SAFE.format(X='lineNetCostYuan(l.quantity, l.net_unit_cost)'),
     'yuan2fen', 'R38 变异回验的「逐行 round」错式；832.5 为精确值，改安全形态不改变 2499 的结论'),

    ('cloudfunctions/importSalesBill/service.js',
     'orders.push({ bizDate, qty, amountFen: Math.round(net * 100) });',
     'orders.push({ bizDate, qty, amountFen: ' + SAFE.format(X='net') + ' });',
     'yuan2fen', '平台账单「结算金额」元→分落库 amount_fen'),

    ('cloudfunctions/importSalesBill/service.js',
     'const amountFen = Math.round((income == null ? 0 : income) * 100);',
     'const amountFen = ' + SAFE.format(X='(income == null ? 0 : income)') + ';',
     'yuan2fen', '形态 C 收入元→分落库 external_sales_daily.amount_fen'),

    ('cloudfunctions/importSalesBill/service.js',
     'const salesFen = Math.round((sales == null ? 0 : sales) * 100);',
     'const salesFen = ' + SAFE.format(X='(sales == null ? 0 : sales)') + ';',
     'yuan2fen', '形态 C 销售额元→分'),

    ('cloudfunctions/importSalesBill/service.js',
     'const discountFen = Math.round((discount == null ? 0 : discount) * 100);',
     'const discountFen = ' + SAFE.format(X='(discount == null ? 0 : discount)') + ';',
     'yuan2fen', '形态 C 优惠额元→分'),

    ('cloudfunctions/importSalesBill/service.js',
     'const amountFen = Math.round((sales == null ? 0 : sales) * 100);',
     'const amountFen = ' + SAFE.format(X='(sales == null ? 0 : sales)') + ';',
     'yuan2fen', '美团销量表 amount_fen = 销售额 × 100（v1.7 C-3）'),

    ('pages/card/edit.js',
     'promoFen: Math.round((Number(this.data.grouponPromoYuan) || 0) * 100),',
     'promoFen: ' + SAFE.format(X='(Number(this.data.grouponPromoYuan) || 0)') + ',',
     'yuan2fen', '团购优惠 元→分（老板手输，可带三位小数 ⇒ 真风险）'),

    ('pages/card/edit.js',
     'dineFen: Math.round((Number(this.data.priceYuan) || 0) * 100),',
     'dineFen: ' + SAFE.format(X='(Number(this.data.priceYuan) || 0)') + ',',
     'yuan2fen', '堂食价 元→分（老板手输）'),

    ('pages/card/edit.js',
     'const priceFen = Math.round((Number(this.data.priceYuan) || 0) * 100);',
     'const priceFen = ' + SAFE.format(X='(Number(this.data.priceYuan) || 0)') + ';',
     'yuan2fen', '售价低于成本预警用 元→分（老板手输）'),

    ('pages/material/edit.js',
     'const purchasePriceFen = Math.round((Number(this.data.priceYuan) || 0) * 100);',
     'const purchasePriceFen = ' + SAFE.format(X='(Number(this.data.priceYuan) || 0)') + ';',
     'yuan2fen', '原料采购价 元→分（老板手输）'),

    ('pages/sandbox/matrix.js',
     'const rentFen = meta.rent * 100;',
     'const rentFen = ' + SAFE.format(X='meta.rent') + ';   // R298-B2：原式**连取整都没有** ⇒ 分不是整数，违约铁律',
     'yuan2fen', '房租 元→分；原式裸乘 ⇒ 落为非整数分（真缺陷）'),

    ('pages/takeaway/index.js',
     'const fen = (v) => Math.round((Number(v) || 0) * 100);',
     'const fen = (v) => ' + SAFE.format(X='(Number(v) || 0)') + ';',
     'yuan2fen', '外卖组装订单 元→分（老板手输打包费等）'),

    ('pages/takeaway/index.js',
     'target_profit_fen: Math.round((Number(this.data.targetProfitYuan) || 0) * 100),',
     'target_profit_fen: ' + SAFE.format(X='(Number(this.data.targetProfitYuan) || 0)') + ',',
     'yuan2fen', '目标利润 元→分（老板手输）'),

    ('utils/billParse.js',
     'orders.push({ bizDate, qty, amountFen: Math.round(net * 100) });',
     'orders.push({ bizDate, qty, amountFen: ' + SAFE.format(X='net') + ' });',
     'yuan2fen', '账单解析「结算金额」元→分（与 importSalesBill 同源重复实现）'),

    ('utils/bizPreset.js',
     'return Number.isFinite(n) ? Math.round(n * 100) : 0;',
     'return Number.isFinite(n) ? ' + SAFE.format(X='n') + ' : 0;',
     'yuan2fen', 'fenOf()：前端第 3 份「元→分」实现（单源收敛待判）'),

    ('utils/materialBatch.js',
     'else priceFen = Math.round(Number(p.priceYuan) * 100);',
     'else priceFen = ' + SAFE.format(X='Number(p.priceYuan)') + ';',
     'yuan2fen', '批量导原料单价 元→分（Excel 导入，可带三位小数 ⇒ 真风险）'),

    # ---------------- B. 元 → 2 位小数（yuan_round2）----------------
    ('utils/dineChannels.js',
     'return c.n === 1 ? c.raw : (Math.round(c.sum * 100) / 100).toFixed(2);',
     'return c.n === 1 ? c.raw : (' + SAFE_R2.format(X='c.sum') + ').toFixed(2);',
     'yuan_round2', '多行渠道金额求和后归一到 2 位小数（元语义）'),

    ('utils/takeaway.js',
     'const diff = Math.round((actual - expected) * 100) / 100;',
     'const diff = ' + SAFE_R2.format(X='(actual - expected)') + ';',
     'yuan_round2', '外卖对账差额（元）归一到 2 位小数'),

    ('utils/takeaway.js',
     'const packTotal = Math.round((Number(p && p.packTotal) || 0) * 100) / 100;',
     'const packTotal = ' + SAFE_R2.format(X='(Number(p && p.packTotal) || 0)') + ';',
     'yuan_round2', '打包费合计（元）归一到 2 位小数'),
]


def read_norm(p):
    """读工作树文件并按 LF 归一（只改行尾，不动内容）。"""
    raw = io.open(p, 'rb').read()
    txt = raw.decode('utf-8')
    return txt.replace('\r\n', '\n'), raw


def main():
    dry = '--dry' in sys.argv
    # ---------- 阶段 1：内存全量校验 ----------
    problems = []
    buffers = {}
    for i, (rel, anchor, repl, kind, why) in enumerate(EDITS, 1):
        p = os.path.join(ROOT, rel.replace('/', os.sep))
        if rel not in buffers:
            if not os.path.exists(p):
                problems.append('#%d 文件不存在：%s' % (i, rel))
                continue
            txt, raw = read_norm(p)
            buffers[rel] = {'txt': txt, 'raw': raw}
        cur = buffers[rel]['txt']
        n = cur.count(anchor)
        if n != 1:
            problems.append('#%d %s 锚点命中 %d 次（要求 1）：%s' % (i, rel, n, anchor[:70]))
            continue
        if cur.count(repl) != 0:
            problems.append('#%d %s 替换文本已存在（重复执行？）：%s' % (i, rel, repl[:70]))
            continue
        buffers[rel]['txt'] = cur.replace(anchor, repl, 1)

    print('阶段 1：%d 条编辑 / %d 个文件' % (len(EDITS), len(buffers)))
    if problems:
        print('\n❌ 校验未通过，拒绝落盘：')
        for s in problems:
            print('   ' + s)
        return 1
    print('   锚点全部命中 1 次 ✅')

    # ---------- 阶段 2：统一写回（纯 LF） ----------
    for rel, buf in buffers.items():
        p = os.path.join(ROOT, rel.replace('/', os.sep))
        old_md5 = hashlib.md5(buf['raw']).hexdigest()
        new_bytes = buf['txt'].encode('utf-8')
        new_md5 = hashlib.md5(new_bytes).hexdigest()
        changed = sum(1 for a, b in zip(buf['raw'].decode('utf-8').replace('\r\n', '\n').split('\n'),
                                        buf['txt'].split('\n')) if a != b)
        crlf_before = buf['raw'].count(b'\r\n')
        print('  %-44s %s → %s  行尾CRLF %d→0  变更行≈%d' %
              (rel, old_md5[:8], new_md5[:8], crlf_before, changed))
        if not dry:
            io.open(p, 'wb').write(new_bytes)
    print('\n' + ('（--dry：未落盘）' if dry else '✅ 已落盘（纯 LF）'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
