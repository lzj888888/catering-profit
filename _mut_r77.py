# -*- coding: utf-8 -*-
"""round77 独立双向变异回灌（不采信 round75/76 自述的 7/7、4/4、5/5）
还原方式：二进制快照 copy2（byte-exact，规避坑⑳ checkout 反向改行尾）"""
import subprocess, shutil, os, sys, hashlib

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
EVD = os.path.join(ROOT, 'review', 'evidence', 'selfdrive_20260921_r77')
os.makedirs(EVD, exist_ok=True)
NODE = 'node'

RES = []


def rd(p):
    with open(os.path.join(ROOT, p), 'rb') as f:
        return f.read()


def wr(p, b):
    with open(os.path.join(ROOT, p), 'wb') as f:
        f.write(b)


def nl_of(b):
    return b'\r\n' if b.count(b'\r\n') > b.count(b'\n') - b.count(b'\r\n') else b'\n'


def rep(b, frm, to):
    """按文件自身行尾做替换，返回 (newbytes, applied)"""
    nl = nl_of(b)
    f2 = frm.replace(b'\n', nl) if nl == b'\r\n' else frm
    t2 = to.replace(b'\n', nl) if nl == b'\r\n' else to
    if f2 in b:
        return b.replace(f2, t2, 1), True
    if frm in b:
        return b.replace(frm, to, 1), True
    return b, False


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, shell=True,
                       capture_output=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def mut(mid, files, edits, cmd, expect):
    """files: 相对路径列表；edits: [(file, from, to)]；expect: 'RED' / 'GREEN'"""
    snaps = {f: rd(f) for f in files}
    applied = True
    for f, frm, to in edits:
        b = rd(f)
        nb, ok = rep(b, frm, to)
        if not ok:
            applied = False
            print('  !! %s 锚点未命中: %s' % (mid, f))
            break
        wr(f, nb)
    if not applied:
        for f in files:
            wr(f, snaps[f])
        RES.append((mid, 'NOT_APPLIED', '-', expect, 'SKIP'))
        return
    rc, out = run(cmd)
    verdict = 'RED' if rc != 0 else 'GREEN'
    good = (verdict == expect)
    tail = [l for l in out.strip().splitlines() if l.strip()][-3:]
    RES.append((mid, verdict, 'rc=%d' % rc, expect, 'OK' if good else 'MISMATCH'))
    print('  %-6s %-5s rc=%d 期望=%-5s %s' % (mid, verdict, rc, expect, 'OK' if good else '*** MISMATCH ***'))
    for l in tail:
        print('        | ' + l[:150])
    # 还原（byte-exact）
    for f in files:
        wr(f, snaps[f])
    # 校验还原
    for f in files:
        if hashlib.md5(rd(f)).hexdigest() != hashlib.md5(snaps[f]).hexdigest():
            print('  !! 还原失败 %s' % f)


UIJS = 'utils/ui.js'
MONTH = 'pages/month/index.js'
C13 = 'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md'

print('===== A 组：round75 月份下拉滚动窗口（selftest_ui_fix 修 7 段）=====')

OLD_BLOCK = b"""      let months = (ml.list || []).map((m) => m.month);
      if (!months.includes(cur)) months.push(cur);
      months = months.sort().reverse();"""
NEW_BLOCK = b"""      const months = Array.from(new Set(
        ui.recentMonths(24)
          .concat((ml.list || []).map((m) => m.month))
          .concat([cur])
          .filter(Boolean),
      )).sort().reverse();"""

mut('A1', [MONTH], [(MONTH, NEW_BLOCK, OLD_BLOCK)],
    'node tools/selftest_ui_fix.js', 'RED')

mut('A2', [UIJS], [(UIJS, b'm - 1 - i, 15', b'm - 1 - i * 2, 15')],
    'node tools/selftest_ui_fix.js', 'RED')

mut('A3', [UIJS], [(UIJS, b'const cnt = Number(n) > 0 ? Math.floor(Number(n)) : 24;', b'const cnt = 1;')],
    'node tools/selftest_ui_fix.js', 'RED')

mut('A4', [UIJS, MONTH],
    [(UIJS, b'recentMonths(n) {', b'rollingMonths(n) {'),
     (MONTH, b'ui.recentMonths(24)', b'ui.rollingMonths(24)')],
    'node tools/selftest_ui_fix.js', 'GREEN')

mut('A5', [MONTH],
    [(MONTH, b'const months = Array.from(new Set(', b'const months = [...new Set('),
     (MONTH, b'      )).sort().reverse();', b'      ].sort().reverse();')],
    'node tools/selftest_ui_fix.js', 'GREEN')

print('\n===== B 组：R85 新增判据类短语（月份只有两个=设计）=====')
B1_LINE = u'\n月份选择只有两个月份，这是设计不是 bug。\n'
B2_LINE = u'\n曾判：月份选择只有两个月份，这是设计不是 bug。\n'


def append_line(path, line):
    b = rd(path)
    wr(path, b + line.encode('utf-8').replace(b'\n', nl_of(b)))


for mid, line, exp in [('B1', B1_LINE, 'RED'), ('B2', B2_LINE, 'GREEN')]:
    snap = rd(C13)
    append_line(C13, line)
    rc, out = run('node tools/check_stale_claims.js')
    verdict = 'RED' if rc != 0 else 'GREEN'
    good = verdict == exp
    RES.append((mid, verdict, 'rc=%d' % rc, exp, 'OK' if good else 'MISMATCH'))
    print('  %-6s %-5s rc=%d 期望=%-5s %s' % (mid, verdict, rc, exp, 'OK' if good else '*** MISMATCH ***'))
    for l in [x for x in out.strip().splitlines() if '月份' in x][:3]:
        print('        | ' + l.strip()[:150])
    wr(C13, snap)

print('\n===== C 组：R109 状态陈述矛盾守卫（check_stale_status）=====')
TITLE_NEW = u'### 6.（✅ 已闭环 2026-09-19 · round39）写码侧 · 快马：`saveCostCard` 的 `mode` 无白名单 —— R81，**曾挂 4 轮**'
TITLE_OLD = u'### 6. 下一批待修（写码侧 · 快马）：`saveCostCard` 的 `mode` 无白名单 —— R81，本轮正式排进"下一批"'

mut('C1', [C13], [(C13, TITLE_NEW.encode('utf-8'), TITLE_OLD.encode('utf-8'))],
    'node tools/check_stale_status.js', 'RED')

P_CONTRA = 'specs/dev-specs/__mut_r77_contra.md'
P_OK = 'specs/dev-specs/__mut_r77_ok.md'
try:
    wr(P_CONTRA, u'# 变异探针\n\n## 3. 待修：某事项\n- 2026-09-21 已闭环\n'.encode('utf-8'))
    rc, out = run('node tools/check_stale_status.js')
    verdict = 'RED' if rc != 0 else 'GREEN'
    good = verdict == 'RED'
    RES.append(('C2', verdict, 'rc=%d' % rc, 'RED', 'OK' if good else 'MISMATCH'))
    print('  %-6s %-5s rc=%d 期望=RED   %s' % ('C2', verdict, rc, 'OK' if good else '*** MISMATCH ***'))
    os.remove(os.path.join(ROOT, P_CONTRA))

    wr(P_OK, u'# 变异探针\n\n## 3. 待办清单\n- 仍未落\n- 待处置\n'.encode('utf-8'))
    rc, out = run('node tools/check_stale_status.js')
    verdict = 'RED' if rc != 0 else 'GREEN'
    good = verdict == 'GREEN'
    RES.append(('C3', verdict, 'rc=%d' % rc, 'GREEN', 'OK' if good else 'MISMATCH'))
    print('  %-6s %-5s rc=%d 期望=GREEN %s' % ('C3', verdict, rc, 'OK' if good else '*** MISMATCH ***'))
    os.remove(os.path.join(ROOT, P_OK))
finally:
    for p in (P_CONTRA, P_OK):
        fp = os.path.join(ROOT, p)
        if os.path.exists(fp):
            os.remove(fp)

print('\n===== round77 变异回灌汇总 =====')
bad = 0
for mid, v, rc, exp, st in RES:
    print('  %-5s %-6s %-8s 期望=%-6s %s' % (mid, v, rc, exp, st))
    if st != 'OK':
        bad += 1
print('共 %d 组，异常 %d 组' % (len(RES), bad))
