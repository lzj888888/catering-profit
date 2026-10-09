# -*- coding: utf-8 -*-
# R254 变异回灌 补：M1b 单独验证 8-⑥（旧解构形态）有分辨力
#   只改「绑定名形态」：`totals: dineTotals` → `totals`（+ 让 mergeTotals 接到 totals），
#   保持 8-⑤ 仍绿 ⇒ 若 8-⑥ 能单独转红，说明它不依赖 8-⑤，是真分辨力。
import hashlib, subprocess, os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
IDX = os.path.join(ROOT, 'cloudfunctions', 'getDishReview', 'index.js')
GUARD = os.path.join(ROOT, 'tools', 'check_dishreview_engine.js')
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'

md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
rd = lambda p: open(p, 'rb').read().decode('utf-8')
wr = lambda p, s: open(p, 'wb').write(s.encode('utf-8'))


def run():
    r = subprocess.run([NODE, GUARD], capture_output=True, cwd=ROOT)
    return (r.stdout + r.stderr).decode('utf-8', errors='replace')


orig = rd(IDX)
m0 = md5(IDX)
print('原 md5 index.js =', m0)

s = orig
A = "  const { dine_in: ranked, unmatched, totals: dineTotals } = buildDishReview(dineIn, cards, deps);"
B = "  const totals = mergeTotals(dineTotals, takeawayResult.totals);"
assert A in s and B in s, '锚点未命中'
s = s.replace(A, "  const { dine_in: ranked, unmatched, totals } = buildDishReview(dineIn, cards, deps);", 1)
s = s.replace(B, "  const totalsMerged = mergeTotals(totals, takeawayResult.totals); void totalsMerged;", 1)
wr(IDX, s)

out = run()
reds = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
tail = [l.strip() for l in out.splitlines() if '通过 /' in l]
print('\n--- M1b 旧解构形态（totals: dineTotals → totals）---')
print('  末行:', tail[-1] if tail else 'NONE')
for l in reds:
    print('   ', l)
hit86 = any(('❌ 8-⑥') in l for l in reds)
hit85 = any(('❌ 8-⑤') in l for l in reds)
print('  8-⑥ 转红:', hit86, '| 8-⑤ 转红(应为 False，证明 8-⑥ 独立):', hit85)

wr(IDX, orig)
cur = md5(IDX)
print('\n还原 md5 =', cur, 'SAME' if cur == m0 else 'DIFF!!')
out2 = run()
tail2 = [l.strip() for l in out2.splitlines() if '通过 /' in l]
print('还原后末行:', tail2[-1] if tail2 else 'NONE')
ok = hit86 and (not hit85) and cur == m0 and ('0 失败' in (tail2[-1] if tail2 else ''))
print('\nRESULT:', 'ALL OK' if ok else 'NOT OK')
sys.exit(0 if ok else 1)
