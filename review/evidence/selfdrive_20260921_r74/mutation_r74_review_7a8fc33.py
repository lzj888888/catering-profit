# -*- coding: utf-8 -*-
"""round74 独立复核第三方 commit 7a8fc33（堂食别名归并 G11a/G11b/G11d）
不采信其自述「_mut_r73.py 6/6 抓到」，我方重做双向变异。
坑⑩定式：备份只做一次(内存) / 每条前先还原 / 结尾清理 / 判据=有❌行 或 RC≠0
"""
import os, subprocess, shutil

REPO = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SUITE = 'tools/selftest_batch8b.js'
FILES = {
    'din':  os.path.join('utils', 'dineChannels.js'),
    'inp':  os.path.join('pages', 'month', 'input.js'),
    'wxml': os.path.join('pages', 'month', 'input.wxml'),
    't1':   os.path.join('miniprogram', 'i18n', 'terms.js'),
    't2':   os.path.join('specs', 'dev-specs', 'i18n', 'terms.js'),
}
BAK = {}
for k, rel in FILES.items():
    p = os.path.join(REPO, rel)
    BAK[k] = open(p, 'rb').read()

def restore(keys=None):
    for k in (keys or BAK.keys()):
        open(os.path.join(REPO, FILES[k]), 'wb').write(BAK[k])

def run_suite():
    r = subprocess.run(['node', SUITE], cwd=REPO, capture_output=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    red = ('❌' in out) or (r.returncode != 0)
    return red, r.returncode, out

def apply(key, old, new, count=1):
    p = os.path.join(REPO, FILES[key])
    d = open(p, 'rb').read()
    o, n = old.encode('utf-8'), new.encode('utf-8')
    if o not in d:
        return False
    d = d.replace(o, n, count)
    open(p, 'wb').write(d)
    return True

MUTS = [
    ('M1', 'din', "const t = aliasMap[n];", "const t = undefined;", ['din'], 'RED',
     '装配口不查别名表 ⇒ 归并整个失效'),
    ('M2', 'inp', "TERMS.ledger.channelAliases || {}", "{}", ['inp'], 'RED',
     '页面不把别名表传进装配口'),
    ('M3', 'wxml', "g.expanded && !r.fixed && g.rows.length > 1", "g.expanded && g.rows.length > 1", ['wxml'], 'RED',
     '预设行 × 又冒出来（李老师反馈的缺陷本体）'),
    ('M4', 't1', "      '美团': '团购/代金券核销',\n", "", ['t1', 't2'], 'RED',
     '别名表删「美团」条目（双副本同改，K11 不红，只应 G11a 红）'),
    ('M5', 't1', "      '代金券': '团购/代金券核销',\n",
     "      '代金券': '团购/代金券核销',\n      '口碑': '团购/代金券核销',\n", ['t1', 't2'], 'GREEN',
     '双副本各加一条**正确**别名（合法扩展，不该杀）'),
    ('M6', 'din', "// ⚠️ 别名归并是**加法**", "// ⚠️ 别名归并是加法（注释改写）", ['din'], 'GREEN',
     '仅改注释文字'),
]

mismatch = []
for mid, key, old, new, keys, expect, desc in MUTS:
    restore()
    if not apply(key, old, new):
        if mid == 'M4' or mid == 'M5':
            # 双副本：第二份单独应用
            ok2 = apply('t2', old, new)
            if not ok2:
                print(f'{mid} NOT_APPLIED'); mismatch.append(mid); continue
        else:
            print(f'{mid} NOT_APPLIED'); mismatch.append(mid); continue
    if key in ('t1',):
        apply('t2', old, new)  # 双副本同步，避免 K11 干扰
    red, rc, out = run_suite()
    got = 'RED' if red else 'GREEN'
    ok = (got == expect)
    print(f'{mid}: expect={expect} got={got} rc={rc} {"OK" if ok else "MISMATCH"}  # {desc}')
    if not ok:
        mismatch.append(mid)
        for l in out.splitlines():
            if '❌' in l:
                print('     ', l.strip()[:140])
    restore()

restore()
red, rc, out = run_suite()
print(f'\n还原后: rc={rc} red={red}')
tail = [l.strip() for l in out.splitlines() if '通过 /' in l]
print('   ', tail[-1] if tail else '(no summary)')
print('MISMATCH 列表:', mismatch or '无')
