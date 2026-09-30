# -*- coding: utf-8 -*-
"""提取长行的尾部片段（供精确 Edit），避免 bash 中文 mojibake。"""
import io, os

P = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/specs/dev-specs/★知识存储点_2026-09-10.md"
lines = io.open(P, encoding="utf-8").read().split("\n")

out = []
out.append("=== 第 852 行（演进链）尾部 460 字符 ===")
out.append(lines[851][-460:])
out.append("")
out.append("=== 第 44 行（断言数声明）尾部 300 字符 ===")
out.append(lines[43][-300:])
out.append("")
out.append("=== 第 852 行长度 = %d 字符 ===" % len(lines[851]))

with io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_peek.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("written")
