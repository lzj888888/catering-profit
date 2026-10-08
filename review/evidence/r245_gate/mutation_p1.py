# -*- coding: utf-8 -*-
"""R245 · P1 变异回灌：把 deny 判据去掉 ⇒ 新断言必须转红（否则是假绿）。

变异 M1：`deny: JD_ONLY_COLS,` → `deny: [],`（回到「单列特征」的旧语义）
期望：selftest 报红，且**红的必须是目标断言名**（京东 SKU 表头 ≠ taobao）。
还原后必须回到 20/0。
"""
import hashlib
import os
import subprocess

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
TARGET = os.path.join(REPO, 'utils/billParse.js')
SELFTEST = 'tools/selftest_bill_parse.js'

orig = open(TARGET, encoding='utf-8').read()
md5o = hashlib.md5(orig.encode('utf-8')).hexdigest()


def run():
    r = subprocess.run([NODE, SELFTEST], cwd=REPO, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    fails = [ln.strip() for ln in (r.stdout or '').splitlines() if '❌' in ln]
    summ = [ln.strip() for ln in (r.stdout or '').splitlines() if '自测结果' in ln]
    return r.returncode, fails, (summ[0] if summ else '')


try:
    # ---- 基线 ----
    rc, fails, s = run()
    print('[基线] rc=%s %s | FAIL=%d' % (rc, s, len(fails)))

    # ---- 变异 M1：deny 置空 ----
    mut = orig.replace('deny: JD_ONLY_COLS,', 'deny: [],')
    assert mut != orig, '变异点未命中'
    open(TARGET, 'w', encoding='utf-8').write(mut)
    rc2, fails2, s2 = run()
    print('[M1 deny 置空] rc=%s %s' % (rc2, s2))
    for f in fails2:
        print('    ', f)
    hit = any('京东 SKU 表头' in f for f in fails2)
    print('[M1] 在目标断言名上转红?', hit, '（崩溃红不算）')

    # ---- 变异 M2：require 退回单列 ----
    mut2 = orig.replace("require: [C_BILL_DATE, C_TAOBAO_NET],", "require: [C_TAOBAO_NET],")
    assert mut2 != orig, 'M2 变异点未命中'
    open(TARGET, 'w', encoding='utf-8').write(mut2)
    rc3, fails3, s3 = run()
    print('[M2 require 单列] rc=%s %s' % (rc3, s3))
    for f in fails3:
        print('    ', f)
finally:
    open(TARGET, 'w', encoding='utf-8').write(orig)
    md5n = hashlib.md5(open(TARGET, encoding='utf-8').read().encode('utf-8')).hexdigest()
    print('[还原] md5 一致?', md5o == md5n)
    rc4, fails4, s4 = run()
    print('[还原后] rc=%s %s | FAIL=%d' % (rc4, s4, len(fails4)))
