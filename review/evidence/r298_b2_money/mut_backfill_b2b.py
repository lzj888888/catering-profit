# -*- coding: utf-8 -*-
"""R298 · B2 补漏：守卫分辨率变异回灌（真实文件级，非合成数据）

每组：① 记录原始字节 md5 ② 施加变异 ③ 跑守卫取 RC + 目标断言行 ④ **按原始字节还原** ⑤ 复核 md5。
任一组还原失败 ⇒ 立即中止（绝不带着变异继续）。

6 组覆盖：
  M1 新增未登记命中（IDENT）      ⇒ C-① 必须红并点名
  M2 money 退回裸写（IDENT）      ⇒ C-④ 必须红并点名
  M3 money 退回裸写（**括号形态**）⇒ C-④ 必须红 —— 证明初版守卫的**盲区已被覆盖**
  M4 删除一处已登记命中           ⇒ C-② 必须红（登记失效）
  M5 索引形态 `] * 100`（三桶外） ⇒ S-⑤ 必须红（穷尽性判据有牙）
  M6 纯排版（加空格）不改变键     ⇒ **必须保持绿**（证明判据不脆、不会天天误报）

运行：python review/evidence/r298_b2_money/mut_backfill_b2b.py
"""
import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
GUARD = os.path.join(ROOT, 'tools', 'check_money_precision.js')

MUTS = [
    dict(id='M1', name='新增未登记命中（IDENT 裸写）',
         rel='utils/calc.js',
         anchor="const grossRate = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;",
         repl="const grossRate = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;\n"
              "function zzProbeFen(qty) { return qty * 100; }",
         want_rc=1, want_lines=['❌ C-①'], also_forbid=[]),

    dict(id='M2', name='money 退回裸写（IDENT 形态）',
         rel='utils/bizPreset.js',
         anchor="return Number.isFinite(n) ? Math.round(Number((n * 100).toFixed(10))) : 0;",
         repl="return Number.isFinite(n) ? Math.round(n * 100) : 0;",
         want_rc=1, want_lines=['❌ C-④'], also_forbid=['❌ C-①']),

    dict(id='M3', name='money 退回裸写（**括号形态** —— 初版守卫完全看不见）',
         rel='pages/takeaway/index.js',
         anchor="const fen = (v) => Math.round(Number(((Number(v) || 0) * 100).toFixed(10)));",
         repl="const fen = (v) => Math.round((Number(v) || 0) * 100);",
         want_rc=1, want_lines=['❌ C-④'], also_forbid=['❌ C-①']),

    dict(id='M4', name='删除一处已登记命中',
         rel='pages/card/version.js',
         anchor="const pct = (n) => Math.round((n / maxVal) * 100);",
         repl="const pct = (n) => Math.round((n / maxVal) * 1000);",
         want_rc=1, want_lines=['❌ C-②', '❌ C-③'], also_forbid=[]),

    dict(id='M5', name='索引形态 `] * 100`（三桶之外）',
         rel='utils/calc.js',
         anchor="const grossRate = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;",
         repl="const grossRate = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;\n"
              "function zzIdx(cells) { return cells[0] * 100; }",
         want_rc=1, want_lines=['❌ S-⑤'], also_forbid=[]),

    dict(id='M6', name='纯排版变化（加空格）不改变键 ⇒ 必须保持绿',
         rel='pages/month/result.js',
         anchor="const ratio = incomeFen > 0 ? Math.round((trueFen / incomeFen) * 100) : 0;",
         repl="const ratio = incomeFen > 0 ? Math.round( (trueFen / incomeFen)  *  100) : 0;",
         want_rc=0, want_lines=[], also_forbid=['❌']),
]


def run_guard():
    p = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True)
    out = p.stdout.decode('utf-8', 'replace') + p.stderr.decode('utf-8', 'replace')
    return p.returncode, out


def main():
    print('=' * 92)
    print('R298 B2 补漏 · 守卫分辨率变异回灌（%d 组）' % len(MUTS))
    print('=' * 92)
    ok_all = True
    for m in MUTS:
        p = os.path.join(ROOT, m['rel'].replace('/', os.sep))
        raw0 = io.open(p, 'rb').read()
        md0 = hashlib.md5(raw0).hexdigest()
        txt = raw0.decode('utf-8')
        if txt.count(m['anchor']) != 1:
            print('\n[%s] ❌ 锚点命中 %d 次（要求 1）%s' % (m['id'], txt.count(m['anchor']), m['rel']))
            ok_all = False
            continue
        try:
            io.open(p, 'wb').write(txt.replace(m['anchor'], m['repl'], 1).encode('utf-8'))
            rc, out = run_guard()
        finally:
            io.open(p, 'wb').write(raw0)          # 按原始字节还原
        md1 = hashlib.md5(io.open(p, 'rb').read()).hexdigest()
        还原 = 'OK' if md1 == md0 else '!!还原失败!!'

        lines = [l for l in out.split('\n') if l.strip()]
        hit = {w: any(w in l for l in lines) for w in m['want_lines']}
        forbid = {w: any(w in l for l in lines) for w in m['also_forbid']}
        rc_ok = (rc == m['want_rc'])
        cond = rc_ok and all(hit.values()) and not any(forbid.values()) and md1 == md0
        ok_all = ok_all and cond
        print('\n[%s] %s' % (m['id'], m['name']))
        print('   文件 %s  md5 %s → %s  还原=%s' % (m['rel'], md0[:8], md1[:8], 还原))
        print('   RC 期望 %d / 实测 %d  %s' % (m['want_rc'], rc, '✅' if rc_ok else '❌'))
        for w in m['want_lines']:
            ev = [l.strip() for l in lines if w in l]
            print('   期望出现 %-10s %s  %s' % (w, '✅' if ev else '❌', (ev[0][:120] if ev else '')))
        for w in m['also_forbid']:
            print('   必须不出现 %-10s %s' % (w, '✅' if not forbid[w] else '❌'))
        print('   判定：' + ('✅ 通过' if cond else '❌ 不通过'))

    print('\n' + '=' * 92)
    print('总判定：' + ('✅ 全部 %d 组通过（守卫分辨力已证）' % len(MUTS) if ok_all else '❌ 有组不通过'))
    print('=' * 92)
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
