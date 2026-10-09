# -*- coding: utf-8 -*-
# R254 变异回灌：把源码改回错误写法，看守卫是否【点名到目标断言】地转红
# 铁律：每条独立、可还原、还原后 md5 全等、组 A(源码面)+组 B(行为面) 成对
import hashlib, subprocess, os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
IDX = os.path.join(ROOT, 'cloudfunctions', 'getDishReview', 'index.js')
SVC = os.path.join(ROOT, 'cloudfunctions', 'getDishReview', 'service.js')
GUARD = os.path.join(ROOT, 'tools', 'check_dishreview_engine.js')
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


def rd(p):
    return open(p, 'rb').read().decode('utf-8')


def wr(p, s):
    open(p, 'wb').write(s.encode('utf-8'))


def run_guard():
    r = subprocess.run([NODE, GUARD], capture_output=True, cwd=ROOT)
    return (r.stdout + r.stderr).decode('utf-8', errors='replace')


MUTS = [
    # 组 A：源码面 —— index.js 退回「只取堂食 totals」
    dict(name='M1 index.js 退回只取堂食（旧写法）', f=IDX,
         old="  const { dine_in: ranked, unmatched, totals: dineTotals } = buildDishReview(dineIn, cards, deps);",
         new="  const { dine_in: ranked, unmatched, totals: dineTotals } = buildDishReview(dineIn, cards, deps);\n  // MUT",
         # 真正的变异在下一行：让顶层 totals 变回堂食那份
         old2="  const totals = mergeTotals(dineTotals, takeawayResult.totals);",
         new2="  const totals = dineTotals;",
         expect=['8-⑤', '8-⑥']),
    # 组 B：行为面 —— mergeTotals 只返回堂食那份
    dict(name='M2 mergeTotals 只取堂食（丢外卖）', f=SVC,
         old="    out[f] = x + y;", new="    out[f] = x;",
         expect=['8-①', '8-③', '8-④']),
]

orig = {p: rd(p) for p in (IDX, SVC)}
orig_md5 = {p: md5(p) for p in (IDX, SVC)}
print('原 md5：')
for p in (IDX, SVC):
    print('  ', os.path.basename(p), orig_md5[p])

allok = True
for m in MUTS:
    p = m['f']
    s = orig[p]
    assert m['old'] in s, '锚点未命中: ' + m['name']
    s2 = s.replace(m['old'], m['new'], 1)
    if 'old2' in m:
        assert m['old2'] in s2, '锚点2未命中: ' + m['name']
        s2 = s2.replace(m['old2'], m['new2'], 1)
    wr(p, s2)
    out = run_guard()
    reds = [l for l in out.splitlines() if l.strip().startswith('❌')]
    tail = [l for l in out.splitlines() if '通过 /' in l]
    hit = [e for e in m['expect'] if any(('❌ ' + e) in l for l in reds)]
    ok = len(hit) >= 1 and ('失败' in (tail[-1] if tail else ''))
    print('\n---', m['name'], '---')
    print('  期望命中:', m['expect'], '| 实命中:', hit)
    print('  末行:', (tail[-1].strip() if tail else 'NONE'))
    for l in reds[:12]:
        print('   ', l.strip())
    if not ok:
        allok = False
        print('  ⚠️ 未命中目标断言')
    wr(p, orig[p])

print('\n=== 还原校验 ===')
for p in (IDX, SVC):
    cur = md5(p)
    same = (cur == orig_md5[p])
    print('  ', os.path.basename(p), cur, 'SAME' if same else 'DIFF!!')
    if not same:
        allok = False

# 还原后必须全绿
out = run_guard()
tail = [l for l in out.splitlines() if '通过 /' in l]
print('  还原后末行:', (tail[-1].strip() if tail else 'NONE'))
if '0 失败' not in (tail[-1] if tail else ''):
    allok = False
    print('  ⚠️ 还原后未全绿')

print('\nRESULT:', 'ALL OK' if allok else 'NOT OK')
sys.exit(0 if allok else 1)
