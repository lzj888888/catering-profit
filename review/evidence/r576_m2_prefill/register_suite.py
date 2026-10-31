# -*- coding: utf-8 -*-
"""登记第 223 个套件（四处同步）。

约束：
  · verify_all.js 与 ★知识存储点 **都是 CRLF** ⇒ 按行处理、用 CRLF join 回去，绝不混入 LF；
  · SUITES 区**注释禁含方括号**（check_selftest_shape 的配平器不剥注释，一个 ] 就判 SUITES 提前闭合）。
"""
import sys

VA = 'verify_all.js'
ZS = 'specs/dev-specs/★知识存储点_2026-09-10.md'

# ---------- 1. verify_all.js ----------
raw = open(VA, 'rb').read()
crlf0 = raw.count(b'\r\n')
nl_s = '\r\n' if crlf0 > 0 else '\n'
lines = raw.decode('utf-8').split(nl_s)

hit_head = 0
for i, l in enumerate(lines):
    if '// 串联：222 个套件' in l:
        lines[i] = l.replace('222', '223')
        hit_head += 1
if hit_head != 1:
    print('❌ 头注命中 %d 次（应为 1），中止' % hit_head)
    sys.exit(1)

INS = [
    "  // ===== R576 / 队列 #100：M2 用 M1 真实数据预填（页面桩真跑 loadM1Baseline）",
    "  //   守四类静默失效：① 覆盖老板已填的值；② 缺项按 0 填（保本点算低、结论变乐观）；",
    "  //   ③ 没建档的月也预填（getLedger 对无账月返回默认空账，只判有返回值就恒真）；",
    "  //   ④ 把行业参考值也顺手填进来（R128 明令禁止，边界是数据来源而非字段名）。",
    "  //   含变异回灌：删掉 account_id 判据后无档案月必须真的被填，证明判据非常量。",
    "  ['M2 M1 预填守卫 R576', 'tools/check_m2_m1_prefill.js'],",
]
done = False
for i, l in enumerate(lines):
    if l.strip() == '];' and i > 0 and 'check_dish_ingest_contract' in lines[i - 1]:
        lines[i:i] = INS
        done = True
        break
if not done:
    print('❌ 找不到 SUITES 结尾（菜品明细契约守卫 下一行的 ];），中止')
    sys.exit(1)

out = nl_s.join(lines)
data = out.encode('utf-8')          # ⚠️ 必须先编码：open(...,'wb') 一打开就截断，write 失败会留 0 字节文件
open(VA, 'wb').write(data)
b2 = open(VA, 'rb').read()
print('verify_all.js: 头注 223 =', '// 串联：223 个套件' in b2.decode('utf-8'),
      '| 新套件已登记 =', b'check_m2_m1_prefill' in b2,
      '| CRLF %d → %d' % (crlf0, b2.count(b'\r\n')))

# ---------- 2. ★知识存储点（CRLF）----------
b = open(ZS, 'rb').read()
crlf_z = b.count(b'\r\n')
t = b.decode('utf-8')
pairs = [('串 **222** 个套件', '串 **223** 个套件'),
         ('（现 **222**', '（现 **223**')]
for old, new in pairs:
    n = t.count(old)
    print('%-22s 命中 %d' % (old, n))
    if n != 1:
        print('❌ 命中数不为 1，中止')
        sys.exit(1)
for old, new in pairs:
    t = t.replace(old, new)
outz = t.encode('utf-8')
assert outz.count(b'\r\n') == crlf_z, 'CRLF 被改动'
open(ZS, 'wb').write(outz)
print('知识存储点: 两处已改 | CRLF 保持 =', outz.count(b'\r\n') == crlf_z)
