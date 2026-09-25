# -*- coding: utf-8 -*-
"""Wait for InsCode to reply to a message we just sent, and wake the agent when it does.

Why
---
The agent only gets a turn when something notifies it. Polling in a loop inside the agent
burns a turn per probe; instead this script runs as a BACKGROUND task and exits on the first
meaningful event, so the host's task-notification wakes the agent exactly when there is
something to do.

Events (first one wins)
  REPLY            a new non-empty Assistant message appeared  -> read it, decide next action
  APPROVAL_PENDING a pending approval SURVIVED the auto-watcher -> human/safety decision needed
  IDLE_NO_REPLY    no new reply and nothing in flight for --idle-grace seconds
  TIMEOUT          nothing happened within --timeout-min

Side effect (what the user asked for: "用屏幕看它是否回复")
  every --shot-every seconds it screenshots the InsCode window, OCRs it and appends a few
  lines to <TMP>/reply_wait.log, so there is *visual* evidence of the on-screen state, not
  just a DB row.

Usage
  python inscode_reply_wait.py --assist 299 [--timeout-min 45] [--shot-every 600]
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, r"C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts")
import inscode_ui as ui  # noqa: E402

HOME = os.environ.get("USERPROFILE", r"C:\Users\lzj")
DB = os.path.join(HOME, ".config", "inscode", "inscode.db")
STREAM = os.path.join(HOME, ".config", "inscode", "logs", "session-stream.log")
SESSION = "831bd65c-70cb-4600-8fb6-7ebe07886768"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
OCR = r"C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py"
LOG = os.path.join(TMP, "reply_wait.log")


def log(msg):
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), msg)
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def state():
    """(assistant_count, last_assistant_tail, inflight, pending_state, stream_age, msgs_after_baseline)"""
    c = sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)
    try:
        b, = c.execute("select body from sessions where id=?", (SESSION,)).fetchone()
        msgs = json.loads(b)["messages"]
        A = [m for m in msgs if m.get("role") == "Assistant" and (m.get("text") or "").strip()]
        inflight = c.execute("select count(*) from inflight_turn").fetchone()[0]
        row = c.execute("select id,state from approval_audit order by id desc limit 1").fetchone()
    finally:
        c.close()
    age = time.time() - os.stat(STREAM).st_mtime if os.path.exists(STREAM) else 9999
    return len(A), (A[-1].get("text") or "")[-4000:], inflight, (row[1] if row else "?"), int(age)


def ocr_window(png):
    out = subprocess.run([sys.executable, OCR, "read", png],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assist", type=int, required=True, help="baseline non-empty Assistant count")
    ap.add_argument("--user", type=int, default=0, help="baseline User count (informational)")
    ap.add_argument("--timeout-min", type=int, default=45)
    ap.add_argument("--poll", type=int, default=45)
    ap.add_argument("--shot-every", type=int, default=600)
    ap.add_argument("--idle-grace", type=int, default=300)
    ap.add_argument("--pending-grace", type=int, default=60,
                    help="pending 审批存活超过这么多秒就叫人（InsCode 大约等 5-6 分钟）")
    a = ap.parse_args()

    os.makedirs(TMP, exist_ok=True)
    t0 = time.time()
    last_shot = 0.0
    pend_since = None
    log("WAIT start | assist_baseline=%d user_baseline=%d timeout=%dmin" % (a.assist, a.user, a.timeout_min))

    while True:
        try:
            n, tail, inflight, pstate, age = state()
        except Exception as e:                                    # noqa: BLE001
            log("db 读取失败（跳过本轮）: %r" % (e,))
            time.sleep(a.poll)
            continue

        elapsed = time.time() - t0
        log("poll | assist=%d(+%d) inflight=%d approval=%s stream_age=%ds elapsed=%.0fmin"
            % (n, n - a.assist, inflight, pstate, age, elapsed / 60.0))

        if n > a.assist:
            print(json.dumps({"event": "REPLY", "assistant_count": n,
                              "delta": n - a.assist, "tail": tail},
                             ensure_ascii=False))
            log("EVENT=REPLY 收到回复（+%d 条）" % (n - a.assist))
            return 0

        if pstate == "pending":
            if pend_since is None:
                pend_since = time.time()
            elif time.time() - pend_since > a.pending_grace:
                print(json.dumps({"event": "APPROVAL_PENDING", "inflight": inflight,
                                  "stream_age": age, "note": "挂起审批未被自动监工处理",
                                  "waited_s": int(time.time() - pend_since)}, ensure_ascii=False))
                log("EVENT=APPROVAL_PENDING 有审批挂起超过 %ds" % a.pending_grace)
                return 0
        else:
            pend_since = None

        if inflight == 0 and age > a.idle_grace:
            print(json.dumps({"event": "IDLE_NO_REPLY", "inflight": inflight,
                              "stream_age": age, "assistant_count": n}, ensure_ascii=False))
            log("EVENT=IDLE_NO_REPLY 空闲且无新回复")
            return 0

        if elapsed > a.timeout_min * 60:
            print(json.dumps({"event": "TIMEOUT", "assistant_count": n, "inflight": inflight,
                              "stream_age": age}, ensure_ascii=False))
            log("EVENT=TIMEOUT 超时退出")
            return 0

        if time.time() - last_shot > a.shot_every:
            last_shot = time.time()
            try:
                h = ui.find_inscode()
                if h:
                    png = "%s/reply_wait_%d.png" % (TMP, int(time.time()))
                    import win_gui as wg
                    wg.screenshot_window(h, png, focus_first=False)
                    lines = ocr_window(png)
                    keep = [l for l in lines if any(k in l for k in
                            ("处理", "完成", "运行", "允许", "拒绝", "审批", "错误", "失败", "通过", "预期"))]
                    log("screen[%s] %s" % (os.path.basename(png),
                                           (" / ".join(keep[-6:])[:600]) or "(无关键行)"))
            except Exception as e:                                # noqa: BLE001
                log("screen 探针失败: %r" % (e,))

        time.sleep(a.poll)


if __name__ == "__main__":
    sys.exit(main())
