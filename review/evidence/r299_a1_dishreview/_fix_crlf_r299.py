# -*- coding: utf-8 -*-
"""R299-A1① 修复：把 specs 的 ★知识存储点 从 CRLF 被误翻成 LF 的整文件重写救回。
纪律：以 HEAD~1 的**原始字节**为基准（该 blob 是 CRLF），只重放 4 处既定文字改动。
"""
import subprocess
import io

P = 'specs/dev-specs/★知识存储点_2026-09-10.md'

raw = subprocess.run(['git', 'show', 'HEAD~1:' + P], capture_output=True).stdout
s = raw.decode('utf-8')
assert '\r\n' in s, 'HEAD~1 的 blob 里没有 CRLF —— 前提不成立，中止'
crlf_cnt = s.count('\r\n')
lf_only = s.count('\n') - crlf_cnt
print('HEAD~1 blob: CRLF=%d  纯LF=%d' % (crlf_cnt, lf_only))
assert lf_only == 0, '原文混有纯 LF 行 → 不能整体按 CRLF 处理，中止'

REPS = [
    ('`check_dishreview_engine`=107', '`check_dishreview_engine`=109'),
    ('`check_shop_reset`=52', '`check_shop_reset`=53'),
    ('串 **177** 个套件（R298 新增',
     '串 **178** 个套件（R299 新增「云函数出参 `truncated` 消费面」`tools/check_truncated_surfaced.js`：'
     '生产者面从 `ok({...})` 实扫（含简写属性 `truncated,`）+ 契约面守 `dataAdapter` 的'
     '「必须透传 / 可见降级」原话 + 消费面 **fail-closed 登记表**（未消费未登记即判红、'
     '登记表无僵尸键与空转键）+ 反恒真与三个真消费点正样本；R298 新增'),
    ('现 **177**；2026-09-17', '现 **178**；2026-09-17'),
]

for a, b in REPS:
    n = s.count(a)
    assert n == 1, '替换串命中 %d 处（要求恰 1）：%s' % (n, a[:40])
    s = s.replace(a, b)

with open(P, 'wb') as f:
    f.write(s.encode('utf-8'))

print('written. CRLF=%d  纯LF=%d' % (s.count('\r\n'), s.count('\n') - s.count('\r\n')))
