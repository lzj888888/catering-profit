# -*- coding: utf-8 -*-
"""从 InsCode DB 读回最后若干条助手消息（回执归档用）。判据：DB 是唯一可信源。"""
import sqlite3, os, json, io, sys

DB = os.path.expanduser("~/.config/inscode/inscode.db")
c = sqlite3.connect(DB)
cols = [r[1] for r in c.execute("PRAGMA table_info(sessions)")]
print("sessions cols:", cols)

# 找 working_dir == catering-profit 的会话
rows = list(c.execute("SELECT rowid, * FROM sessions"))
print("rows:", len(rows))
if rows:
    sample = dict(zip(["rowid"] + cols, rows[-1]))
    for k, v in sample.items():
        s = str(v)
        print("  %-20s %s" % (k, (s[:160] + "...") if len(s) > 160 else s))
