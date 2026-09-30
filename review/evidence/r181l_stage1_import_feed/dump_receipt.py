# -*- coding: utf-8 -*-
"""导出 InsCode 末条非空 Assistant 回执（🔴 消息体字段名是 `text`，不是 `content`）。

用法: python dump_receipt.py <out.txt>
"""
import sqlite3, os, json, sys

DB = os.path.expanduser("~/.config/inscode/inscode.db")
con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
row = con.execute("SELECT body FROM sessions ORDER BY updated_at DESC LIMIT 1").fetchone()
d = json.loads(row[0])
ms = d.get("messages", [])
assts = [m for m in ms if m.get("role") == "Assistant" and (m.get("text") or "").strip()]
last = assts[-1]["text"]
out = sys.argv[1] if len(sys.argv) > 1 else "receipt.txt"
open(out, "w", encoding="utf-8").write(last)
print("messages:", len(ms), "| 非空 Assistant:", len(assts), "| 末条 len:", len(last))
print("->", out)
