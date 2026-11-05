# -*- coding: utf-8 -*-
"""R601 提审期交易闸门 · 真变异（不是影子字符串自证）

三个变异，每个都必须让 check_paywall_coverage.js 变红：
  M1 删掉 openPaywall 函数体内的闸门        -> L9-② 红
  M2 把关闭态文案改成「请联系客服开通」      -> L9-③ 红
  M3 删掉 orders.onRenew 的闸门             -> L9-④b 红

纪律：SIGTERM/SIGINT 下 finally 不执行 => 显式还原当前文件再退出（R299 教训）。
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PW = os.path.join(ROOT, 'utils', 'paywall.js')
ORDERS = os.path.join(ROOT, 'subpkg', 'tools', 'pay', 'orders.js')
TERMS = os.path.join(ROOT, 'miniprogram', 'i18n', 'terms.js')
GUARD = os.path.join(ROOT, 'tools', 'check_paywall_coverage.js')

_current = None
_backup = None


def md5(p):
    with open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def restore():
    global _current, _backup
    if _current and _backup is not None:
        with open(_current, 'wb') as f:
            f.write(_backup)
        _current, _backup = None, None


def sig_handler(signum, frame):
    restore()
    print('!! 收到信号 %s，已还原文件后退出' % signum)
    sys.exit(2)


import signal
signal.signal(signal.SIGTERM, sig_handler)
signal.signal(signal.SIGINT, sig_handler)


def run_guard():
    p = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    return p.returncode, out


def mutate(path, old, new, label, expect_red):
    global _current, _backup
    raw = open(path, 'rb').read()
    before = md5(path)
    _backup = raw
    _current = path
    text = raw.decode('utf-8')
    if text.count(old) != 1:
        print('SKIP %s：锚点出现 %d 次（应为 1）' % (label, text.count(old)))
        restore()
        return False
    with open(path, 'wb') as f:
        f.write(text.replace(old, new).encode('utf-8'))
    rc, out = run_guard()
    restore()
    after = md5(path)
    red_lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith('❌')]
    ok = (rc != 0) == expect_red and before == after
    print('%s %s：rc=%s（期望%s）还原md5一致=%s' % ('PASS' if ok else 'FAIL', label, rc,
                                                '非0' if expect_red else '0', before == after))
    if red_lines:
        print('     红项：' + ' | '.join(red_lines[:3]))
    return ok


def main():
    results = []

    results.append(mutate(
        PW,
        "  if (!PAYWALL_ENABLED) return showNotOpen();\n  // R45",
        "  // R45",
        'M1 删 openPaywall 闸门',
        True))

    results.append(mutate(
        TERMS,
        "    notOpenBody: '该功能还在完善，将在后续版本开放。成本卡、原料库与月度核算可正常使用。',",
        "    notOpenBody: '请联系客服开通。',",
        'M2 关闭态文案诱导客服',
        True))

    results.append(mutate(
        ORDERS,
        "    if (!PAYWALL_ENABLED) return showNotOpen();\n",
        "",
        'M3 删 onRenew 闸门',
        True))

    print('\n===== 变异结果：%d/%d 符合预期 =====' % (sum(1 for r in results if r), len(results)))
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
