# -*- coding: utf-8 -*-
"""把队列 #102 从 todo 改为 blocked（部分落地 + 剩余部分需拍板）。

不标 done 的理由（诚实优先于完成度）：
  「两种并存」必须定"谁算收入"的优先级，而 R505 是李老师 2026-10-26 拍板的口径
  （只用结算金额算、用营业额会虚高）。自定优先级＝改口径，超出我的权限。
本文件 CRLF ⇒ 二进制读写，不许翻写换行。
"""
import sys

P = 'review/AUTO_QUEUE.md'
NUM = '102'
APPEND = (' ⚠️ **R576 部分落地**：`takeawayMode.netHint` 补了一句解释（「你在后台看到的营业额更高 —— '
          '高的那一截就是平台抽成 + 你贴的补贴，不用再抄一遍」），不诱导填营业额、不碰任何口径。'
          '**剩余「两种并存」不能自决**：允许 net/gross 同时填，就必须回答"哪个算收入"，'
          '而 R505（李老师 2026-10-26 拍板）定的是「只用结算金额算、用营业额会虚高」⇒ 自定优先级就是改口径。'
          '需李老师一句话选：① 净额优先、gross 只做核对与差额提示（不改利润）；'
          '② 净额为空时才用 gross 推算（引入估算，需在界面标明"推算值"）；③ 维持二选一不动。')

b = open(P, 'rb').read()
crlf0 = b.count(b'\r\n')
lines = b.decode('utf-8').split('\r\n')

hit = 0
for i, l in enumerate(lines):
    if l.startswith('| ' + NUM + ' |'):
        c = l.split('|')
        if len(c) != 7:
            print('❌ 行结构异常（%d 段），中止' % len(c))
            sys.exit(1)
        c[3] = ' blocked '
        c[4] = ' yes '
        c[5] = c[5].rstrip() + APPEND
        lines[i] = '|'.join(c)
        hit += 1
if hit != 1:
    print('❌ 命中 %d 行（应为 1），中止' % hit)
    sys.exit(1)

data = '\r\n'.join(lines).encode('utf-8')
assert data.count(b'\r\n') == crlf0, 'CRLF 变化 %d → %d' % (crlf0, data.count(b'\r\n'))
open(P, 'wb').write(data)     # 先编码后开文件
print('#102 → blocked | CRLF 保持 =', open(P, 'rb').read().count(b'\r\n') == crlf0)
