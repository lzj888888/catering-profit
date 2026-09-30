import ctypes, sys, time
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(4.0)

ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _IU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _IU)]


_SI = ctypes.windll.user32.SendInput
_SI.restype = wintypes.UINT


def _one(i): return _SI(1, ctypes.byref(i), ctypes.sizeof(INPUT))


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


h = ui.find_inscode()
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(0.8)

kv = [v for v, u in ((0x11, False), (0x4D, False), (0x4D, True), (0x11, True))]
n = 0
for v, u in ((0x11, False), (0x4D, False), (0x4D, True), (0x11, True)):
    n += key(v, u); time.sleep(0.08)
print('ctrl+m sent =', n)
time.sleep(2.2)

w = auto.ControlFromHandle(h)
rows = []
for c, d in auto.WalkControl(w, maxDepth=22):
    try:
        nm = (c.Name or '')
        low = nm.lower()
        if any(k in low for k in ('deepseek', 'doubao', 'glm', 'kimi', 'qwen', 'minimax', 'ernie',
                                  'seedance', '个人余额', '个人套餐', '额度', '模型')):
            r = c.BoundingRectangle
            rows.append((d, c.ControlTypeName, nm[:56], (r.left, r.top, r.right, r.bottom)))
    except Exception:
        pass
print('hits =', len(rows))
for x in rows[:40]:
    print('  d=%-3d %-18s %-56s %s' % x)
print('DONE')
