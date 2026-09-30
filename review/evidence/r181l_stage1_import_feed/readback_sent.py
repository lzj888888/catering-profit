# -*- coding: utf-8 -*-
"""投喂送达判据：末条 User 消息逐字等于载荷（trim 尾部换行）；并排除「粘了两遍」。

用法: python readback_sent.py <payload.txt>
"""
import sqlite3, json, os, sys

DB = os.path.expanduser("~/.config/inscode/inscode.db")
PAY = sys.argv[1]
text = open(PAY, encoding="utf-8").read()
expect = text.rstrip("\n")

con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
row = con.execute("SELECT body, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1").fetchone()
d = json.loads(row[0])
ms = d.get("messages", [])
users = [m for m in ms if m.get("role") == "User"]
print("User 消息总数   =", len(users))
print("全部消息数      =", len(ms))
last = (users[-1].get("text") or "")
print("末条 User len   =", len(last), "| 期望 =", len(expect))
print("逐字相等        =", last == expect)
print("疑似重复(≈2x-1) =", abs(len(last) - (2 * len(expect) - 1)) <= 2)
print("末条 head       =", repr(last[:60]))
print("末条 tail       =", repr(last[-60:]))
print("inflight        =", d.get("inflight_turn"))
print("turn_started_at =", d.get("turn_started_at"))
print("turn_completed  =", d.get("turn_completed_at"))
