# -*- coding: utf-8 -*-
"""R298·B3 变异回灌：对 cloudfunctions/exportData/index.js 做 6 组**真实文件级**变异，
证明 tools/check_export_roundtrip.js 的判据真的有分辨力（不是假绿 / 不是恒真）。

纪律（承 B2 `mut_backfill_b2b.py`）：
  · 每组先记目标文件 md5 → 用**字节级**替换（其余字节一个不动）→ 跑守卫取 RC + 失败断言名
  · 跑完**按原始字节**还原 → 复核 md5 必须完全一致
  · 全程纯 LF / 字节替换 ⇒ 不引入 CRLF 与整文件翻写

变异组与**预期**：
  MB1 bookType xlsx→csv      ⇒ A2 红（PK 魔数，证明「真产物形态」判据有效）
  MB2 rows 少最后一行        ⇒ A4/A7 红（**「少行不报错」正是给会计的错账**，ME 的核心场景）
  MB3 金额写成字符串         ⇒ A6/B1 红（会计 SUM 得 0 的那种）
  MB4 yuan 偏 0.5 分         ⇒ C1/C2 红（值保真判据确实在比数，不是比结构）
  MB5 工作表名截成 2 字      ⇒ A3/D2 红（表名守恒）
  MB6 纯排版加空格（反证）   ⇒ **必须保持绿**（判据不脆，不做字面量绑定）
"""
import hashlib
import io
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/'
TARGET = ROOT + 'cloudfunctions/exportData/index.js'
GUARD = 'tools/check_export_roundtrip.js'
NODE = 'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'


def md5b(b):
    return hashlib.md5(b).hexdigest()


def run_guard():
    p = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True)
    out = p.stdout.decode('utf-8', 'replace') + p.stderr.decode('utf-8', 'replace')
    fails = re.findall(r'❌ ([^·\n]+)', out)
    tail = [l for l in out.splitlines() if '守卫结果' in l]
    return p.returncode, [f.strip() for f in fails], (tail[-1].strip() if tail else '')


MB = [
    ('MB1 bookType xlsx→csv',
     "return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });",
     "return XLSX.write(wb, { type: 'base64', bookType: 'csv' });",
     'RED'),
    ('MB2 rows 少最后一行（静默少行）',
     "const aoa = [s.header].concat((s.rows || []).map((r) =>",
     "const aoa = [s.header].concat((s.rows || []).slice(0, -1).map((r) =>",
     'RED'),
    ('MB3 金额写成字符串（会计 SUM 得 0）',
     "r.map((v) => (typeof v === 'number' ? v : String(v == null ? '' : v)))",
     "r.map((v) => String(v == null ? '' : v))",
     'RED'),
    ('MB4 yuan 偏 0.5 分（值保真）',
     "function yuan(fen) { return Math.round(Number(fen) || 0) / 100; }",
     "function yuan(fen) { return Math.round(Number(fen) || 0) / 100 + 0.005; }",
     'RED'),
    ('MB5 工作表名截成 2 字',
     "String(s.name || 'Sheet1').slice(0, 31)",
     "String(s.name || 'Sheet1').slice(0, 2)",
     'RED'),
    ('MB6 纯排版加空格（反证：必须保持绿）',
     "function yuan(fen) { return Math.round(Number(fen) || 0) / 100; }",
     "function yuan( fen ) {  return Math.round( Number(fen) || 0 ) / 100 ;  }",
     'GREEN'),
]

orig = io.open(TARGET, 'rb').read()
orig_md5 = md5b(orig)
print('目标 = cloudfunctions/exportData/index.js')
print('原始 md5 = ' + orig_md5 + '  字节 ' + str(len(orig)))
print('基线：先跑一次守卫确认起点是绿的')
rc0, f0, t0 = run_guard()
print('  基线 RC=%d 失败=%d  %s' % (rc0, len(f0), t0))
if rc0 != 0:
    print('❌ 基线不是绿的，变异回灌无意义 ⇒ 中止')
    for x in f0:
        print('   ❌ ' + x)
    sys.exit(1)

results = []
for name, old, new, expect in MB:
    ob, nb = old.encode('utf-8'), new.encode('utf-8')
    cnt = orig.count(ob)
    if cnt != 1:
        results.append((name, expect, 'ANCHOR-MISS(%d)' % cnt, [], '锚点命中 %d 次' % cnt))
        continue
    mutated = orig.replace(ob, nb, 1)
    io.open(TARGET, 'wb').write(mutated)
    rc, fails, tail = run_guard()
    io.open(TARGET, 'wb').write(orig)          # 按原始字节还原
    back = md5b(io.open(TARGET, 'rb').read())
    ok_restore = (back == orig_md5)
    got = 'RED' if rc != 0 else 'GREEN'
    verdict = 'PASS' if (got == expect and ok_restore) else 'FAIL'
    results.append((name, expect, got, fails, ('RC=%d 还原md5=%s' % (rc, 'OK' if ok_restore else 'BAD')) + ' | ' + tail))
    print('\n--- %s ---' % name)
    print('  期望=%s 实得=%s ⇒ %s' % (expect, got, verdict))
    print('  ' + results[-1][4])
    if fails:
        print('  失败断言（前 5）：')
        for x in fails[:5]:
            print('    ❌ ' + x)

final = md5b(io.open(TARGET, 'rb').read())
print('\n===== 变异回灌汇总 =====')
p = 0
for name, expect, got, fails, info in results:
    ok = (got == expect)
    p += 1 if ok else 0
    print(('  ✅ ' if ok else '  ❌ ') + name + ' ：期望 ' + expect + ' / 实得 ' + got)
print('通过 %d / %d' % (p, len(results)))
print('最终 md5 = ' + final + '  ' + ('≡ 原始（逐字节还原）' if final == orig_md5 else '⚠️ 与原始不一致！'))
sys.exit(0 if p == len(results) and final == orig_md5 else 1)
