# -*- coding: utf-8 -*-
"""R298 · B2 变异回灌：证明 check_money_precision 有分辨力
纪律：每条变异独立施加 → 跑守卫 → 期望判定 → 字节级还原（md5 比对）。
"""
import os, sys, hashlib, subprocess

def find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        p = os.path.dirname(d)
        if p == d:
            raise RuntimeError('未找到仓根')
        d = p

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))
NODE = 'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
GUARD = 'tools/check_money_precision.js'

def md5(rel):
    return hashlib.md5(open(os.path.join(ROOT, rel), 'rb').read()).hexdigest()

FILES = [
    'cloudfunctions/common/money.js',
    'utils/api.js',
    'cloudfunctions/calcBom/service.js',
    'cloudfunctions/saveCostCard/service.js',
    'cloudfunctions/syncCostCard/service.js',
    'cloudfunctions/calcBom/validate.js',
    'cloudfunctions/saveCostCard/validate.js',
    'pages/card/edit.js',
]
BASE = {f: md5(f) for f in FILES}

MUT = []
def add(tag, rel, old, new, expect_red, expect_sub):
    MUT.append(dict(tag=tag, rel=rel, old=old, new=new, expect_red=expect_red, expect_sub=expect_sub))

# ---------- 组 A：应转红（且点名到预期断言） ----------
add('M1 单源 money.yuanToFen 退回裸写', 'cloudfunctions/common/money.js',
    'Math.round(Number((yuan * 100).toFixed(10)))', 'Math.round(yuan * 100)', True, 'C-③')
add('M2 前端 api.yuanToFen 退回裸写', 'utils/api.js',
    'Math.round(Number((n * 100).toFixed(10)))', 'Math.round(n * 100)', True, 'B-①')
add('M3 calcBom 明细合计退回裸写', 'cloudfunctions/calcBom/service.js',
    'const materialTotalFen = Math.round(Number((detailSumYuan * 100).toFixed(10)));',
    'const materialTotalFen = Math.round(detailSumYuan * 100);', True, 'C-')
add('M4 saveCostCard/validate 辅料退回裸写', 'cloudfunctions/saveCostCard/validate.js',
    "    : (typeof card.auxYuan === 'number' ? Math.round(Number((card.auxYuan * 100).toFixed(10))) : 0);",
    "    : (typeof card.auxYuan === 'number' ? Math.round(card.auxYuan * 100) : 0);", True, 'C-①')
add('M5 前端 edit.js 售价退回裸写', 'pages/card/edit.js',
    '        priceFen: Math.round(Number((priceYuan * 100).toFixed(10))),',
    '        priceFen: Math.round(priceYuan * 100),', True, 'C-①')
add('M6 syncCostCard 单份成本退回裸写', 'cloudfunctions/syncCostCard/service.js',
    '  let unitCostFen = Math.round(Number((rawTotalYuan * 100).toFixed(10)));',
    '  let unitCostFen = Math.round(rawTotalYuan * 100);', True, 'C-②')
add('M7 删掉前端 yuanToFen（解析失败）', 'utils/api.js',
    '  yuanToFen(yuanInput) {', '  yuanToFenRenamed(yuanInput) {', True, 'S-③')

# ---------- 组 B：如期保持绿（等价改写 / 纯注释） ----------
add('N1 单源加纯注释', 'cloudfunctions/common/money.js',
    '// 分 → 元（展示用）。必须整数分。',
    '// 分 → 元（展示用）。必须整数分。（R298 变异用注释，无语义）', False, '')
add('N2 单源等价改写（空格变体）', 'cloudfunctions/common/money.js',
    'Math.round(Number((yuan * 100).toFixed(10)))',
    'Math.round( Number( (yuan * 100).toFixed(10) ) )', False, '')

def run_guard():
    p = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True)
    out = p.stdout.decode('utf-8', 'replace') + p.stderr.decode('utf-8', 'replace')
    return p.returncode, out

def restore():
    for f in FILES:
        cur = md5(f)
        if cur == BASE[f]:
            continue
        raise RuntimeError('⚠️ 无备份可还原：%s（本脚本应在**未提交**工作树上用 git 还原）' % f)

ok_n = 0
bad = []
print('=' * 96)
print('R298 · B2 变异回灌（%d 条）' % len(MUT))
print('=' * 96)
for i, m in enumerate(MUT, 1):
    p = os.path.join(ROOT, m['rel'])
    raw = open(p, 'rb').read()
    s = raw.decode('utf-8')
    n = s.count(m['old'])
    if n != 1:
        print('[%2d] [SKIP] %-44s 锚点命中=%d（须 1）' % (i, m['tag'], n))
        bad.append(m['tag'] + '（锚点未命中）')
        continue
    open(p, 'wb').write(s.replace(m['old'], m['new'], 1).encode('utf-8'))
    try:
        rc, out = run_guard()
    finally:
        open(p, 'wb').write(raw)   # 立即还原
    red = (rc != 0)
    hit = [l.strip() for l in out.split('\n') if l.strip().startswith('❌')]
    if m['expect_red']:
        good = red and any(m['expect_sub'] in l for l in hit)
    else:
        good = (not red)
    if good:
        ok_n += 1
    else:
        bad.append(m['tag'])
    print('[%2d] %s %-46s rc=%d 红=%s' % (i, 'OK  ' if good else 'FAIL', m['tag'], rc, red))
    if hit:
        print('       首个 ❌：%s' % hit[0][:170])
    if m['expect_red'] and not good:
        print('       期望点位含「%s」—— 实际 ❌ 行：%s' % (m['expect_sub'], ' ｜ '.join(h[:110] for h in hit[:4]) or '(无红行)'))

print()
print('=' * 96)
# 字节级还原校验
diff = [f for f in FILES if md5(f) != BASE[f]]
print('还原校验：%d 个文件 md5 全等 = %s' % (len(FILES), (not diff)))
if diff:
    print('  未还原：', diff)
print('结果：%d/%d 如期；未如期：%s' % (ok_n, len(MUT), ', '.join(bad) or '无'))
sys.exit(0 if (not bad and not diff) else 1)
