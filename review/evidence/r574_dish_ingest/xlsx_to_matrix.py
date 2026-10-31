# -*- coding: utf-8 -*-
"""R574 · 把候选样例 xlsx 转成矩阵 JSON，供 node 侧现有解析器直接消费。

纪律：只读原件，不做任何解析/推断；「能不能认出来」由 node 侧真跑 `importSalesBill/service.js` 裁定。
"""
import warnings, json, io, os, sys
warnings.filterwarnings("ignore")
import openpyxl

CANDIDATES = [
    ("形态A候选", r"C:/Users/lzj/Desktop/tangshi.xlsx"),
    ("形态C候选1", r"C:/Users/lzj/Desktop/店算_形态C样例_外卖商品销量_0907至0913.xlsx"),
    ("形态C候选2", r"review/evidence/r232_formc_sample/商品下载_20260907至20260913__5366951484_20261006213915236.xlsx"),
    ("京东账单", r"review/evidence/r242_jd_bill/jd_bill_20260930.xlsx"),
    ("京东SKU账单", r"review/evidence/r242_jd_bill/jd_sku_bill_20260930.xlsx"),
    ("京东SKU样例", r"review/evidence/r245_jd_profile/jd_sku_sample_doubao.xlsx"),
]

OUT = {}


def sheet_matrix(ws, max_row=40, max_col=40):
    rows = []
    for i, r in enumerate(ws.iter_rows(min_row=1, max_row=max_row, max_col=max_col, values_only=True)):
        rows.append(["" if c is None else (str(c).strip() if not isinstance(c, (int, float)) else c) for c in r])
    return rows


for tag, path in CANDIDATES:
    if not os.path.exists(path):
        OUT[tag] = {"path": path, "error": "MISSING"}
        continue
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        info = {"path": path, "sheets": {}}
        for ws in wb.worksheets:
            try:
                rows = sheet_matrix(ws)
            except Exception as e:
                info["sheets"][ws.title] = {"error": "%s: %s" % (type(e).__name__, e)}
                continue
            nrow = len(rows)
            info["sheets"][ws.title] = {"nrow_total": nrow, "rows": rows}
        OUT[tag] = info
    except Exception as e:
        OUT[tag] = {"path": path, "error": "%s: %s" % (type(e).__name__, e)}

dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "matrix.json")
with io.open(dst, "w", encoding="utf-8") as f:
    json.dump(OUT, f, ensure_ascii=False)

for tag, info in OUT.items():
    if "error" in info:
        print("%-14s ERROR %s" % (tag, info["error"]))
        continue
    names = list(info["sheets"].keys())
    print("%-14s sheets=%s" % (tag, names))
    for nm, d in info["sheets"].items():
        if "error" in d:
            print("     [%s] %s" % (nm, d["error"]))
        else:
            print("     [%s] rows=%d  首非空行=%s" % (
                nm, d["nrow_total"],
                (d["rows"][0][:8] if d["rows"] else [])))
