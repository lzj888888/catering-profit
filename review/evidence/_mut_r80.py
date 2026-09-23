# -*- coding: utf-8 -*-
import subprocess, sys, shutil
M1 = 'specs/dev-specs/core/开发规范v1.0_ModuleM1_月度盈利核算.md'
M3 = 'specs/dev-specs/core/开发规范v1.0_ModuleM3_菜品成本卡.md'
M13 = 'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md'
GUARD = 'tools/check_redline_thresholds.js'

snap = {}
for p in (M1, M3, M13, GUARD):
    snap[p] = open(p, 'rb').read()

def nl_of(b):
    return b'\r\n' if b.count(b'\r\n') == b.count(b'\n') and b.count(b'\n') else b'\n'

def run_guard():
    r = subprocess.run(['node', GUARD], capture_output=True)
    out = (r.stdout + r.stderr).decode('utf-8', 'ignore')
    tail = [l for l in out.splitlines() if l.strip().startswith('===== 经营红线')]
    return r.returncode, (tail[0] if tail else out.strip()[-120:])

def mutate(path, old, new):
    b = snap[path]
    nl = nl_of(b)
    o, n = old.encode('utf-8'), new.encode('utf-8').replace(b'\n', nl)
    if o.replace(b'\n', nl) not in b:
        return None
    nb = b.replace(o.replace(b'\n', nl), n, 1)
    open(path, 'wb').write(nb)
    return True

def restore():
    for p, b in snap.items():
        open(p, 'wb').write(b)

CASES = [
 # (编号, 文件, old, new, 期望: 'RED'=须红 / 'GREEN'=须仍绿, 说明)
 ('M1', M1, '房租占比 **15**%', '房租占比 **12**%', 'RED',   '声明数字改错（15→12）'),
 ('M2', M1, '> **经营红线阈值口径（唯一声明处）**：房租占比 **15**%', '> **经营红线阈值口径（唯一声明处）**： 房租占比 **15**%', 'GREEN', '正确实现换措辞（前置空格）不错杀'),
 ('M3', M1, '| 人工占比 | ≤20% |', '| 人工占比 | ≤18% |', 'RED',   '表格值改错（20→18）'),
 ('M4', M3, '毛利≥55%', '毛利≥60%', 'RED',   'M3 引用行改错（55→60）'),
 ('M5', M1, '> **经营红线阈值口径（唯一声明处）**：房租占比 **15**% / 人工占比 **20**% / 菜品毛利率 **55**% / 食材损耗率 **5**%。\n', '', 'RED', '删唯一声明处（fail-closed）'),
 ('M6', M13, '## ', '## [变异] ', 'RED',   '声明扩散到第二份 md（单源不扩散）'),
 ('M7', M3, '毛利≥55%、房租≤15%', '毛利 ≥55%、房租 ≤15%', 'GREEN', '引用行换措辞（加空格）不错杀'),
 ('M8', GUARD, "walk(path.join(ROOT, 'specs'), [])", "walk(path.join(ROOT, 'specs_typo'), [])", 'RED', '扫描面根路径写错（前提守卫非恒真）'),
]
# M6 改为「把声明整行复制到 core/13」
def m6():
    b = snap[M13]
    line = [l for l in snap[M1].split(nl_of(snap[M1])) if '唯一声明处' in l.decode('utf-8','ignore')]
    if not line: return None
    open(M13, 'wb').write(b + nl_of(b) + line[0])
    return True

rows = []
for cid, path, old, new, exp, desc in CASES:
    restore()
    ok = m6() if cid == 'M6' else mutate(path, old, new)
    if ok is None:
        rows.append((cid, 'NOT_APPLIED', exp, desc, '锚点未命中'))
        continue
    rc, tail = run_guard()
    got = 'RED' if rc != 0 else 'GREEN'
    verdict = 'OK' if got == exp else 'MISMATCH'
    rows.append((cid, got, exp, desc, verdict))
restore()

print('%-4s %-8s %-6s %-8s %s' % ('编号', '实际', '期望', '判定', '说明'))
for r in rows:
    print('%-4s %-8s %-6s %-8s %s' % r)
bad = [r for r in rows if r[4] not in ('OK',)]
print('\n异常组数 =', len(bad))
r = subprocess.run(['git', 'diff', '--stat'], capture_output=True, text=True)
print('还原后 git diff --stat:', repr(r.stdout[:200]))
