# -*- coding: utf-8 -*-
"""M3.20 投喂（终版）：清空 → Shift+Insert 粘贴 → 点发送钮 → DB 复核。
坐标全部由像素动态定位（灰度圆钮 = 发送钮；输入框 = 圆钮左侧同排）。
用法: python -u feed_final.py <payload> [--send]
"""
import ctypes, sys, time, os, subprocess
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181f_m320_feed'
PAYLOAD = sys.argv[1]
DO_SEND = '--send' in sys.argv
text = open(PAYLOAD, encoding='utf-8').read()
print('payload len =', len(text), flush=True)

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


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk, d=0.08):
    n = key(vk); time.sleep(d); n += key(vk, up=True); return n


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.45)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.08)
    return n


def shot(name):
    p = OUT + '/' + name
    ui.screenshot(p)
    return p


def find_send_circle(png):
    """在右下区域找灰度实心圆（发送钮）。返回 (cx, cy)。"""
    im = Image.open(png).convert('RGB'); px = im.load()
    w, h = im.size
    pts = []
    for y in range(int(h * 0.90), h - 1):
        for x in range(int(w * 0.60), w - 5):
            r, g, b = px[x, y]
            if abs(r - 153) < 16 and abs(g - 154) < 16 and abs(b - 159) < 16:
                pts.append((x, y))
    if len(pts) < 60:
        return None, len(pts)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return ((min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2), len(pts)


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
print('hwnd =', h, 'rect =', win32gui.GetWindowRect(h), flush=True)
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.3)
print('DB before =', db_counts(), flush=True)

p0 = shot('n0_before.png'); time.sleep(1.0)
c, n = find_send_circle(p0)
print('send circle =', c, 'pts =', n, flush=True)
if not c:
    print('SEND-BTN-NOT-FOUND'); sys.exit(3)
bx, by = c
ix, iy = bx - 330, by
print('input click at =', (ix, iy), flush=True)

print('click input n =', mouse_click(ix, iy), flush=True)
time.sleep(0.9)
# 清空
key(0x11); time.sleep(0.06); tap(0x41); key(0x11, up=True); time.sleep(0.4)
tap(0x2E); tap(0x2E); time.sleep(0.7)
# 粘贴：Shift+Insert（Ctrl+V 被 InsCode 吞掉）
print('clip set =', ui.set_clipboard(text), flush=True)
time.sleep(0.5)
print('clip match =', ui.get_clipboard() == text, flush=True)
key(0x10); time.sleep(0.06); tap(0x2D); key(0x10, up=True); time.sleep(2.8)
p1 = shot('n1_pasted.png'); time.sleep(1.0)
print('pasted shot =', p1, flush=True)

if not DO_SEND:
    print('PASTED-ONLY', flush=True)
    sys.exit(0)

print('before inflight =', db_counts(), flush=True)
print('send click n =', mouse_click(bx, by), flush=True)
time.sleep(6.0)
print('DB after =', db_counts(), flush=True)
shot('n2_after_send.png')
time.sleep(3.0)
print('DB after+3s =', db_counts(), flush=True)
print('DONE', flush=True)
