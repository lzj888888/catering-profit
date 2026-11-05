# -*- coding: utf-8 -*-
"""把队列 #100 标为 done（R576 已落地）。本文件为 CRLF ⇒ 全程二进制，不许翻写换行。"""
import sys

P = 'review/AUTO_QUEUE.md'
NUM = '100'
APPEND = (' ⇒ **R576 已落地**：M2 在 `restoreDraft()` 之后用 M1 **上一月** `fixed_items_fen` 只填**空**字段'
          '（缺项不填、无 `account_id` 不填、失败静默），并以其 `income_total_fen` 对本次保本额出缺口卡'
          '（差/超两态，不做好坏评级、无付费承诺）；与 R128 的边界是**数据来源**（自己店的真实数 vs 行业参考值），'
          '实现上刻意不碰 `applyRefAmount`。第 223 套件 `check_m2_m1_prefill` 20 断言 + 变异回灌。')

b = open(P, 'rb').read()
crlf0 = b.count(b'\r\n')
s = b.decode('utf-8')
lines = s.split('\r\n')

hit = 0
for i, l in enumerate(lines):
    if l.startswith('| ' + NUM + ' |'):
        c = l.split('|')
        if len(c) != 7:
            print('❌ 行结构异常（split 后 %d 段，应为 7），中止' % len(c))
            sys.exit(1)
        if c[3].strip() == 'done':
            print('已是 done，跳过')
            sys.exit(0)
        c[3] = ' done '
        c[4] = ' no '
        c[5] = c[5].rstrip() + APPEND
        lines[i] = '|'.join(c)
        hit += 1
if hit != 1:
    print('❌ 命中 %d 行（应为 1），中止' % hit)
    sys.exit(1)

data = '\r\n'.join(lines).encode('utf-8')
assert data.count(b'\r\n') == crlf0, 'CRLF 数量变化 %d → %d' % (crlf0, data.count(b'\r\n'))
open(P, 'wb').write(data)     # 先编码后开文件（R576 事故教训）
print('#100 → done | CRLF 保持 =', open(P, 'rb').read().count(b'\r\n') == crlf0)
