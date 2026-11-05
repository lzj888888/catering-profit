# -*- coding: utf-8 -*-
"""把队列 #109 / #110 标为 done（李老师「做下一步计划并执行」= 已授权）。

约束：
  · 本文件是 **CRLF**，全程二进制读写，不许把换行改掉（本仓 §8 红线）；
  · 只在备注**末尾追加**，不改写原有论证；
  · 先校验每行 split('|') 后正好 7 段，否则中止（防备注里含管道符把表结构切坏）。
"""
import sys

P = 'review/AUTO_QUEUE.md'
APPEND = {
    '109': ' ⇒ **R575 已落地**：`parseDishSales` 出 `periodFrom/periodTo/granularity`；'
           '`importSalesBill/index.js` 三处落库（账单/堂食/外卖商品）**全部**带 `granularity/period_from/period_to`'
           '（守卫 6-⑦ 用真删第三处的变异实证有分辨力）；旧行无字段 ⇒ 读侧按 unknown 处理、不重导不回滚。',
    '110': ' ⇒ **R575 已落地**：`getDishReview` 出参 `range` 增 `covered_days/has_interval/has_unknown`'
           '（`coverageStats` 纯函数，区间并集算真实覆盖天数）；复盘页三条文案分支走 terms 双副本（md5 全等）。',
}

b = open(P, 'rb').read()
s = b.decode('utf-8')
lines = s.split('\n')
hit = 0
for i, l in enumerate(lines):
    for num, extra in APPEND.items():
        if l.startswith('| ' + num + ' |'):
            c = l.split('|')
            if len(c) != 7:
                print('❌ #%s 行结构异常（split 后 %d 段，应为 7），中止不改文件' % (num, len(c)))
                sys.exit(1)
            if c[3].strip() == 'done':
                print('#%s 已是 done，跳过' % num)
                continue
            c[3] = ' done '
            c[4] = ' no '
            c[5] = c[5].rstrip() + extra
            lines[i] = '|'.join(c)
            hit += 1
            print('#%s → done（备注 +%d 字）' % (num, len(extra)))

if hit != 2:
    print('❌ 命中 %d 行（应为 2），中止不改文件' % hit)
    sys.exit(1)

out = '\n'.join(lines).encode('utf-8')
# 换行符保持校验：原文件的 \r\n 数应与新文件一致
if out.count(b'\r\n') != b.count(b'\r\n'):
    print('❌ CRLF 数量变化 %d → %d，中止' % (b.count(b'\r\n'), out.count(b'\r\n')))
    sys.exit(1)
open(P, 'wb').write(out)
print('已写入；CRLF 保持 =', out.count(b'\r\n') == b.count(b'\r\n'))
