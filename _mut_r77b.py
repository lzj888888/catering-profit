# -*- coding: utf-8 -*-
"""round77 加固后复验：A 组重跑 + 新增写法族（证明语义判据既不漏也不错杀）"""
import subprocess, os, hashlib

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
RES = []


def rd(p):
    return open(os.path.join(ROOT, p), 'rb').read()


def wr(p, b):
    open(os.path.join(ROOT, p), 'wb').write(b)


def rep(b, frm, to):
    if frm in b:
        return b.replace(frm, to, 1), True
    return b, False


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True,
                       encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def mut(mid, files, edits, expect, cmd='node tools/selftest_ui_fix.js'):
    snaps = {f: rd(f) for f in files}
    ok = True
    for f, frm, to in edits:
        b = rd(f)
        nb, a = rep(b, frm, to)
        if not a:
            print('  !! %s 锚点未命中 %s' % (mid, f))
            ok = False
            break
        wr(f, nb)
    if not ok:
        for f in files:
            wr(f, snaps[f])
        RES.append((mid, 'NOT_APPLIED', '', expect, 'SKIP'))
        return
    rc, out = run(cmd)
    v = 'RED' if rc else 'GREEN'
    good = v == expect
    RES.append((mid, v, 'rc=%d' % rc, expect, 'OK' if good else 'MISMATCH'))
    line = [l for l in out.strip().splitlines() if '通过 /' in l]
    print('  %-6s %-5s rc=%d 期望=%-5s %s   %s' % (
        mid, v, rc, expect, 'OK' if good else '*** MISMATCH ***',
        line[-1][:70] if line else ''))
    for f in files:
        wr(f, snaps[f])
        if hashlib.md5(rd(f)).hexdigest() != hashlib.md5(snaps[f]).hexdigest():
            print('  !! 还原失败 %s' % f)


UIJS = 'utils/ui.js'
MONTH = 'pages/month/index.js'

OLD_BLOCK = b"""      let months = (ml.list || []).map((m) => m.month);
      if (!months.includes(cur)) months.push(cur);
      months = months.sort().reverse();"""
NEW_BLOCK = b"""      const months = Array.from(new Set(
        ui.recentMonths(24)
          .concat((ml.list || []).map((m) => m.month))
          .concat([cur])
          .filter(Boolean),
      )).sort().reverse();"""

print('===== 加固后复验 =====')
mut('A1', [MONTH], [(MONTH, NEW_BLOCK, OLD_BLOCK)], 'RED')          # 退回旧实现
mut('A5', [MONTH], [(MONTH, b'const months = Array.from(new Set(', b'const months = [...new Set('),
                    (MONTH, b'      )).sort().reverse();', b'      ].sort().reverse();')], 'GREEN')  # 展开写法

# A6 正确实现换第三种去重写法（filter+indexOf）
ALT = b"""      const months = ui.recentMonths(24)
        .concat((ml.list || []).map((m) => m.month))
        .concat([cur])
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort().reverse();"""
mut('A6', [MONTH], [(MONTH, NEW_BLOCK, ALT)], 'GREEN')

# A7 旧实现但用 const 声明（防「只认 let」的侥幸）
OLD_CONST = b"""      const months = (ml.list || []).map((m) => m.month).concat([cur]).sort().reverse();"""
mut('A7', [MONTH], [(MONTH, NEW_BLOCK, OLD_CONST)], 'RED')

# A8 有窗口、有已建档、但完全不去重
NODUP = b"""      const months = ui.recentMonths(24)
        .concat((ml.list || []).map((m) => m.month))
        .concat([cur])
        .filter(Boolean)
        .sort().reverse();"""
mut('A8', [MONTH], [(MONTH, NEW_BLOCK, NODUP)], 'RED')

# A9 去重 + 已建档都在，但窗口函数不调（退回"只有已建档 ∪ 当月"）
NOWIN = b"""      const months = Array.from(new Set(
        (ml.list || []).map((m) => m.month).concat([cur]).filter(Boolean)
      )).sort().reverse();"""
mut('A9', [MONTH], [(MONTH, NEW_BLOCK, NOWIN)], 'RED')

print('\n===== 汇总 =====')
bad = sum(1 for r in RES if r[4] != 'OK')
for r in RES:
    print('  %-5s %-11s %-6s 期望=%-6s %s' % r)
print('共 %d 组，异常 %d 组' % (len(RES), bad))
