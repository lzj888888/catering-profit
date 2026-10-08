# -*- coding: utf-8 -*-
"""R245 · P2~P6 变异回灌（改 utils/billParse.js，逐条独立、跑完必还原）。

M3  jd_order.rowFilter 置 null      ⇒ 「收入 555.96」应转红（否则说明筛选没生效）
M4  jd_sku.qtyRule → 'perRow'       ⇒ 「订单数 3」应转红（长表按行数计 = 13）
M5  guessHeader 忽略 platform 签名   ⇒ 两级表头定位是否仍对（如实记录，不预设红）
"""
import hashlib
import os
import subprocess

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
TARGET = os.path.join(REPO, 'utils', 'billParse.js')
SELFTEST = 'tools/selftest_bill_parse.js'

orig = open(TARGET, encoding='utf-8').read()
md5o = hashlib.md5(orig.encode('utf-8')).hexdigest()


def run():
    r = subprocess.run([NODE, SELFTEST], cwd=REPO, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    fails = [ln.strip() for ln in (r.stdout or '').splitlines() if '❌' in ln]
    summ = [ln.strip() for ln in (r.stdout or '').splitlines() if '自测结果' in ln]
    return r.returncode, fails, (summ[0] if summ else '')


MUTS = [
    ('M3 jd_order.rowFilter 置 null',
     "rowFilter: { col: '订单类型', eq: '正向订单' },",
     'rowFilter: null,', '555.96'),
    ('M4 jd_sku.qtyRule 改 perRow',
     "    rowFilter: null,                                 // 长表全额计入（负值 = 扣项）\n    qtyRule: 'perOrderNo',",
     "    rowFilter: null,\n    qtyRule: 'perRow',", '订单数 3'),
    ('M5 guessHeader 忽略 platform 签名',
     '  const prof = platform ? PLATFORM_PROFILE[platform] : null;\n  if (prof && prof.require) {',
     '  const prof = null;\n  if (prof && prof.require) {', '表头行 = 1'),
]

try:
    rc, fails, s = run()
    print('[基线] rc=%s %s | FAIL=%d' % (rc, s, len(fails)))
    for name, old, new, expect in MUTS:
        mut = orig.replace(old, new)
        if mut == orig:
            print('[%s] ⚠️ 变异点未命中，跳过' % name); continue
        open(TARGET, 'w', encoding='utf-8').write(mut)
        rcn, fn, sn = run()
        print('[%s] rc=%s %s' % (name, rcn, sn))
        for f in fn:
            print('      ', f)
        hit = any(expect in f for f in fn)
        print('     → 在目标断言（含「%s」）上转红? %s' % (expect, hit))
        open(TARGET, 'w', encoding='utf-8').write(orig)
finally:
    open(TARGET, 'w', encoding='utf-8').write(orig)
    md5n = hashlib.md5(open(TARGET, encoding='utf-8').read().encode('utf-8')).hexdigest()
    rc, fails, s = run()
    print('[还原] md5 一致? %s | 还原后 rc=%s %s FAIL=%d' % (md5o == md5n, rc, s, len(fails)))
