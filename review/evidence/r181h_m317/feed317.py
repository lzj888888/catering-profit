# -*- coding: utf-8 -*-
"""M3.17 投喂 v2：几何由窗口 rect + 像素定位给出。
输入框实测（窗口 rect (20,20,1640,1020) 下）：x 532~1380 / y 924~988；发送钮 ≈ (1351, 982)。
粘贴用 Shift+Insert（Ctrl+V 被 InsCode 吞）。内置粘贴后像素验证。
用法: python -u feed317.py <payload> [--send]
"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
PAYLOAD = sys.argv[1]
DO_SEND = '--send' in sys.argv
text = open(PAYLOAD, encoding='utf-8').read()
print('payload chars =', len(text), flush=True)

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


def tap(vk, d=0.09):
    n = key(vk); time.sleep(d); n += key(vk, up=True); time.sleep(d); return n


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.5)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.1)
    return n


def shot(name):
    p = OUT + '/' + name
    ui.screenshot(p)
    return p


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
    win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(0.8)
except Exception as e:
    print('move err', e, flush=True)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.4)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), 'fg =', win32gui.GetForegroundWindow(), flush=True)
print('DB before =', db_counts(), flush=True)

# —— 发送钮：窗口右下角，用相对几何（R-300, B-39）；再用像素做一致校验
p0 = shot('v2_0_before.png'); time.sleep(1.0)
im = Image.open(p0).convert('RGB'); px = im.load()
bx, by = R - 300, B - 39
# 校验：该点附近应存在「灰(153,154,159) 或 近黑」的圆形实心块
hit = 0
for y in range(max(0, by - 18), min(im.size[1], by + 18)):
    for x in range(max(0, bx - 20), min(im.size[0] - 1, bx + 20)):
        r, g, b = px[x, y]
        if (abs(r - 153) < 24 and abs(g - 154) < 24 and abs(b - 159) < 24) or (r < 75 and g < 75 and b < 85):
            hit += 1
print('send btn guess =', (bx, by), 'hit px =', hit, flush=True)
if hit < 80:
    print('SEND-BTN-NOT-FOUND'); sys.exit(3)

# —— 输入框文本区：发送钮左移 550、上移 32（实测相对偏移）
ix, iy = bx - 550, by - 32
print('input click at =', (ix, iy), flush=True)
print('click n =', mouse_click(ix, iy), flush=True)
time.sleep(1.0)
# 清空：Ctrl+A + Del x2
key(0x11); time.sleep(0.06); tap(0x41); key(0x11, up=True); time.sleep(0.5)
tap(0x2E); tap(0x2E); time.sleep(0.9)
pA = shot('v2_1_cleared.png'); time.sleep(0.9)
# 粘贴：Shift+Insert
print('clip set =', ui.set_clipboard(text), flush=True)
time.sleep(0.5)
print('clip match =', ui.get_clipboard() == text, flush=True)
key(0x10); time.sleep(0.06); tap(0x2D); key(0x10, up=True); time.sleep(3.0)
pB = shot('v2_2_pasted.png'); time.sleep(1.0)

box = (max(0, L + 500), max(0, B - 110), min(1920, R - 250), min(1080, B))
ia = Image.open(pA).convert('RGB').crop(box); ib = Image.open(pB).convert('RGB').crop(box)
dd = ImageChops.difference(ia, ib).convert('L')
print('paste box =', box, 'changed =', sum(dd.histogram()[16:]), 'bbox =', dd.getbbox(), flush=True)

if not DO_SEND:
    print('PASTED-ONLY', flush=True)
    sys.exit(0)

print('send click n =', mouse_click(bx, by), flush=True)
time.sleep(6.0)
print('DB after =', db_counts(), flush=True)
shot('v2_3_after_send.png')
time.sleep(4.0)
print('DB after+4s =', db_counts(), flush=True)
print('DONE', flush=True)
