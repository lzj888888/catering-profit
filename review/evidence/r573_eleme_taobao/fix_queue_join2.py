# -*- coding: utf-8 -*-
"""把被拼进第156行的 #103 行切出来（幂等）"""
import io, hashlib

P = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/AUTO_QUEUE.md"
src = io.open(P, encoding="utf-8", newline="").read()
lines = src.split("\n")

TARGET = 155  # 0-based，第 156 行
l = lines[TARGET]
marker = "| 103 |"
pos = l.find(marker)
if pos == -1:
    print("未找到接缝标记，跳过")
else:
    head, tail = l[:pos], l[pos:]
    # 去掉 head 尾部可能残留的分隔空格，保证行格式干净
    head = head.rstrip()
    lines[TARGET] = head + "\n" + tail
    out = "\n".join(lines)
    io.open(P, "w", encoding="utf-8", newline="").write(out)
    print("已切分；原行长 %d -> head %d + tail %d" % (len(l), len(head), len(tail)))

# 校验
out = io.open(P, encoding="utf-8").read()
rows = [x for x in out.split("\n") if x.startswith("| 1")]
print("\n10x 编号行清单：")
for x in rows[-7:]:
    cells = x.split("|")
    if len(cells) > 4:
        print("  #%s  %s  %s" % (cells[1].strip(), cells[3].strip(), cells[2].strip()[:34]))
print("\n文件尾换行:", "正常" if out.endswith("\n") else "缺失")
