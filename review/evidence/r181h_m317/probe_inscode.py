# -*- coding: utf-8 -*-
"""R181h 前置：查 InsCode 当前状态（inflight / 最近会话 / 模型选择）。只读。"""
import sqlite3, os, json, glob

DB = r"C:\Users\lzj\.config\inscode\inscode.db"
print("db exists:", os.path.exists(DB), "size:", os.path.getsize(DB) if os.path.exists(DB) else -1)

uri = "file:///" + DB.replace("\\", "/") + "?mode=ro&immutable=1"
c = sqlite3.connect(uri, uri=True)
cur = c.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tabs = [r[0] for r in cur.fetchall()]
print("TABLES:", tabs)

for t in tabs:
    try:
        cur.execute("SELECT COUNT(*) FROM [%s]" % t)
        n = cur.fetchone()[0]
        print("  %-28s rows=%s" % (t, n))
    except Exception as e:
        print("  %-28s ERR %s" % (t, e))

# inflight 行
for t in tabs:
    if "inflight" in t.lower():
        cur.execute("PRAGMA table_info([%s])" % t)
        cols = [r[1] for r in cur.fetchall()]
        print("\n[%s] cols=%s" % (t, cols))
        cur.execute("SELECT * FROM [%s]" % t)
        for row in cur.fetchall():
            print("  ROW:", row)

c.close()

# 模型选择落盘
p = os.path.expanduser(r"~\AppData\Roaming\inscode\ui_preferences.json")
cands = glob.glob(os.path.expanduser(r"~\AppData\Roaming\inscode\*.json")) + \
        glob.glob(os.path.expanduser(r"~\AppData\Roaming\com.inscode*\*.json"))
print("\npref candidates:", cands)
for f in cands:
    try:
        j = json.load(open(f, encoding="utf-8"))
        if isinstance(j, dict) and "last_model_selection" in json.dumps(j, ensure_ascii=False):
            print("  FOUND in", f, "->", json.dumps(j.get("last_model_selection"), ensure_ascii=False))
    except Exception as e:
        print("  read err", f, e)
