# -*- coding: utf-8 -*-
"""投喂 v3：全程 HWND_TOPMOST 钉住 InsCode（破 WorkBuddy 抢前台），带点位归属硬校验。
用法: python -u feed317_top.py <payload> [--send]
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
from PIL import Image, ImageGrab, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
PAYLOAD = sys.argv[1]
DO_SEND = '--send' in sys.argv
text = open(PAYLOAD, encoding='utf-8').read()
print('payload chars =', len(text), flush=True)

ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MI(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KI(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class IU(ctypes.Union):
    _fields_ = [("mi", MI), ("ki", KI)]


class INP(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", IU)]


SI = ctypes.windll.user32.SendInput
SI.restype = wintypes.UINT


def one(i):
    return SI(1, ctypes.byref(i), ctypes.sizeof(INP))


def k(vk, up=False):
    return one(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk, d=0.08):
    n = k(vk); time.sleep(d); n += k(vk, up=True); time.sleep(d); return n


def si_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.45)
    n = 0
    for f in (0x0002, 0x0004):
        n += one(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))); time.sleep(0.12)
    return n


def g(p):
    ImageGrab.grab().save(p); return p


def owner(x, y):
    hw = ctypes.windll.user32.WindowFromPoint(wintypes.POINT(int(x), int(y)))
    if not hw:
        return None
    return win32gui.GetAncestor(hw, win32con.GA_ROOT)


def in_code(x, y, h):
    return owner(x, y) == h


def db_counts():
    import sqlite3, json
    con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
    try:
        infl = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
        row = con.execute('SELECT body FROM sessions ORDER BY updated_at DESC LIMIT 1').fetchone()
        nu = -1
        if row and row[0]:
            msgs = json.loads(row[0]).get('messages', [])
            nu = len([m for m in msgs if m.get('role') == 'User'])
        return infl, nu
    finally:
        con.close()


h = ui.find_inscode()
print('hwnd =', h, 'title =', win32gui.GetWindowText(h), flush=True)
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.5)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
# 🔴 全程置顶：破 WorkBuddy 抢前台
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040); time.sleep(0.9)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.5)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), 'fg =', win32gui.GetForegroundWindow(), flush=True)

CX, CY = 700, 955
print('点位归属校验: (x,y)=({},{}) owner={} inInsCode={}'.format(CX, CY, owner(CX, CY), in_code(CX, CY, h)), flush=True)
if not in_code(CX, CY, h):
    print('!! 点位不属于 InsCode —— 中止'); sys.exit(4)

# composer 全宽比对区（含最左插入点）
BOX = (L + 360, B - 95, R - 240, B - 8)
# 发送钮（相对几何 R-300 / B-39），并做像素校验
SX, SY = R - 300, B - 39
print('send btn =', (SX, SY), 'inInsCode =', in_code(SX, SY, h), flush=True)
if not in_code(SX, SY, h):
    print('!! 发送钮点位不属于 InsCode —— 中止'); sys.exit(4)


def diff(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX); ib = Image.open(b).convert('RGB').crop(BOX)
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[16:]), dd.getbbox()


print('DB before =', db_counts(), flush=True)
p0 = g(OUT + '/t0_before.png'); time.sleep(0.5)

print('click composer ret =', si_click(CX, CY), flush=True)
time.sleep(1.0)
p1 = g(OUT + '/t1_focused.png')
print('   focus diff =', diff(p0, p1), flush=True)

kd_ = 0x11
k(kd_); time.sleep(0.08); tap(0x41); k(kd_, up=True); time.sleep(0.5)
tap(0x2E); tap(0x2E); time.sleep(0.9)
p2 = g(OUT + '/t2_cleared.png')
print('   cleared diff vs focus =', diff(p1, p2), flush=True)

print('clip set =', ui.set_clipboard(text), '| match =', ui.get_clipboard() == text, flush=True)
time.sleep(0.4)
k(0x10); time.sleep(0.08); tap(0x2D); k(0x10, up=True); time.sleep(3.2)
p3 = g(OUT + '/t3_pasted.png')
pd, pbb = diff(p2, p3)
print('   PASTE diff =', pd, 'bbox =', pbb, flush=True)

if pd < 300:
    print('!! 粘贴失败（diff 过小）—— 中止，不发送'); sys.exit(5)

if not DO_SEND:
    print('PASTED-ONLY'); sys.exit(0)

print('send click ret =', si_click(SX, SY), flush=True)
time.sleep(7.0)
print('DB after+7s =', db_counts(), flush=True)
g(OUT + '/t4_after_send.png')
time.sleep(6.0)
print('DB after+13s =', db_counts(), flush=True)
# 收尾：解除置顶（不影响已完成的操作）
try:
    win32gui.SetWindowPos(h, win32con.HWND_NOTOPMOST, 20, 20, 1620, 1000, 0x0040)
except Exception:
    pass
print('DONE', flush=True)
