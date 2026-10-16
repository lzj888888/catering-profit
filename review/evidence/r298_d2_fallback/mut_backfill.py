# -*- coding: utf-8 -*-
"""R298-D2 变异回灌：证明 tools/check_yield_rate_range.js 的 E 段（五副本夹紧）非假绿。
纪律：① 纯内存备份；② 每条独立 reset；③ 锚点命中须 ==1（fail-closed）；
      ④ 组A(该红,须点名)/组B(不该红)成对；⑤ 还原后复跑必须全绿；⑥ 先 encode 再 write。
"""
import os, re, subprocess, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'
GUARD = os.path.join(ROOT, 'tools', 'check_yield_rate_range.js')

F = {
    'calc':  'cloudfunctions/calcBom/service.js',
    'getm':  'cloudfunctions/getMaterial/service.js',
    'scc':   'cloudfunctions/saveCostCard/service.js',
    'sm':    'cloudfunctions/saveMaterial/service.js',
    'sync':  'cloudfunctions/syncCostCard/service.js',
}

BASE = {}
for k, rel in F.items():
    p = os.path.join(ROOT, rel.replace('/', os.sep))
    BASE[k] = open(p, 'rb').read()


def path_of(k):
    return os.path.join(ROOT, F[k].replace('/', os.sep))


def reset():
    for k, rel in F.items():
        with open(path_of(k), 'wb') as f:
            f.write(BASE[k])


def sub1(key, old, new):
    p = path_of(key)
    txt = open(p, 'rb').read().decode('utf-8')
    assert '\r' not in txt, '文件 %s 含 CR ⇒ 锚点策略需调整' % F[key]
    cnt = txt.count(old)
    if cnt != 1:
        raise RuntimeError('锚点命中 %d 次（须恰为 1）: %r' % (cnt, old[:70]))
    data = txt.replace(old, new, 1).encode('utf-8')
    with open(p, 'wb') as f:
        f.write(data)


def run_guard():
    r = subprocess.run([NODE, GUARD], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    fails = [l for l in out.splitlines() if '❌' in l]
    summ = re.search(r'(\d+) 通过 / (\d+) 失败', out)
    crashed = (r.returncode != 0) and (summ is None)
    return r.returncode, fails, crashed, out


CLAMP_BLOCK = ('  const y = Number(yieldRate);\n'
               '  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;\n'
               '  const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1;\n')
BARE_LINE = ('  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);\n')

MUT = [
    # ---- 组 A：该红，且必须点名到 E 段断言 ----
    ('A1 scc 整块退回裸除（旧 bug 复现）', 'scc',
     CLAMP_BLOCK + '  const yuan = (purchasePriceFen / 100) / cf / (yr / 100);\n',
     BARE_LINE, 'E-③'),
    ('A2 sync 整块退回裸除（只坏 1/5 副本）', 'sync',
     CLAMP_BLOCK + '  const yuan = (purchasePriceFen / 100) / cf / (yr / 100);\n',
     BARE_LINE, 'E-③'),
    ('A3 getm 夹紧方向错（缺失给 0 而非 100）', 'getm',
     '  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;',
     '  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 0;', 'E-③'),
    ('A4 calc 上界放宽到 1000（>100 不再夹）', 'calc',
     '  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;',
     '  const yr = (Number.isFinite(y) && y > 0 && y <= 1000) ? y : 100;', 'E-③'),
    ('A5 sm 删换算系数夹紧（cf=0 ⇒ Infinity）', 'sm',
     '  const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1;',
     '  const cf = Number(convertFactor);', 'E-③'),
    ('A6 getm 函数名改掉（判据读不到 ⇒ E-①）', 'getm',
     'function netUnitCostWan(', 'function netUnitCostWanX(', 'E-①'),
    ('A7 scc 下界放行 0（y>0 ⇒ y>=0，÷0 重现）', 'scc',
     '  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;',
     '  const yr = (Number.isFinite(y) && y >= 0 && y <= 100) ? y : 100;', 'E-③'),
    # ---- 组 B：不该红（等价改写 / 纯注释）----
    ('B1 scc 等价改写（&& 链换成 !(<=) 形式）', 'scc',
     '(Number.isFinite(y) && y > 0 && y <= 100)',
     '(Number.isFinite(y) && !(y <= 0) && !(y > 100))', None),
    ('B2 scc 仅加注释（零语义变化）', 'scc',
     '  const y = Number(yieldRate);\n',
     '  // mut-b2 纯注释，不改语义\n  const y = Number(yieldRate);\n', None),
]


def main():
    reset()
    rc, fails, crashed, out = run_guard()
    if rc != 0 or fails:
        print('基线不绿，先修。rc=%s fails=%s' % (rc, len(fails)))
        for l in fails[:5]:
            print('   ', l.strip())
        return 1
    print('基线：rc=0 全绿 ✅\n')
    miss = []
    for name, key, old, new, expect in MUT:
        reset()
        try:
            sub1(key, old, new)
        except RuntimeError as e:
            print('SKIP %-42s %s' % (name, e))
            miss.append(name + '(锚点)')
            continue
        rc, fails, crashed, out = run_guard()
        caught = bool(fails) or crashed
        named = (expect is None) or any(expect in l for l in fails)
        if expect is None:
            verdict = '✅如期绿' if not caught else '❌假红（不该红却红了）'
            if caught:
                miss.append(name)
        else:
            if caught and named:
                verdict = '✅抓到(点名 %s)' % expect
            elif caught and not named:
                verdict = '⚠️红了但未点名 %s' % expect
                miss.append(name)
            else:
                verdict = '❌漏网（守卫没抓住）'
                miss.append(name)
        print('%-46s ❌=%d crash=%-5s %s' % (name, len(fails), crashed, verdict))
        if caught and expect is not None:
            for l in fails[:3]:
                print('        └ ' + l.strip()[:150])
    reset()
    rc, fails, crashed, out = run_guard()
    print('\n还原后：rc=%d ❌=%d crash=%s %s' % (rc, len(fails), crashed, '✅ 未留污染' if (rc == 0 and not fails) else '❌ 有残留'))
    # 字节级还原证明
    same = all(open(path_of(k), 'rb').read() == BASE[k] for k in F)
    print('字节级还原一致：%s' % same)
    ok = (not miss) and rc == 0 and not fails and same
    print('\n结论：%s' % ('全部如期 ✅' if ok else '有问题：' + '；'.join(miss)))
    return 0 if ok else 1


sys.exit(main())
