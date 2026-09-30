# -*- coding: utf-8 -*-
"""自动探测 InsCode 输入框落点：逐候选坐标 点击→清空→Shift+Insert→像素 diff。
diff 显著 = 该坐标能让输入框吃到内容。仅粘贴，不发送。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
text = open(OUT + '/feed_m317.txt', encoding='utf-8').read()

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


h = ui.find_inscode()
print('hwnd =', h, 'rect =', win32gui.GetWindowRect(h), flush=True)
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
time.sleep(1.3)

L, T, R, B = win32gui.GetWindowRect(h)
print('window LTRB =', (L, T, R, B), 'foreground =', win32gui.GetForegroundWindow(), flush=True)

# 候选点：窗口左下文本区（y 取三条：回显估算 1018 / UIA 945 / 折中 985）
CANDS = [(L + 480, B - 2), (L + 480, T + 925), (L + 480, T + 965),
         (L + 900, B - 2), (L + 300, B - 2)]


def band_diff(p1, p2, y0, y1, x0, x1):
    a = Image.open(p1).convert('RGB').crop((x0, y0, x1, y1))
    b = Image.open(p2).convert('RGB').crop((x0, y0, x1, y1))
    d = ImageChops.difference(a, b).convert('L')
    return sum(d.histogram()[16:]), d.getbbox()


print('clip set =', ui.set_clipboard(text), flush=True)
time.sleep(0.4)
print('clip match =', ui.get_clipboard() == text, flush=True)

for i, (cx, cy) in enumerate(CANDS):
    print('--- try#%d click %s ---' % (i, (cx, cy)), flush=True)
    print('  click n =', mouse_click(cx, cy), flush=True)
    time.sleep(0.9)
    key(0x11); time.sleep(0.06); tap(0x41); key(0x11, up=True); time.sleep(0.5)
    tap(0x2E); tap(0x2E); time.sleep(0.9)          # 清空
    pA = OUT + '/probe_A%d.png' % i
    ui.screenshot(pA); time.sleep(1.0)
    key(0x10); time.sleep(0.06); tap(0x2D); key(0x10, up=True); time.sleep(2.8)   # Shift+Insert
    pB = OUT + '/probe_B%d.png' % i
    ui.screenshot(pB); time.sleep(1.0)
    ch, bbox = band_diff(pA, pB, max(0, T + 850), min(1080, B + 5), L + 60, R - 60)
    print('  changed =', ch, 'bbox =', bbox, flush=True)
    if ch > 2500:
        print('INPUT-FOUND at', (cx, cy), 'changed =', ch, flush=True)
        sys.exit(0)

print('INPUT-NOT-FOUND', flush=True)
sys.exit(4)
