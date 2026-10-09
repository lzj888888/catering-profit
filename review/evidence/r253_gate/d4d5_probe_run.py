# -*- coding: utf-8 -*-
"""R253 探针：D4/D5 的 A2/A3 变异是否产生可观测行为差异。
基线跑一次 + 变异跑一次，逐行 diff => 若无差异 => D4/D5 是意图断言（无辨识力）。"""
import subprocess, os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'
PROBE = os.path.join(ROOT, 'review', 'evidence', 'r253_gate', 'd4d5_probe.js')
BILL = os.path.join(ROOT, 'utils', 'billParse.js')

MUTS = [
    ('A2 行级去显式比较',
     '    if (p === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: i };\r\n'
     '    if (p) return { platform: p, headerRow: i };',
     '    if (p) return { platform: p, headerRow: i };'),
    ('A3 矩阵级去显式比较',
     '    if (hit && hit.platform === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: hit.headerRow, sheet: name };\r\n'
     '    if (hit) return { platform: hit.platform, headerRow: hit.headerRow, sheet: name };',
     '    if (hit) return { platform: hit.platform, headerRow: hit.headerRow, sheet: name };'),
]


def run_probe():
    r = subprocess.run([NODE, PROBE, ROOT], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return (r.stdout or '') + (r.stderr or '')


base_bytes = open(BILL, 'rb').read()
base_out = run_probe()
print('=== 基线 ===')
print(base_out)
for name, old, new in MUTS:
    src = base_bytes.decode('utf-8')
    assert src.count(old) == 1, ('锚点 %d 次: %s' % (src.count(old), name))
    open(BILL, 'wb').write(src.replace(old, new).encode('utf-8'))
    out = run_probe()
    same = (out == base_out)
    print('=== %s ===  %s' % (name, '行为完全相同（无辨识力）' if same else '行为有差异'))
    if not same:
        for a, b in zip(base_out.splitlines(), out.splitlines()):
            if a != b:
                print('  基线: ' + a)
                print('  变异: ' + b)
    open(BILL, 'wb').write(base_bytes)
print('已还原')
