# -*- coding: utf-8 -*-
"""修复 AUTO_QUEUE.md 缺尾换行导致 #103 被拼进 #102 行尾的问题（幂等）"""
import io

P = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/AUTO_QUEUE.md"
src = io.open(P, encoding="utf-8", newline="").read()

before = src
# 在每个 "| 1xx |" 表格行起点前确保还有一个换行（只修补被吃掉的那个）
fixed = src.replace("不引新口径 | 103 |", "不引新口径 |\n| 103 |")

if fixed == before:
    print("未发现需要修补的接缝（可能已修过）")
else:
    io.open(P, "w", encoding="utf-8", newline="").write(fixed)
    print("已修补接缝")

# 校验
out = io.open(P, encoding="utf-8").read()
lines = out.split("\n")
if not out.endswith("\n"):
    io.open(P, "a", encoding="utf-8", newline="").write("\n")
    print("已补文件尾换行")
else:
    print("文件尾换行正常")

rows = [l for l in io.open(P, encoding="utf-8").read().split("\n") if l.startswith("| 1")]
print("10x/11x 编号行:")
for l in rows[-6:]:
    print("  ", l.split("|")[1].strip(), "->", l.split("|")[2].strip()[:40])
