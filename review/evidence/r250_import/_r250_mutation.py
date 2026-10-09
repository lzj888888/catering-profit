# -*- coding: utf-8 -*-
"""R250 变异回灌（v2）：自适应行尾（CRLF/LF），证明两个新守卫真能抓到对应缺陷。
铁律：逐条独立、还原后 md5 全等、且还原后复绿。"""
import io, os, sys, hashlib, subprocess

R = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'

SUITES = {
    'bill': 'tools/selftest_bill_parse.js',
    'shape': 'tools/check_shape_machine_value.js',
}

MUTS = [
    ('M1 index.js 退回旧写法（先 guessHeader 选行、再判平台）',
     'cloudfunctions/importSalesBill/index.js',
     '    const hit = detectPlatformInMatrix(matrix);\n    if (hit) platform = hit.platform;',
     "    for (const name of Object.keys(matrix.sheets)) {\n"
     "      const rs = (matrix.sheets[name] || {}).rows || [];\n"
     "      const p = detectPlatform((rs[guessHeader(rs)] || []).map((x) => String(x).trim()));\n"
     "      if (p) { platform = p; break; }\n"
     "    }",
     'bill', 'B3', 1),

    ('M2a utils/billParse.js 平台判定退回「先选表头行」（忠实两级表头样本必挂）',
     'utils/billParse.js',
     '  for (let i = 0; i < n; i++) {\n'
     '    const p = detectPlatform(list[i] || []);\n'
     '    if (p) return { platform: p, headerRow: i };\n'
     '  }\n'
     '  return null;\n'
     '}',
     '  const gi = guessHeader(list);\n'
     '  const p0 = detectPlatform(list[gi] || []);\n'
     '  return p0 ? { platform: p0, headerRow: gi } : null;\n'
     '}',
     'bill', 'A5', 1),

    ('M2b 云端 service.js 平台判定退回旧写法（两副本分叉）',
     'cloudfunctions/importSalesBill/service.js',
     '  for (let i = 0; i < n; i++) {\n'
     '    const p = detectPlatform(list[i] || []);\n'
     '    if (p) return { platform: p, headerRow: i };\n'
     '  }\n'
     '  return null;\n'
     '}',
     '  const gi = guessHeader(list);\n'
     '  const p0 = detectPlatform(list[gi] || []);\n'
     '  return p0 ? { platform: p0, headerRow: gi } : null;\n'
     '}',
     'bill', 'B2', 1),

    ('M3 wxml 删掉两条原因渲染行（回到「回了不读」）',
     'pages/takeaway/index.wxml',
     '      <view class="muted" wx:if="{{importGrade && !importGrade.pass && importFailReason}}">{{importFailReason}}</view>\n',
     '',
     'shape', 'F-④', 2),

    ('M4 页面映射表漏登记一个 code（CHANNEL_EMPTY）',
     'pages/takeaway/index.js',
     "  CHANNEL_EMPTY: 'importFailEmpty',\n",
     '',
     'shape', 'F-①', 1),
]


def md5(p):
    return hashlib.md5(io.open(p, 'rb').read()).hexdigest()


def run(suite):
    r = subprocess.run([NODE, SUITES[suite]], cwd=R, capture_output=True, timeout=300)
    return r.returncode, (r.stdout or b'').decode('utf-8', 'replace') + (r.stderr or b'').decode('utf-8', 'replace')


print('===== base 先绿 =====')
for k in SUITES:
    rc, out = run(k)
    tail = [l.strip() for l in out.splitlines() if '通过 /' in l]
    print('  %-6s RC=%d  %s' % (k, rc, tail[-1] if tail else '?'))
    assert rc == 0, 'base 不是全绿，先修好再来变异'

print('\n===== 逐条变异 =====')
ok_all = True
for label, rel, old, new, suite, expect, cnt in MUTS:
    p = os.path.join(R, rel.replace('/', os.sep))
    orig = io.open(p, 'rb').read()
    m0 = hashlib.md5(orig).hexdigest()
    txt = orig.decode('utf-8')
    # 自适应行尾：LF 优先，再试 CRLF
    variant = None
    for nl in ('\n', '\r\n'):
        o, n = old.replace('\n', nl), new.replace('\n', nl)
        if txt.count(o) == cnt:
            variant = (o, n); break
    if not variant:
        print('  ❌ [%s] 锚点在 LF/CRLF 下都命中不到 %d 次（LF=%d CRLF=%d）⇒ 跳过，未改动任何文件'
              % (label, cnt, txt.count(old), txt.count(old.replace('\n', '\r\n'))))
        ok_all = False
        continue
    o, n = variant
    io.open(p, 'wb').write(txt.replace(o, n).encode('utf-8'))
    try:
        rc, out = run(suite)
    finally:
        io.open(p, 'wb').write(orig)
    red = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
    hit = any(expect in l for l in red)
    restored = (md5(p) == m0)
    rc2, _ = run(suite)
    green = (rc2 == 0)
    verdict = '✅ 有效红' if (rc != 0 and hit and restored and green) else '❌ 无效/异常'
    if verdict.startswith('❌'):
        ok_all = False
    print('  %s [%s]' % (verdict, label))
    print('        变红=%s · 红在目标断言(%s)=%s · 还原md5全等=%s · 复绿=%s' % (rc != 0, expect, hit, restored, green))
    for l in red[:3]:
        print('           %s' % l[:115])

print('\n===== 汇总 =====')
print('  全部变异有效 = %s' % ok_all)
sys.exit(0 if ok_all else 1)
