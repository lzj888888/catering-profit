# -*- coding: utf-8 -*-
"""登记第 224 个套件（四处同步）。verify_all.js 与 ★知识存储点 都是 CRLF。"""
import sys

VA = 'verify_all.js'
ZS = 'specs/dev-specs/★知识存储点_2026-09-10.md'

raw = open(VA, 'rb').read()
crlf0 = raw.count(b'\r\n')
nl = '\r\n' if crlf0 > 0 else '\n'
lines = raw.decode('utf-8').split(nl)

hit = 0
for i, l in enumerate(lines):
    if '// 串联：223 个套件' in l:
        lines[i] = l.replace('223', '224')
        hit += 1
if hit != 1:
    print('❌ 头注命中 %d 次' % hit)
    sys.exit(1)

INS = [
    "  // ===== R578 / 队列 #101：月度录入完成度（零采集，两司一致建议的合规路线）",
    "  //   守四类静默失效：① 把「填 0」当成没填（免租期是真实情形，误催会让老板觉得系统瞎报）；",
    "  //   ② 组名缺失时回落成英文 key（dine_in 出现在界面 = 事故）；",
    "  //   ③ 核心组清单与 terms 的 core:true 漂移；④ 被接进保存流程变成硬拦（本功能只提示不阻断）。",
    "  ['录入完成度守卫 R578', 'tools/check_entry_completion.js'],",
]
done = False
for i, l in enumerate(lines):
    if l.strip() == '];' and i > 0 and 'check_m2_m1_prefill' in lines[i - 1]:
        lines[i:i] = INS
        done = True
        break
if not done:
    print('❌ 找不到 SUITES 结尾')
    sys.exit(1)

data = nl.join(lines).encode('utf-8')
open(VA, 'wb').write(data)
b2 = open(VA, 'rb').read()
print('verify_all: 224 =', '// 串联：224 个套件' in b2.decode('utf-8'),
      '| 已登记 =', b'check_entry_completion' in b2,
      '| CRLF %d → %d' % (crlf0, b2.count(b'\r\n')))

b = open(ZS, 'rb').read()
cz = b.count(b'\r\n')
t = b.decode('utf-8')
for old, new in [('串 **223** 个套件', '串 **224** 个套件'), ('（现 **223**', '（现 **224**')]:
    n = t.count(old)
    print('%-20s 命中 %d' % (old, n))
    if n != 1:
        print('❌ 中止')
        sys.exit(1)
for old, new in [('串 **223** 个套件', '串 **224** 个套件'), ('（现 **223**', '（现 **224**')]:
    t = t.replace(old, new)
out = t.encode('utf-8')
assert out.count(b'\r\n') == cz, 'CRLF 变化'
open(ZS, 'wb').write(out)
print('知识存储点已改 | CRLF 保持 =', out.count(b'\r\n') == cz)
