# -*- coding: utf-8 -*-
"""round85 M5b：修正锚点行尾（规范文件是 LF 不是 CRLF）后重跑「删一行表格」变异。"""
import subprocess, os

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SPEC = os.path.join(ROOT, r'specs\dev-specs\core\开发规范v1.0_ModuleA_收入费用核算.md')
OUT = os.path.join(ROOT, r'review\evidence\selfdrive_20260922_r85\mutation_r85b.txt')

with open(SPEC, 'rb') as f:
    snap = f.read()

def run_guard():
    r = subprocess.run(['node', os.path.join('tools', 'check_waimai_spec_sync.js')],
                       cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    txt = (r.stdout or '') + (r.stderr or '')
    last = [l for l in txt.splitlines() if '通过 /' in l]
    return r.returncode, (last[-1].strip() if last else txt.strip()[-200:])

lines = []
def log(s):
    print(s); lines.append(s)

rc0, t0 = run_guard()
log('BASELINE rc=%d %s' % (rc0, t0))

ANCHOR = '| 4 | 其他外卖 | 同上（私域自配送等归此，或按 A.1「私域外卖」单列） |\n'
log('anchor present(LF) = %s' % (ANCHOR.encode('utf-8') in snap))

with open(SPEC, 'wb') as f:
    f.write(snap.replace(ANCHOR.encode('utf-8'), b'', 1))
rc1, t1 = run_guard()
actual = 'GREEN' if rc1 == 0 else 'RED'
log('M5b  %s  expect=RED actual=%s | rc=%d %s' % ('OK' if actual == 'RED' else 'MISMATCH', actual, rc1, t1))

with open(SPEC, 'wb') as f:
    f.write(snap)
rc2, t2 = run_guard()
log('RESTORED rc=%d %s' % (rc2, t2))
log('ABNORMAL=%d' % (0 if (rc0 == 0 and actual == 'RED' and rc2 == 0) else 1))

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('WROTE ' + OUT)
