# -*- coding: utf-8 -*-
"""round74 R108 双向变异回灌（备份一次 + 每条前 reset + 结尾清理）"""
import os, shutil, subprocess, sys

REPO = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = 'node'
GUARD = 'tools/check_fn_selftest_counts.js'
RESTART = os.path.join('specs', 'dev-specs', '★知识存储点_2026-09-10.md')
CORE13 = os.path.join('specs', 'dev-specs', 'core', '13_上线前查缺补漏_决策与待办总览.md')
SCS = os.path.join('cloudfunctions', 'saveCostCard', 'selftest.js')

FILES = [GUARD, RESTART, CORE13, SCS]
BAK = {}
for f in FILES:
    p = os.path.join(REPO, f)
    b = p + '.bak_r74'
    shutil.copy2(p, b)
    BAK[f] = b

def reset():
    for f in FILES:
        shutil.copy2(BAK[f], os.path.join(REPO, f))

def apply(fn, old, new, count=1):
    p = os.path.join(REPO, fn)
    d = open(p, 'rb').read()
    o = old.encode('utf-8'); n = new.encode('utf-8')
    if o not in d:
        return False
    d = d.replace(o, n, count)
    open(p, 'wb').write(d)
    return True

def run():
    r = subprocess.run([NODE, GUARD], cwd=REPO, capture_output=True, encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    red = ('❌' in out) or (r.returncode != 0)
    return ('RED' if red else 'GREEN'), r.returncode, out

CASES = [
  # id, desc, (file, old, new), expect
  ('M0', '删 saveCostCard 一条断言（下界失效本体）', (SCS, "check(\"引擎反向：mode='A' 不抛\", modeCode('A') === null);\r\n", ''), 'RED'),
  ('M1', '声明 108→83（回到旧值）', (RESTART, '合计 **108** 项（含 R81', '合计 **83** 项（含 R81'), 'RED'),
  ('M2', '声明换措辞「通过数合计 108 项」（不错杀）', (RESTART, '7 函数 selftest 合计 **108** 项', '7 函数 selftest 通过数合计 108 项'), 'GREEN'),
  ('M3', '删唯一声明标记（fail-closed）', (RESTART, '🔢 POC2 selftest 合集口径（唯一声明处）：', '🔢 POC2 selftest 合集口径：'), 'RED'),
  ('M4', 'core/13 单函数陈述写错 40/40→25/40', (CORE13, '`calcBom` 40/40', '`calcBom` 25/40'), 'RED'),
  ('M5', '实跑路径写错 calcBom→calcBomX', (GUARD, "cloudfunctions/calcBom/selftest.js'", "cloudfunctions/calcBomX/selftest.js'"), 'RED'),
  ('M6', 'C3 扫描面 specs→specsX（扫空）', (GUARD, "if (!/specs[\\\\/]/.test(abs)) continue;", "if (!/specsX[\\\\/]/.test(abs)) continue;"), 'RED'),
  ('M7', '历史面 review→reviewX（排除面前提）', (GUARD, "if (!/review[\\\\/]/.test(abs)) continue;", "if (!/reviewX[\\\\/]/.test(abs)) continue;"), 'RED'),
  ('M8', '受守集合缩到 6 个', (GUARD, "  { fn: 'syncCostCard', rel: 'cloudfunctions/syncCostCard/selftest.js' },\r\n", ''), 'RED'),
  ('M9', '声明标记扩散到第二份 md', (CORE13, '\r\n', '\r\n🔢 POC2 selftest 合集口径（唯一声明处）：7 函数 selftest 合计 **108** 项\r\n'), 'RED'),
  ('M10', '新增一条正确陈述 detectCycle 12/12（不错杀）', (CORE13, '还原后 `saveCostCard` 29/29', '还原后 `saveCostCard` 29/29、`detectCycle` 12/12'), 'GREEN'),
  ('M11', '无关「合计 5 项」落弱面（不错杀）', (CORE13, '\r\n', '\r\n本次抽检合计 5 项（另一口径）\r\n'), 'GREEN'),
]

results = []
for cid, desc, (fn, old, new), expect in CASES:
    reset()
    okp = apply(fn, old, new)
    if not okp:
        results.append((cid, desc, 'MUTATION_NOT_APPLIED', expect, 'SKIP', -1))
        print(f'{cid} NOT_APPLIED  {desc}')
        continue
    verdict, rc, out = run()
    flag = 'OK' if verdict == expect else 'MISMATCH'
    results.append((cid, desc, verdict, expect, flag, rc))
    print(f'{cid} {verdict:6s} (exp {expect:5s}) {flag:8s} rc={rc}  {desc}')
    if flag == 'MISMATCH':
        for line in out.splitlines():
            if '❌' in line:
                print('      ' + line.strip()[:180])

reset()
for f in FILES:
    os.remove(BAK[f])
print('\n=== 汇总 ===')
bad = [r for r in results if r[4] != 'OK']
for r in results:
    print('  %-4s %-9s exp=%-5s %s' % (r[0], r[2], r[3], r[4]))
print('异常条数：', len(bad))
