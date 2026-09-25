"""r128 守候：轮询 InsCode inflight_turn，归零(连续 N 次)即判定"写完"，随后跑门禁。
只读 + 只写 review/evidence/，不碰 cloudfunctions/ miniprogram/ pages/ tools/ specs/。
用法: python _watch_r128.py <max_minutes>
"""
import sqlite3, subprocess, sys, time, os, json

DB = r"C:\Users\lzj\.config\inscode\inscode.db"
ROOT = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
OUT = os.path.join(ROOT, "review", "evidence", "r128_watch")
os.makedirs(OUT, exist_ok=True)

max_min = float(sys.argv[1]) if len(sys.argv) > 1 else 25.0
deadline = time.time() + max_min * 60


def probe():
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        cur = con.cursor()
        inflight = cur.execute("select count(*) from inflight_turn").fetchone()[0]
        row = cur.execute(
            "select message_count, updated_at from sessions where id=(select id from sessions order by updated_at desc limit 1)"
        ).fetchone()
        con.close()
        return inflight, (row[0] if row else -1), (row[1] if row else 0)
    except Exception as e:
        return -1, -1, 0


log = open(os.path.join(OUT, "watch_log.txt"), "w", encoding="utf-8")
last_msg = -1
zero_streak = 0
prev_msg = -1
stall_streak = 0
verdict = "timeout"
t0 = time.time()
while time.time() < deadline:
    inflight, msg, upd = probe()
    el = int(time.time() - t0)
    line = f"[{el:5d}s] inflight={inflight} msg={msg} upd={upd}"
    print(line, flush=True)
    log.write(line + "\n")
    log.flush()
    if msg == prev_msg:
        stall_streak += 1
    else:
        stall_streak = 0
    prev_msg = msg
    if inflight == 0:
        zero_streak += 1
        if zero_streak >= 3 and stall_streak >= 2:
            verdict = "idle"
            break
    else:
        zero_streak = 0
    time.sleep(30)

log.write(f"VERDICT={verdict}\n")
log.close()
print("VERDICT=" + verdict, flush=True)

if verdict == "idle":
    # 收码复核：门禁（只读）
    res = {}
    for name, cmd in [
        ("gate", ["node", "verify_all.js"]),
        ("alcodes", ["node", "specs/dev-specs/prototype/check_error_codes.js"]),
        ("terms_diff", ["diff", "-q", "miniprogram/i18n/terms.js", "specs/dev-specs/i18n/terms.js"]),
    ]:
        try:
            p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
            res[name] = {"rc": p.returncode, "out": (p.stdout + p.stderr)[-3000:]}
            with open(os.path.join(OUT, name + ".txt"), "w", encoding="utf-8") as f:
                f.write((p.stdout or "") + (p.stderr or ""))
        except Exception as e:
            res[name] = {"rc": -999, "out": str(e)}
    with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("GATE_RC=" + str(res["gate"]["rc"]))
    print("TERMS_DIFF_RC=" + str(res["terms_diff"]["rc"]))
