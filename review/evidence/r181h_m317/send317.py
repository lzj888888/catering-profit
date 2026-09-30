# -*- coding: utf-8 -*-
"""点发送钮（像素定位黑实心圆）→ DB 复核。载荷已在输入框内，本脚本只负责发送与取证。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _IU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _IU)]


_SI = ctypes.windll.user32.SendInput
_SI.restype = wintypes.UINT


def _one(i):
    return _SI(1, ctypes.byref(i), ctypes.sizeof(INPUT))


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.45)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.08)
    return n


def db_counts():
    import sqlite3, json
    con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
    try:
        infl = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
        row = con.execute('SELECT body FROM sessions ORDER BY rowid DESC LIMIT 1').fetchone()
        nu = na = -1
        if row and row[0]:
            msgs = json.loads(row[0]).get('messages', [])
            nu = len([m for m in msgs if m.get('role') == 'User'])
            na = len([m for m in msgs if m.get('role') == 'Assistant' and (m.get('text') or '').strip()])
        return infl, nu, na
    finally:
        con.close()


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.2)
print('DB before =', db_counts(), flush=True)

p = OUT + '/n4_pre_send.png'
ui.screenshot(p); time.sleep(1.0)
im = Image.open(p).convert('RGB'); px = im.load()
pts = [(x, y) for y in range(935, 1015) for x in range(1310, 1410) if sum(px[x, y]) < 120]
print('very-dark pts =', len(pts), flush=True)
if len(pts) < 50:
    print('SEND-BTN-NOT-FOUND'); sys.exit(3)
xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
bx, by = (min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2
print('circle bbox =', (min(xs), min(ys), max(xs), max(ys)), 'center =', (bx, by), flush=True)
print('click n =', mouse_click(bx, by), flush=True)
time.sleep(6.0)
print('DB after =', db_counts(), flush=True)
ui.screenshot(OUT + '/n5_sent.png')
time.sleep(4.0)
print('DB after+4s =', db_counts(), flush=True)
print('DONE', flush=True)
