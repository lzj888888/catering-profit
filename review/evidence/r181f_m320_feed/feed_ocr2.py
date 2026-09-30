# -*- coding: utf-8 -*-
"""OCR+像素通道投喂 InsCode（v2：焦点实证坐标 + 像素 diff 校验粘贴 + 像素定位发送钮）。

判据链：
 ① 点击后输入区像素有变化（焦点进入）
 ② 粘贴后输入区像素再次大幅变化（内容落地）
 ③ 点发送后 DB `inflight_turn` 0 → 1，且 User 消息数 +1（权威）
用法: python -u feed_ocr2.py <payload> [--send]
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
from PIL import Image, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181f_m320_feed'
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
BOX = (660, 1005, 1520, 1055)

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


def tap(vk):
    n = key(vk); time.sleep(0.08); n += key(vk, up=True)
    return n


def chord(mod, vk):
    n = key(mod); time.sleep(0.06)
    n += key(vk); time.sleep(0.09); n += key(vk, up=True); time.sleep(0.06)
    n += key(mod, up=True)
    return n


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


def diff_region(a, b, box=BOX):
    ia = Image.open(a).convert('RGB').crop(box)
    ib = Image.open(b).convert('RGB').crop(box)
    d = ImageChops.difference(ia, ib).convert('L')
    return sum(1 for v in d.tobytes() if v > 12)


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
time.sleep(1.2)
print('DB before =', db_counts(), flush=True)

a = shot('k0_before.png'); time.sleep(1.0)
print('click input n =', mouse_click(743, 1032), flush=True)
time.sleep(0.9)
chord(0x11, 0x41); time.sleep(0.35)
tap(0x2E); time.sleep(0.6)

print('clip set =', ui.set_clipboard(text), flush=True)
time.sleep(0.5)
print('clip match =', ui.get_clipboard() == text, flush=True)
print('ctrl+v n =', chord(0x11, 0x56), flush=True)
time.sleep(2.5)
b = shot('k1_after_paste.png'); time.sleep(1.0)
d = diff_region(a, b)
print('pixdiff(input) =', d, flush=True)
print('PASTE-' + ('OK' if d > 300 else 'SUSPECT'), flush=True)
r = subprocess.run([PY, OCR, 'find', b, '批次'], capture_output=True, text=True, errors='replace')
print('OCR 批次 ->', r.stdout.strip(), flush=True)

if not DO_SEND:
    print('PASTED-ONLY', flush=True)
    sys.exit(0)

im = Image.open(b).convert('RGB')
px = im.load()
pts = [(x, y) for y in range(1020, 1090) for x in range(1430, 1570) if sum(px[x, y]) < 210]
print('dark pts =', len(pts), flush=True)
if pts:
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    bx, by = (min(xs) + max(xs)) // 2, int((min(ys) + max(ys)) / 2)
    print('send bbox =', (min(xs), min(ys), max(xs), max(ys)), flush=True)
else:
    bx, by = 1495, 1061
print('send at =', (bx, by), flush=True)
print('send-click n =', mouse_click(bx, by), flush=True)
time.sleep(5.0)
print('DB after =', db_counts(), flush=True)
shot('k2_after_send.png')
print('DONE', flush=True)
