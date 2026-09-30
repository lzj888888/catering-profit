# -*- coding: utf-8 -*-
"""拼装「续做」载荷：短指令 + 原始 M3.17 全文（保证零遗漏）。"""
import io, os

BASE = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
orig = io.open(os.path.join(BASE, 'feed_m317.txt'), encoding='utf-8').read()

head = """【继续 · M3.17 外卖单均 + M3.32 外卖补丁】上轮被余额中断，接着做，别从头重来

你上一轮的进度：`selftest_m3_takeaway` 已 21/0 全绿，正开始接 `shop_switch`（平台参数默认值的读写）时，
账户余额不足被中断（HTTP 429 insufficient_quota）。**现已充值，请从中断处继续。**

一、先自查现场（务必先做）
1) `git log --oneline -3` → 应停在 db449ca（我方最后一次提交），HEAD 不要动。
2) `git status` → 你已产出两个**未跟踪**文件：
   · `utils/takeawayDerive.js`
   · `tools/selftest_m3_takeaway.js`
   先把这两个读一遍，判断已写到哪、缺口在哪，**在此基础上补齐**，不要推倒重写、不要删已有实现。

二、原始要求（全文照做，逐条勿漏）
========================================================================
"""

tail = """
========================================================================
三、收尾必交付（缺一不可）
1. `node tools/selftest_m3_takeaway.js` **实跑输出**（贴出总/通过/失败数）。
2. 把新套件登记进 `verify_all.js` 的 SUITES（并在头注/说明段同步套件数）。
3. 红线自证逐条打勾：
   · 生产引擎段一字未改（不碰 netUnitCostWan / lineNetCostYuan / calcCostCard / wouldCreateCycle 的实现）
   · 不新建集合、不新增索引、不改 core/15 权限矩阵
   · 不改 `specs/` 下任何文件
   · 金额单位 = 分；时间 = Unix ms；写库主键用 `_id`；新可见文案走 terms 单源
4. 若确实写不完，**明确列出"未做项 + 原因"**，不许静默跳过。
"""

out = head + orig.strip() + tail
p = os.path.join(BASE, 'feed_m317_resume.txt')
io.open(p, 'w', encoding='utf-8', newline='\n').write(out)
print('written:', p)
print('chars(含换行) =', len(out))
print('chars(去换行) =', len(out.replace('\n', '')))
print('---- head ----')
print(out[:400])
print('---- tail ----')
print(out[-400:])
