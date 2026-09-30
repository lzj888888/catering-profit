# -*- coding: utf-8 -*-
"""投喂（健壮版 send_e4）：TOPMOST+激活 → **聚焦自检（打字探针 + 重试）** → Shift+Insert → 像素校验 → 点发送 → DB 判据。

为什么需要聚焦自检：R181j 实测「click composer → Shift+Insert」会**间歇性 diff=0**（同样坐标上次成功这次失败）
⇒ 点完不知道有没有真聚焦。本脚本先打一个 ASCII 探针字符并截图比对，确认焦点在 composer 后再粘贴。

用法: python -u send_e4.py <payload.txt> [--send]
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
SI.restype = wintypes.UINT          # ⚠️ 不要设 argtypes（会破坏 inscode_ui.send_vk）
u = ctypes.windll.user32


def one(i):
    return SI(1, ctypes.byref(i), ctypes.sizeof(INP))


def kd(vk, up=False):
    return one(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk):
    kd(vk); time.sleep(0.05); kd(vk, up=True)


h = ui.find_inscode()
if not h:
    print('NO-WINDOW'); sys.exit(3)
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


def click(x, y):
    try:
        ow = win32gui.GetAncestor(u.WindowFromPoint(wintypes.POINT(x, y)), win32con.GA_ROOT)
    except Exception:
        ow = None
    if ow != h:
        print('OWNER-MISMATCH at (%d,%d) owner=%s h=%s -> ABORT' % (x, y, ow, h), flush=True)
        sys.exit(7)
    win32api.SetCursorPos((x, y)); time.sleep(0.35)
    n = 0
    for f in (0x0002, 0x0004):
        n += one(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))); time.sleep(0.13)
    return n


def db_counts():
    import sqlite3, json
    con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
    try:
        infl = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
        row = con.execute('SELECT body FROM sessions ORDER BY updated_at DESC LIMIT 1').fetchone()
        nu = -1
        if row and row[0]:
            nu = len([m for m in json.loads(row[0]).get('messages', []) if m.get('role') == 'User'])
        return infl, nu
    finally:
        con.close()


L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), flush=True)
BOX = (470, 925, 1440, 980)          # composer 文本区（屏幕坐标，窗口 (20,20,1620,1000)）
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
base = cap('f0_base'); time.sleep(0.35)

# ===== 聚焦自检：打字探针 'x' + 重试 =====
focused = False
for attempt in range(1, 6):
    click(CX, CY)
    time.sleep(0.7)
    # 点不同位置重试（第一次正中，之后偏左一点）
    if attempt >= 3:
        click(CX - 180, CY)
        time.sleep(0.5)
    tap(0x58)                        # 'x'
    time.sleep(0.55)
    p = cap('f%d_probe' % attempt)
    d, bb = diff(base, p)
    print('  focus try %d: diff=%d bbox=%s' % (attempt, d, bb), flush=True)
    if d > 30:
        focused = True
        tap(0x08)                    # Backspace 删掉探针 'x'
        time.sleep(0.4)
        cap('f%d_backspace' % attempt)
        print('  FOCUS OK (attempt %d)' % attempt, flush=True)
        break
    time.sleep(0.5)

if not focused:
    print('FOCUS-FAIL —— 5 次尝试均无法让 composer 获得焦点，中止', flush=True)
    sys.exit(8)

p0 = cap('s0_pre'); time.sleep(0.4)
print('clip set =', ui.set_clipboard(text), '| match =', ui.get_clipboard() == text, flush=True)
time.sleep(0.4)
kd(0x10); time.sleep(0.08); kd(0x2D); time.sleep(0.08); kd(0x2D, up=True); kd(0x10, up=True)
time.sleep(3.4)
p2 = cap('s2_pasted')
pd, bb = diff(p0, p2)
print('PASTE diff =', pd, 'bbox =', bb, flush=True)
if pd < 300:
    print('!! 粘贴失败 —— 中止', flush=True); sys.exit(5)
Image.open(p2).crop(BOX).resize(((BOX[2] - BOX[0]) * 2, (BOX[3] - BOX[1]) * 2),
                                Image.LANCZOS).save(OUT + '/s2_box.png')

if not DO_SEND:
    print('PASTED-ONLY', flush=True); sys.exit(0)

print('send click ret =', click(*SEND), flush=True)
time.sleep(8.0)
print('DB after+8s  =', db_counts(), flush=True)
cap('s3_sent')
time.sleep(8.0)
print('DB after+16s =', db_counts(), flush=True)
cap('s4_sent16')
print('DONE', flush=True)
