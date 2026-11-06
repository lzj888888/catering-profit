# R615 审计收口 · 变异复核：把四处修复逐个改坏 ⇒ 验证探针必须转红
# 用法：python review/evidence/m2_audit_20261106/_mutation_verify.py
import io, os, subprocess, hashlib, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TARGETS = {
    'matrix.js': os.path.join(ROOT, 'subpkg/tools/sandbox/matrix.js'),
    'openCash.js': os.path.join(ROOT, 'utils/openCash.js'),
    'matrix.wxml': os.path.join(ROOT, 'subpkg/tools/sandbox/matrix.wxml'),
}
ORIG = {k: io.open(v, 'rb').read() for k, v in TARGETS.items()}
H0 = {k: hashlib.md5(v).hexdigest() for k, v in ORIG.items()}
PROBE = os.path.join(os.path.dirname(__file__), '_probe_fix_verify.js')

MUT = [
    ('P5 删掉空档跳过', 'matrix.js',
     b"      if ([r, l, m, tg].some((x) => x === '' || x === null || x === undefined)) continue;\n",
     b"", 'V1'),
    ('P4 不调用差分回填', 'matrix.js',
     b"      rows = this.applyLeverByDiff(rows);",
     b"      // rows = this.applyLeverByDiff(rows);", 'V2'),
    ('P9 现金卡不读老板填的装修', 'openCash.js',
     b"const decorFen = num(c.decorFen) > 0 ? num(c.decorFen) : Math.round(area * decorUnit);",
     b"const decorFen = Math.round(area * decorUnit);", 'V3'),
    ('P11 组合数改回直渲模板', 'matrix.wxml',
     b'<text class="count">{{countText}}</text>',
     b'<text class="count">{{t.count}}</text>', 'V4'),
]


def run_probe():
    r = subprocess.run(['node', PROBE], cwd=ROOT, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=180)
    return r.returncode, r.stdout.decode('utf-8', 'replace')


def restore():
    for k, v in TARGETS.items():
        io.open(v, 'wb').write(ORIG[k])
    for k, v in TARGETS.items():
        assert hashlib.md5(io.open(v, 'rb').read()).hexdigest() == H0[k], '还原失败: ' + k


rc0, out0 = run_probe()
print('基线探针 RC=%d（应为 0）' % rc0)
assert rc0 == 0, '基线不绿，变异无意义'
hits = 0
try:
    for name, key, old, new, group in MUT:
        s = ORIG[key]
        assert s.count(old) == 1, '变异锚点未唯一命中: %s (%d)' % (name, s.count(old))
        io.open(TARGETS[key], 'wb').write(s.replace(old, new, 1))
        rc, out = run_probe()
        # 该组的 [FAIL] 必须出现
        red = rc != 0 and ('[FAIL] ' + group) in out
        print('  %s ⇒ RC=%d, %s 组报红=%s  %s' % (name, rc, group, red, 'OK' if red else '❌ 假绿'))
        if red:
            hits += 1
        restore()
finally:
    restore()

rc_end, _ = run_probe()
print('\n还原后探针 RC=%d（应为 0）' % rc_end)
print('变异复核：%d/%d 真命中' % (hits, len(MUT)))
assert hits == len(MUT), '有变异没被抓到 ⇒ 探针恒绿'
assert rc_end == 0, '还原后基线未恢复'
print('PASS 变异复核全部通过，源码已逐字节还原')
