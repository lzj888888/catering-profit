# -*- coding: utf-8 -*-
"""投喂（send_e5）：TOPMOST+激活 → **先清 composer 残渣** → (点击 → 粘贴 → 判 diff) 重试 → 点发送 → DB 判据。

与 send_e4 的差异（两条实测修正，2026-09-30 R181j 第 5 轮）：
1. 🔴 send_e4 的"打字探针"打字符后只等 **0.55s** 就截图 ⇒ **截到旧帧 ⇒ diff=0 ⇒ 误判"没聚焦"**，
   而字符**其实已经注入**（残留在 composer 里的 'xx' 就是证据）。⇒ 本轮**彻底不用探针字符**：
   直接粘贴**长载荷**（1527 字符）判 diff —— 长文本 diff 信号强（实测 >7000），且**零污染**。
2. 🔴 进入投喂前先**清 composer 残渣**（点框 → End → Backspace ×N），并**像素验证回到基线**，
   避免残渣（如上一轮遗留的 'xx'）混进载荷里。

用法: python -u send_e5.py <payload.txt> [--send]
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
base = cap('e0_base'); time.sleep(0.35)

# ===== 步骤 1：清 composer 残渣（End + Backspace ×12）=====
# 🔴 判据必须是「**二次清空幂等**」而不是「与投喂前帧比」——
#    投喂前的帧本身可能就是**脏的**（例如上一轮探针留下的 'xx'），拿它当基线会把"清成功"判成"还有残渣"。
#    正确做法：清一次得 A，再清一次得 B；若 diff(A,B) ≈ 0 ⇒ composer 已稳定在干净态（再清也没变化）。
print('-- 清残渣（End + Backspace x12；判据=二次清空幂等）--', flush=True)


def clear_once():
    click(CX, CY)
    time.sleep(0.8)
    tap(0x23)                       # VK_END 到行尾
    time.sleep(0.25)
    for _ in range(12):
        tap(0x08)                   # Backspace
        time.sleep(0.07)
    time.sleep(1.6)                 # ⚠️ 必须够长，否则截到旧帧


clear_once()
pa = cap('e1_cleared')
clear_once()
pb = cap('e1b_cleared')
dc, bb = diff(pa, pb)
print('  清空幂等 diff = %d bbox = %s  (<30 ⇒ 已干净且稳定)' % (dc, bb), flush=True)
if dc >= 30:
    clear_once()
    pc2 = cap('e1c_cleared')
    dc2, _ = diff(pb, pc2)
    print('  第三次清空 diff = %d' % dc2, flush=True)
    if dc2 >= 30:
        print('!! composer 反复变化、无法判定干净 —— 中止，需人工看一眼', flush=True); sys.exit(6)
print('  ✅ composer 判定为干净', flush=True)

# ===== 步骤 2：点击 → 粘贴 → 判 diff（失败重试；不用探针字符）=====
print('clip set = %s | match = %s' % (ui.set_clipboard(text), ui.get_clipboard() == text), flush=True)
pasted = False
for attempt in range(1, 4):
    cx = CX if attempt == 1 else (CX + 120 if attempt == 2 else CX - 120)
    print('-- paste try %d (click %d,%d) --' % (attempt, cx, CY), flush=True)
    click(cx, CY)
    time.sleep(0.9)
    p0 = cap('s%d_pre' % attempt)
    time.sleep(0.3)
    # Shift+Insert（Ctrl+V 会被 InsCode 吞掉）
    kd(0x10); time.sleep(0.08); kd(0x2D); time.sleep(0.08); kd(0x2D, up=True); kd(0x10, up=True)
    time.sleep(3.4)             # ⚠️ 长等待，避开旧帧
    p2 = cap('s%d_pasted' % attempt)
    pd, bb = diff(p0, p2)
    print('  PASTE diff = %d bbox = %s' % (pd, bb), flush=True)
    if pd >= 300:
        pasted = True
        break
    time.sleep(0.8)

if not pasted:
    print('!! 三次粘贴均失败 —— 中止（先截图看 composer 与页面归属）', flush=True); sys.exit(5)

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
