"""_r128_mutation.py —— 对 round128 复核探针做变异回灌（证明探针不是假绿）

做法（全程在单进程内完成，finally 保证还原，绝不留下破坏窗口）：
  1) 读 index.js 原文 → 存内存 + md5
  2) 施加变异 M → 写回
  3) 跑探针 → 期望 rc≠0（探针必须转红）
  4) finally: 还原原文 → md5 核对一致

变异清单（逐个独立施加、逐个还原）：
  M1 把档案行的 filter 去掉（手工行被误当档案行去查库）
  M2 合并时用 manualLines[0] 代替 shift()（交错错位）
  M3 手工行不标 input_type（落库类型丢失）
"""
import io, hashlib, subprocess, sys, os

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
IDX = os.path.join(ROOT, 'cloudfunctions', 'saveCostCard', 'index.js')
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
PROBE = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_m3/_r128_probe.js'


def md5(s):
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def run_probe():
    p = subprocess.run([NODE, PROBE, ROOT], capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=300)
    s = (p.stdout or '') + (p.stderr or '')
    tail = [l for l in s.split('\n') if '复核探针' in l]
    return p.returncode, (tail[-1].strip() if tail else s.strip().split('\n')[-1][:90])


orig = io.open(IDX, encoding='utf-8').read()
h0 = md5(orig)
print('原文件 md5 =', h0, ' 行数 =', len(orig.split('\n')))
print()

MUT = [
    ('M1 去掉档案行 filter（手工行被误当档案行查库）',
     "buildSnapshotLines(card.lines.filter((l) => l.input_type !== 2), materialsById)",
     "buildSnapshotLines(card.lines, materialsById)"),
    ('M2 合并用 manualLines[0] 代替 shift()（交错错位）',
     "mergedLines.push(manualLines.shift());",
     "mergedLines.push(Object.assign({}, manualLines[0]));"),
    ('M3 手工行不标 input_type（落库类型丢失）',
     "      net_unit_cost: nuc,\n      input_type: 2,\n    });",
     "      net_unit_cost: nuc,\n    });"),
]

results = []
try:
    for name, old, new in MUT:
        if old not in orig:
            print('⚠️  %s —— 锚点未命中，跳过（说明源码已变，需人工看）' % name)
            results.append((name, 'ANCHOR_MISS', None))
            continue
        mutated = orig.replace(old, new, 1)
        io.open(IDX, 'w', encoding='utf-8', newline='').write(mutated)
        rc, tail = run_probe()
        verdict = '✅ 探针转红（能抓到）' if rc != 0 else '❌ 探针仍绿（假绿！）'
        print('%-46s rc=%-3d %s\n     %s' % (name, rc, verdict, tail))
        results.append((name, 'RED' if rc != 0 else 'GREEN', tail))
        # 还原
        io.open(IDX, 'w', encoding='utf-8', newline='').write(orig)
        assert md5(io.open(IDX, encoding='utf-8').read()) == h0, '还原失败！'
finally:
    io.open(IDX, 'w', encoding='utf-8', newline='').write(orig)

h1 = md5(io.open(IDX, encoding='utf-8').read())
print()
print('=== 还原核对 ===')
print('  变异前 md5 =', h0)
print('  还原后 md5 =', h1)
print('  ★ 逐字节还原 =', h0 == h1)

# 还原后再跑一次：必须回到全绿，证明还原干净
rc, tail = run_probe()
print()
print('=== 还原后探针复跑（须回到全绿）===')
print('  rc=%d  %s' % (rc, tail))

red = sum(1 for _, v, _ in results if v == 'RED')
print()
print('=== 变异回灌结论 ===')
print('  变异数 = %d  转红数 = %d' % (len(results), red))
print('  ★ 探针有效性 =', '成立（每个变异都能抓到）' if red == len(results) else '不成立，有假绿风险')
