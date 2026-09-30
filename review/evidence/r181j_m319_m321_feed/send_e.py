# -*- coding: utf-8 -*-
"""投喂续做载荷（全部原语均已单独验证）：
  TOPMOST 钉窗口 → 点 composer → 剪贴板 + Shift+Insert 粘贴 → 像素校验 → 点发送钮 → DB 判据。
用法: python -u send_resume.py <payload> [--send]
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

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181j_m319_m321_feed'
PAYLOAD = sys.argv[1]
DO_SEND = '--send' in sys.argv
CLEAR = '--clear' in sys.argv          # ⚠️ 实测有害：Ctrl+A 会打掉 composer 焦点 ⇒ 粘贴 diff=0（R181j）
SEND_ONLY = '--send-only' in sys.argv  # 只点发送钮（composer 已有内容时用）
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
u = ctypes.windll.user32


def one(i):
    return SI(1, ctypes.byref(i), ctypes.sizeof(INP))


def kd(vk, up=False):
    return one(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None))))


def click(x, y):
    # 🔴 点位归属两段校验之一：窗口归属（WindowFromPoint 尊重 z 序）
    try:
        ow = win32gui.GetAncestor(u.WindowFromPoint(wintypes.POINT(x, y)), win32con.GA_ROOT)
    except Exception:
        ow = None
    if ow != h:
        print('OWNER-MISMATCH at (%d,%d) owner=%s h=%s -> ABORT' % (x, y, ow, h), flush=True)
        sys.exit(7)
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = 0
    for f in (0x0002, 0x0004):
        n += one(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))); time.sleep(0.12)
    return n


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
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.3)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(0.8)
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040); time.sleep(0.6)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.4)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), flush=True)

BOX = (470, 925, 1440, 980)          # composer 文本区（含最左插入点）
SEND = (1345, 980)
CX, CY = 600, 945


def cap(tag):
    p = OUT + '/%s.png' % tag
    ImageGrab.grab().save(p)
    return p


def diff(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX); ib = Image.open(b).convert('RGB').crop(BOX)
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[16:]), dd.getbbox()


print('DB before =', db_counts(), flush=True)
p0 = cap('s0_pre'); time.sleep(0.4)

if SEND_ONLY:
    print('SEND-ONLY 模式（不点击 composer、不粘贴）', flush=True)
    print('send click ret =', click(*SEND), flush=True)
    time.sleep(8.0)
    print('DB after+8s  =', db_counts(), flush=True)
    cap('s3_sent')
    time.sleep(8.0)
    print('DB after+16s =', db_counts(), flush=True)
    cap('s4_sent16')
    print('DONE', flush=True)
    sys.exit(0)

print('click composer ret =', click(CX, CY), flush=True)
time.sleep(1.0)
p1 = cap('s1_focus')
if CLEAR:
    # 🔴 清空 composer：Ctrl+A → Del。防「上一轮残留 + 本轮载荷」叠加（R181j 重复粘贴的根因）。
    kd(0x11); time.sleep(0.06); kd(0x41); time.sleep(0.06); kd(0x41, up=True); kd(0x11, up=True)
    time.sleep(0.3)
    kd(0x2E); time.sleep(0.06); kd(0x2E, up=True)
    time.sleep(0.5)
    cap('s1c_cleared')
    print('CLEARED composer (Ctrl+A / Del)', flush=True)

print('clip set =', ui.set_clipboard(text), '| match =', ui.get_clipboard() == text, flush=True)
time.sleep(0.4)
kd(0x10); time.sleep(0.08); kd(0x2D); time.sleep(0.08); kd(0x2D, up=True); kd(0x10, up=True)
time.sleep(3.4)
p2 = cap('s2_pasted')
pd, bb = diff(p1, p2)
print('PASTE diff =', pd, 'bbox =', bb, flush=True)
if pd < 300:
    print('!! 粘贴失败 —— 中止'); sys.exit(5)
Image.open(p2).crop(BOX).resize(((BOX[2] - BOX[0]) * 2, (BOX[3] - BOX[1]) * 2),
                                Image.LANCZOS).save(OUT + '/s2_box.png')

if not DO_SEND:
    print('PASTED-ONLY'); sys.exit(0)

print('send click ret =', click(*SEND), flush=True)
time.sleep(8.0)
print('DB after+8s  =', db_counts(), flush=True)
cap('s3_sent')
time.sleep(8.0)
print('DB after+16s =', db_counts(), flush=True)
cap('s4_sent16')
print('DONE', flush=True)
