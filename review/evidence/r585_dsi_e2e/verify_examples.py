# -*- coding: utf-8 -*-
"""把两个样例 xlsx 读成「行数组 JSON」，供 node 侧喂给 dsi1.parse 验证。

为什么要过这一道：样例文件本身可能是"看起来像"但不能被我们解析器吃下的
（比如 Excel 把 1.5 存成字符串、日期存成 datetime 对象）。只有真读回来
喂进 parse 全绿，样例才算能用。
"""
import warnings
warnings.filterwarnings("ignore")
import openpyxl, json, os, datetime

def load(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    out = []
    for r in ws.iter_rows(values_only=True):
        if all(c is None or str(c).strip() == "" for c in r):
            continue
        row = []
        for c in r:
            if isinstance(c, (datetime.datetime, datetime.date)):
                row.append(c.strftime("%Y-%m-%d"))
            elif c is None:
                row.append("")
            else:
                row.append(c)
        out.append(row)
    return out

d = {
    "s1": load("specs/dev-specs/core/examples/dsi1_s1_example.xlsx"),
    "s2": load("specs/dev-specs/core/examples/dsi1_s2_example.xlsx"),
}
p = "review/evidence/r585_dsi_e2e/examples_rows.json"
with open(p, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False)
print("wrote", p, "| s1", len(d["s1"]), "行 | s2", len(d["s2"]), "行")
