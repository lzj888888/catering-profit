# -*- coding: utf-8 -*-
"""导出 InsCode 会话最后 N 条消息为 markdown（回执归档）。"""
import sqlite3, os, json, io, time

DB = os.path.expanduser("~/.config/inscode/inscode.db")
SID = "831bd65c-70cb-4600-8fb6-7ebe07886768"
OUT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181j_m319_m321_feed/inscode_receipt_db.txt"

c = sqlite3.connect(DB)
body, updated, mcount = c.execute(
    "SELECT body, updated_at, message_count FROM sessions WHERE id=?", (SID,)
).fetchone()
d = json.loads(body)
msgs = d.get("messages") or d.get("history") or []
print("keys:", list(d.keys())[:20])
print("messages:", len(msgs), "message_count:", mcount)
print("updated_at:", updated, time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(updated / 1000)))

inflight = list(c.execute("SELECT * FROM inflight_turn"))
print("inflight_turn rows:", len(inflight))

lines = []
lines.append("# InsCode 回执 · DB 直读归档（R181j 批次 E）\n")
lines.append("- 会话 id: `%s`\n" % SID)
lines.append("- working_dir: `C:\\Users\\lzj\\WorkBuddy\\Claw\\catering-profit`\n")
lines.append("- message_count: %d · updated_at: %s\n" % (
    mcount, time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(updated / 1000))))
lines.append("- inflight_turn 行数: %d（0 = 空闲）\n" % len(inflight))
lines.append("\n> 用途：纪律「不采信任何自述」——此处仅**留档** InsCode 的原始回执文本，作为对照物；\n"
             "> 真判据一律是我方独立跑出来的门禁 / 锚点复算 / 变异结论。\n\n---\n")

# 最后 8 条消息（User/Assistant/Tool 全文）
tail = msgs[-8:]
for i, m in enumerate(tail):
    role = m.get("role", "?")
    content = m.get("text") or ""
    tc = m.get("tool_calls") or []
    lines.append("\n## [%d] role=%s · len=%d · tool_calls=%d\n\n" % (i + 1, role, len(content), len(tc)))
    lines.append(content if len(content) < 30000 else content[:30000] + "\n…(截断)")
    if tc:
        lines.append("\n\n```\n" + json.dumps(tc, ensure_ascii=False)[:800] + "\n```")

with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("".join(lines))
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
