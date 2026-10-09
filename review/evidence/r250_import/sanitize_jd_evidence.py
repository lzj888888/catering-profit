# -*- coding: utf-8 -*-
"""sanitize_jd_evidence.py —— R250 取证脱敏（把**结构**证据入库、真实数据行不进仓）

WHY：`_probe_tmp/_jd_dump.txt` 逐行打了**真实业务数据**（门店名 / 商家编号 / 主订单号 /
     下单时间），而本仓 `.gitignore` 已就「过程件含真实销售数据 ⇒ 隐私」立过规矩。
     但本轮的**定案证据**恰恰是**表头结构**（京东订单级「两级表头」），与数据行无关
     ⇒ 只保留：sheet 名、维度、**表头行**（京东固定列名，非用户数据）；
        数据行一律 <> 红act 掉。

输入：`_probe_tmp/_jd_matrix.json`（由 _jd_matrix.py 从**真 SheetJS + 真文件**导出）
输出：`review/evidence/r250_import/jd_structure_sanitized.txt`
"""
import json, io, os

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
SRC = os.path.join(REPO, "_probe_tmp", "_jd_matrix.json")
OUT = os.path.join(REPO, "review/evidence/r250_import/jd_structure_sanitized.txt")

m = json.load(io.open(SRC, encoding="utf-8"))
cell = lambda x: "" if x is None else str(x)

lines = []
lines.append("R250 京东账单**结构取证（已脱敏）**")
lines.append("=" * 96)
lines.append("来源：李老师微信来件（2026-10-08 22:18，同一批两份，文件名见下）")
lines.append("矩阵由 review/evidence/r250_import/_jd_matrix.py 用**真 SheetJS** 导出。")
lines.append("脱敏口径：**只保留 sheet 名 / 维度 / 表头行**（京东固定列名）；数据行一律不落盘。")
lines.append("")

for key, body in m.items():
    lines.append("=" * 96)
    lines.append("[%s] 文件 = %s" % (key, body.get("file")))
    sheets = body.get("sheets") or {}
    lines.append("  sheet 列表 = " + json.dumps(list(sheets.keys()), ensure_ascii=False))
    for sname, s in sheets.items():
        rows = s.get("rows") or []
        widths = [len(r or []) for r in rows] or [0]
        w = max(widths)
        lines.append("")
        lines.append("  ---- sheet %r : %d 行 × %d 列" % (sname, len(rows), w))
        lines.append("       🔴 行号 = 数据表**真实行号**（R1 = Excel 第 1 行）")
        for i in range(min(2, len(rows))):
            vals = [cell(c) for c in (rows[i] or [])]
            nonempty = sum(1 for v in vals if v.strip())
            lines.append("       R%d  非空文本格 = %d / %d" % (i + 1, nonempty, len(vals)))
            lines.append("           " + json.dumps(vals, ensure_ascii=False))
        if len(rows) > 2:
            lines.append("       R3..R%d  <redacted：%d 行真实业务数据，不入仓>" % (len(rows), len(rows) - 2))
    lines.append("")

io.open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("written:", OUT)
print("\n".join(lines))
