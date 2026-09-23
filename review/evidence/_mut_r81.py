# -*- coding: utf-8 -*-
"""round81 双向变异回灌（R112）—— 字节快照还原，避免坑⑳ autocrlf 反向改行尾"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
while os.path.basename(ROOT) != 'catering-profit':
    ROOT = os.path.dirname(ROOT)
os.chdir(ROOT)

F11 = 'specs/dev-specs/core/11_微信审核自查清单.md'
F13 = 'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md'
GUARD = 'tools/check_audit_redlines.js'
FILES = [F11, F13, GUARD]

snap = {p: open(p, 'rb').read() for p in FILES}


def restore():
    for p, b in snap.items():
        open(p, 'wb').write(b)


def run_guard():
    r = subprocess.run([sys.executable and 'node', GUARD], capture_output=True, text=True,
                       encoding='utf-8', errors='ignore')
    out = r.stdout + r.stderr
    return r.returncode, out


def mut(rel, old, new, cnt=1):
    d = open(rel, 'rb').read()
    o = old.encode('utf-8')
    n = new.encode('utf-8')
    c = d.count(o)
    if c == 0:
        return False, 'ANCHOR_NOT_FOUND'
    d2 = d.replace(o, n, cnt)
    open(rel, 'wb').write(d2)
    return True, c


CASES = []


def case(name, expect_red, apply_fn, note=''):
    CASES.append((name, expect_red, apply_fn, note))


def m_decl_wrong():
    return mut(F11, '本清单共 **6** 条', '本清单共 **7** 条')


def m_decl_reword():
    return mut(F11, '本清单共 **6** 条', '本清单合计 6 条')


def m_row_del():
    return mut(F11, '> 6. 同会话隐私弹窗最多 2 次，拒绝后不骚扰（§2.5）\r\n' if False else
               '> 6. 同会话隐私弹窗最多 2 次，拒绝后不骚扰（§2.5）\n', '')


def m_row_add():
    d = open(F11, 'rb').read()
    old = '> 审核前逐条打勾'.encode('utf-8')
    nl = b'\n' if b'\r\n' not in d else b'\r\n'
    new = ('> 7. 变异注入的第七条硬红线（§变异）' + nl.decode() + '> 审核前逐条打勾').encode('utf-8')
    open(F11, 'wb').write(d.replace(old, new, 1))
    return True, 1


def m_del_decl():
    d = open(F11, 'rb').read()
    nl = b'\n' if b'\r\n' not in d else b'\r\n'
    old = ('🔢 审核硬红线口径（唯一声明处）：本清单共 **6** 条（缺失任一项 = 直接驳回）。').encode('utf-8')
    return mut(F11, old.decode('utf-8'), '（本行已删除口径声明，用于验证 fail-closed）')


def m_ref_wrong():
    return mut(F13, '微信审核硬红线 **6** 条', '微信审核硬红线 **5** 条')


def m_cb_shrink():
    d = open(F13, 'rb').read()
    # core/11 的 §6 勾选在 F11
    d2 = open(F11, 'rb').read()
    nl = b'\n' if b'\r\n' not in d2 else b'\r\n'
    lines = d2.split(nl)
    keep = []
    removed = 0
    for l in lines:
        if l.startswith(b'- [ ]') and removed < 7:
            removed += 1
            continue
        keep.append(l)
    open(F11, 'wb').write(nl.join(keep))
    return True, removed


def m_scan_dir():
    return mut(GUARD, "path.join(ROOT, 'specs', 'dev-specs')",
               "path.join(ROOT, 'specs', 'dev-specs_typo')")


def m_second_unique():
    return mut(F13, '微信审核硬红线 **6** 条', '审核硬红线口径（唯一声明处）：共 **6** 条')


def m_seq_gap():
    return mut(F11, '> 3. 虚拟支付保持关闭', '> 4. 虚拟支付保持关闭')


case('M1 声明 6→7（声明≠实算）', True, m_decl_wrong)
case('M2 正确实现换措辞「合计 6 条」', False, m_decl_reword, '不错杀')
case('M3 §2 删一条（实算≠声明，反向）', True, m_row_del)
case('M4 §2 加第 7 条', True, m_row_add)
case('M5 删唯一声明（fail-closed）', True, m_del_decl)
case('M6 引用行 core/13 写 5', True, m_ref_wrong)
case('M7 §6 勾选删到 4 条（A7-②前提非恒真）', True, m_cb_shrink)
case('M8 扫描面根路径写错（A1-② fail-closed）', True, m_scan_dir)
case('M9 core/13 自称单源（A8 防扩散）', True, m_second_unique)
case('M10 §2 序号跳号 3→4', True, m_seq_gap)

results = []
for name, expect_red, fn, note in CASES:
    restore()
    ok, info = fn()
    if not ok:
        results.append((name, 'NOT_APPLIED', str(info), expect_red))
        restore()
        continue
    rc, out = run_guard()
    red = (rc != 0)
    good = (red == expect_red)
    # 抓关键失败行
    key = [l.strip() for l in out.splitlines() if '❌' in l][:3]
    results.append((name, 'OK' if good else 'MISMATCH', 'rc=%d red=%s' % (rc, red), expect_red, key))
    restore()

# 还原后自检
print('===== round81 R112 双向变异 =====')
for r in results:
    tag = r[1]
    print('%-46s %-12s %s' % (r[0], tag, r[2]))
    if len(r) > 4 and r[4]:
        for k in r[4]:
            print('      %s' % k[:120])

# 还原确认
bad = []
for p, b in snap.items():
    if open(p, 'rb').read() != b:
        bad.append(p)
print('\n还原后字节比对：', 'ALL_OK' if not bad else 'DIFF=' + str(bad))
rc, out = run_guard()
print('还原后守卫 RC =', rc, '|', [l for l in out.splitlines() if '通过 /' in l][-1:])
