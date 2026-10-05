# -*- coding: utf-8 -*-
import fitz, sys, os
D = r"C:/Users/lzj/xwechat_files/wxid_auezz32wau7v22_5514/temp/RWTemp/2026-10/9e20f478899dc29eb19741386f9343c8"
OUT = r"C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_pdf"
files = ["火锅卤鸡方案_半自助.pdf", "火锅面商业计划书 (2).pdf"]
for f in files:
    p = os.path.join(D, f)
    doc = fitz.open(p)
    print("=" * 70)
    print("FILE:", f, " pages=", doc.page_count)
    total = 0
    lines = []
    for i, page in enumerate(doc):
        t = page.get_text("text") or ""
        total += len(t)
        lines.append("\n---------- p%d ----------\n" % (i + 1) + t)
    print("text chars =", total)
    tag = "huoguo_luji" if "卤鸡" in f else "huoguomian"
    op = os.path.join(OUT, tag + ".txt")
    open(op, "w", encoding="utf-8").write("".join(lines))
    print("written:", op)
    doc.close()
