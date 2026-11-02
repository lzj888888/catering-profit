# -*- coding: utf-8 -*-
"""R603 真变异：证明 L9-⑦（关闭态功能可用）与 L9-⑧（前后端同源）不是恒绿装饰。

三个变异：
  M1 删前端 fetchEntitlement 的免费期短路  → L9-⑦ 必须红
  M2 删后端 hasFeature 的免费期短路        → L9-⑦ 必须红
  M3 云端 FREE_ACCESS 改成 false           → L9-⑧ 必须红

纪律：SIGTERM/SIGINT 也显式还原（R299 实证：被打断会留残污，后续变异全"复绿=false"）。
"""
import hashlib
import os
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FE = os.path.join(ROOT, 'utils', 'entitlement.js')
BE = os.path.join(ROOT, 'cloudfunctions', 'common', 'entitlement.js')
PF = os.path.join(ROOT, 'cloudfunctions', 'common', 'payFlags.js')
GUARD = os.path.join(ROOT, 'tools', 'check_paywall_coverage.js')

_pending = []


def _restore_all():
    while _pending:
        path, orig = _pending.pop()
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(orig)


def _on_sig(signum, frame):
    _restore_all()
    sys.exit(1)


signal.signal(signal.SIGTERM, _on_sig)
signal.signal(signal.SIGINT, _on_sig)


def md5(path):
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def run_guard():
    r = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    return r.returncode, (r.stdout or '')


def mutate(path, old, new, label):
    with open(path, encoding='utf-8') as f:
        orig = f.read()
    if old not in orig:
        print('  ❌ %s：锚点不存在，变异无效' % label)
        return False
    _pending.append((path, orig))
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(orig.replace(old, new, 1))
    rc, out = run_guard()
    _restore_all()
    hit = '❌ L9-⑦' in out or '❌ L9-⑧' in out
    ok = (rc != 0) and hit
    print('  %s %s —— rc=%d L9红=%s' % ('✅' if ok else '❌', label, rc, hit))
    return ok


BASE = {p: md5(p) for p in (FE, BE, PF)}
print('基线 md5：前端 %s / 后端 %s / 开关 %s' % (BASE[FE][:8], BASE[BE][:8], BASE[PF][:8]))

FE_SHORT = "  if (FREE_ACCESS_MODE) {\n    return { expire_at: 0, is_active: true, source: 'free_mode', days_left: 0 };\n  }\n"
BE_SHORT = "  if (FREE_ACCESS) return true;\n"

results = [
    mutate(FE, FE_SHORT, '', 'M1 删前端免费期短路'),
    mutate(BE, BE_SHORT, '', 'M2 删后端免费期短路'),
    mutate(PF, 'const FREE_ACCESS = true;', 'const FREE_ACCESS = false;', 'M3 云端开关翻面'),
]

# 还原自证
bad = [p for p in BASE if md5(p) != BASE[p]]
print('还原校验：%s' % ('✅ 三文件 md5 与基线一致' if not bad else '❌ 残留改动 %s' % bad))
print('===== %d/%d 变异按预期判红 =====' % (sum(1 for r in results if r), len(results)))
sys.exit(0 if all(results) and not bad else 1)
