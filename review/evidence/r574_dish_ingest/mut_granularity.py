# -*- coding: utf-8 -*-
"""R574 变异回灌：删掉**第三处**（形态 C/D）写入的 granularity ⇒ 6-⑦ 必须转红。

纪律：
  · 只改一处、改完必还原（try/finally），退出前校验文件与原文逐字节相等；
  · 判据看的是"红在哪条断言上"，不是"套件崩了"。
"""
import io
import subprocess
import sys

P = 'cloudfunctions/importSalesBill/index.js'
OLD = "          granularity: 'daily',\n          period_from: g.bizDate,"
NEW = "          period_from: g.bizDate,"

orig = io.open(P, encoding='utf-8').read()
assert orig.count(OLD) == 1, '锚点命中 %d 次（应为 1）' % orig.count(OLD)

def run():
    r = subprocess.run(['node', 'tools/check_m333_parse.js'], capture_output=True, text=True, encoding='utf-8')
    return r.returncode, r.stdout

try:
    mutated = orig.replace(OLD, NEW)
    io.open(P, 'w', encoding='utf-8').write(mutated)
    rc, out = run()
    line = [l for l in out.split('\n') if '6-⑦' in l]
    print('[变异后] rc =', rc)
    print('  6-⑦ →', (line[0].strip()[:130] if line else '(未打印)'))
    print('  转红 =', rc != 0 and any('❌' in l for l in line))
finally:
    io.open(P, 'w', encoding='utf-8').write(orig)
    same = io.open(P, encoding='utf-8').read() == orig
    print('[已还原] 与原文逐字相等 =', same)
    rc2, out2 = run()
    line2 = [l for l in out2.split('\n') if '6-⑦' in l]
    print('[还原后] rc =', rc2, '| 6-⑦ →', (line2[0].strip()[:110] if line2 else '(未打印)'))
    if not same or rc2 != 0:
        sys.exit(1)
