# -*- coding: utf-8 -*-
"""OCR+像素通道投喂 InsCode（UIA 在本机 WebView 上不可用时使用）。
流程：聚焦 → 清空输入框 → 剪贴板粘贴(Ctrl+V, SendInput) → 截图OCR校验 → 点发送钮 → DB复核
用法: python -u feed_ocr.py <payload> [--send]
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

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181f_m320_feed'
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'

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


def db_counts():
    import sqlite3, json
    con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
    try:
        infl = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
        row = con.execute('SELECT body FROM sessions ORDER BY rowid DESC LIMIT 1').fetchone()
        n_user = n_asst = -1
        if row and row[0]:
            msgs = json.loads(row[0]).get('messages', [])
            n_user = len([m for m in msgs if m.get('role') == 'User'])
            n_asst = len([m for m in msgs if m.get('role') == 'Assistant' and (m.get('text') or '').strip()])
        return infl, n_user, n_asst
    finally:
        con.close()


def shot(name):
    p = os.path.join(OUT, name)
    ui.screenshot(p)
    return p


def ocr_find(png, kw):
    r = subprocess.run([PY, OCR, 'find', png, kw], capture_output=True, text=True, errors='replace')
    return r.stdout.strip()


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

# ① OCR 定位输入框
p0 = shot('g0_before.png')
time.sleep(1.2)
hit = ocr_find(p0, '描述你的任务')
print('OCR 描述你的任务 ->', hit, flush=True)
ix, iy = 1000, 1032
if 'center=(' in hit:
    seg = hit.split('center=(')[1].split(')')[0]
    px, py = [float(v) for v in seg.split(',')]
    ix, iy = int(px), int(py)
    # 输入框文本区：占位符在左，点它右移 300px 更稳
    ix = ix + 200
print('click input at', (ix, iy), flush=True)
mouse_click(ix, iy)
time.sleep(0.9)

# ② 清空残留
print('clear n =', chord(0x11, 0x41), flush=True)   # Ctrl+A
time.sleep(0.4)
print('del n =', key(0x2E), key(0x2E, up=True), flush=True)
time.sleep(0.6)

# ③ 粘贴
ui.set_clipboard(text)
time.sleep(0.5)
print('clip match =', ui.get_clipboard() == text, flush=True)
print('ctrl+v n =', chord(0x11, 0x56), flush=True)
time.sleep(2.5)

# ④ 校验：截图 OCR 输入区
p1 = shot('g1_after_paste.png')
time.sleep(1.2)
print('OCR after paste:', ocr_find(p1, 'M3.20'), flush=True)
print('OCR after paste2:', ocr_find(p1, '标准原料词库'), flush=True)

if not DO_SEND:
    print('PASTED-ONLY', flush=True)
    sys.exit(0)

# ⑤ 发送钮：像素定位（深色实心圆 + ↑，在输入框右下）
from PIL import Image
im = Image.open(p1).convert('RGB')
px = im.load()
pts = [(x, y) for y in range(1020, 1080) for x in range(1440, 1540)
       if sum(px[x, y]) < 200]
print('dark pts =', len(pts), flush=True)
if pts:
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    bx, by = (min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2
    print('send btn bbox =', (min(xs), min(ys), max(xs), max(ys)), 'center =', (bx, by), flush=True)
else:
    bx, by = 1492, 1066
    print('pixel fallback send =', (bx, by), flush=True)

print('send-click n =', mouse_click(bx, by), flush=True)
time.sleep(5.0)
print('DB after =', db_counts(), flush=True)
p2 = shot('g2_after_send.png')
print('DONE', flush=True)
