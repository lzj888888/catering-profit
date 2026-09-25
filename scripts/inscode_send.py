# -*- coding: utf-8 -*-
"""Send an arbitrary message into the InsCode desktop chat, then PROVE it landed.

Why this file exists
--------------------
Feeding a batch prompt and *answering an in-flight question* are different jobs, but the
skill only had a hard-coded feed recipe (fixed click coordinates + "look at the screenshot").
On 2026-09-17 a minimized window made `find_inscode()` return None (a minimized Tauri window
reports width 158px, and the old filter required > 600) -> screenshot died with
"cannot write empty image". Every coordinate was also re-derived by hand each round.

This script makes "say something to InsCode" a one-liner that self-verifies:

  1. restore + focus the (possibly MINIMIZED) InsCode window   [inscode_ui.find_inscode fix]
  2. locate the chat input box by OCR-ing its placeholder line -> robust to window size
     (fallback: window-rect fraction 0.45 / 0.955 when the box already holds text)
  3. Ctrl+A + Del to clear residue, then clipboard paste
     (Sogou IME eats letters typed via keybd_event -> never type, always paste)
  4. --send -> press Enter
  5. verify by counting User messages in InsCode's own sqlite *before vs after*
     (DB is ground truth; the screenshot is only evidence for a human/agent to eyeball)

Usage
-----
    python inscode_send.py --file payload.txt [--send] [--tag wrapup]
    python inscode_send.py --text "..." --send
"""
import argparse
import os
import re
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import inscode_ui as ui  # noqa: E402

HOME = os.environ.get("USERPROFILE", r"C:\Users\lzj")
DB = os.path.join(HOME, ".config", "inscode", "inscode.db")
DEFAULT_SESSION = "831bd65c-70cb-4600-8fb6-7ebe07886768"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
OCR = r"C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py"
LINE_RE = re.compile(r"\[\s*([\d.]+),\s*([\d.]+)\]\s*'(.*)'")


def user_msg_count(session=DEFAULT_SESSION):
    """Number of role=='User' messages in the session body (read-only)."""
    import json
    c = sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)
    b, = c.execute("select body from sessions where id=?", (session,)).fetchone()
    c.close()
    return sum(1 for m in json.loads(b)["messages"] if m.get("role") == "User")


def _ocr_lines(png):
    out = subprocess.run([sys.executable, OCR, "list", png],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = []
    for ln in (out.stdout or "").splitlines():
        m = LINE_RE.search(ln.strip())
        if m:
            lines.append((float(m.group(1)), float(m.group(2)), m.group(3)))
    return lines


def input_point(png, rect):
    """Click point for the chat input box: OCR the placeholder, else fall back to geometry.

    🔴 2026-09-22 fix (R85 实测踩坑): the old predicate required BOTH "Enter" and
    "发送" in the same OCR line, but WinRT OCR mis-reads the placeholder tail
    「Enter 发送」as `Enter发关` ⇒ predicate missed ⇒ fell back to
    `y = top + 0.955*h`, which lands on the TOOLBAR row (the model chip) instead of
    the input box ⇒ paste silently went nowhere and `--send` produced an empty Enter
    (symptom: SENT-UNCONFIRMED + empty input box + no DB delta).
    Measured on a 1620x1000 window: the placeholder row is at y≈931 (screen) i.e.
    0.926*h inside the window; 0.955*h = 960 was past it.
    Fix: (a) accept a bare "Enter" hit; (b) x = 0.40*w (was a 1920px-hardcoded 900px
    offset) so the click stays in the text area, clear of the bottom-right chips;
    (c) fallback ratio 0.955 -> 0.926.
    """
    for x, y, txt in _ocr_lines(png):
        if "描述" in txt or "Enter" in txt or "发送" in txt:
            return int(rect[0] + 0.40 * (rect[2] - rect[0])), int(y)
    r = rect
    return int(r[0] + 0.40 * (r[2] - r[0])), int(r[1] + 0.926 * (r[3] - r[1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--text")
    ap.add_argument("--send", action="store_true", help="press Enter after pasting")
    ap.add_argument("--tag", default="msg")
    ap.add_argument("--session", default=DEFAULT_SESSION)
    a = ap.parse_args()

    if a.file:
        text = open(a.file, encoding="utf-8").read()
    elif a.text:
        text = a.text
    else:
        ap.error("need --file or --text")
    text = text.replace("\r\n", "\n")

    os.makedirs(TMP, exist_ok=True)
    before = user_msg_count(a.session)
    print("user msgs before =", before)

    h = ui.find_inscode()
    if not h:
        print("ABORT: InsCode window not found")
        return 2
    ui.focus(h)
    probe = f"{TMP}/send_{a.tag}_probe.png"
    ui.screenshot(probe)

    import ctypes
    import ctypes.wintypes as wt
    r = wt.RECT()
    ctypes.windll.user32.GetWindowRect(h, ctypes.byref(r))
    rect = (r.left, r.top, r.right, r.bottom)
    cx, cy = input_point(probe, rect)
    print("hwnd", h, "rect", rect, "click", (cx, cy))

    ui.click(cx, cy, settle=0.7)
    ui.key(0x41, ctrl=True, settle=0.2)   # Ctrl+A
    ui.key(0x2E, settle=0.3)              # Del
    if not ui.set_clipboard(text):
        print("ABORT: clipboard busy")
        return 3
    time.sleep(0.4)
    ui.key(0x56, ctrl=True, settle=1.6)   # Ctrl+V
    pasted = f"{TMP}/send_{a.tag}_pasted.png"
    ui.screenshot(pasted)
    print("pasted png =", pasted)

    if a.send:
        ui.key(0x0D, settle=2.5)
        time.sleep(1.5)
        after = user_msg_count(a.session)
        shot = f"{TMP}/send_{a.tag}_sent.png"
        ui.screenshot(shot)
        print("user msgs after  =", after, "| delta =", after - before)
        print("sent png =", shot)
        print("RESULT:", "SENT-OK" if after > before else "SENT-UNCONFIRMED")
        return 0 if after > before else 4
    print("RESULT: PASTED-ONLY (add --send to submit)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
