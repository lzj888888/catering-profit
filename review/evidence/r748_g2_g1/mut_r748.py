import io, os, subprocess, hashlib, sys

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'


def md5(p):
    return hashlib.md5(io.open(p, 'rb').read()).hexdigest()


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True)
    return r.returncode, (r.stdout or b'').decode('utf-8', 'replace')


MUTS = [
    # (标签, 目标文件, 原文, 变异, 应该转红的守卫)
    ('M1 跨月分摊被去掉（整段直接塞回，等同旧实现）',
     'cloudfunctions/getDishReview/service.js',
     'for (const part of splitIntervalByMonth(s)) {',
     'for (const part of [{ days: 1, qty: s.qty, amount: s.amount, from: f, to: t }]) {',
     'tools/check_dishreview_crossmonth.js'),
    ('M2 尾差倒挤被去掉（最后一个月也按比例取整）',
     'cloudfunctions/getDishReview/service.js',
     'if (isLast) { q = qty - usedQ; am = amount - usedA; }',
     'if (isLast) { q = Math.round((qty * days) / totalDays); am = Math.round((amount * days) / totalDays); }',
     'tools/check_dishreview_crossmonth.js'),
    ('M3 导入扩展名改回只有 xlsx',
     'subpkg/biz/takeaway/index.js',
     "extension: ['xlsx', 'csv', 'xls']",
     "extension: ['xlsx']",
     'tools/check_import_ext_parity.js'),
]

results = []
for label, rel, old, new, guard in MUTS:
    p = os.path.join(ROOT, rel)
    orig = io.open(p, encoding='utf-8', newline='').read()
    h0 = md5(p)
    if orig.count(old) != 1:
        results.append((label, 'SKIP(锚点未命中 %d 次)' % orig.count(old)))
        print('⚠️ 跳过（锚点不唯一）：' + label)
        continue
    try:
        io.open(p, 'w', encoding='utf-8', newline='').write(orig.replace(old, new, 1))
        rc, out = run('node ' + guard)
        red = (rc != 0)
        results.append((label, '转红 ✅' if red else '仍绿 ❌ 假绿'))
        print(('✅ 转红' if red else '❌ 未转红') + ' ｜ ' + label + ' ｜ guard rc=' + str(rc))
        if red:
            first = [l for l in out.splitlines() if l.startswith('❌')]
            if first:
                print('    ↳ ' + first[0][:110])
    finally:
        io.open(p, 'w', encoding='utf-8', newline='').write(orig)
        assert md5(p) == h0, '还原失败：' + rel
        rc2, _ = run('node ' + guard)
        print('    ↳ 还原后复跑 guard rc=' + str(rc2) + (' （绿）' if rc2 == 0 else ' （仍红！）'))

bad = [r for r in results if '❌' in r[1] or 'SKIP' in r[1]]
print('\n===== 变异回灌：%d 组，真命中 %d，问题 %d =====' % (len(results), len(results) - len(bad), len(bad)))
sys.exit(0 if not bad else 1)
