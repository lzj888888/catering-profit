import ctypes, sys, time, io, json
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(3.0)

PREFS = r'C:\Users\lzj\.config\inscode\ui_preferences.json'
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


def _one(i): return _SI(1, ctypes.byref(i), ctypes.sizeof(INPUT))


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def click(x, y, hold=0.12):
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, 0x0002, 0, None))))
    time.sleep(hold)
    n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, 0x0004, 0, None))))
    return n


def ctrl_m():
    for v, u in ((0x11, False), (0x4D, False), (0x4D, True), (0x11, True)):
        key(v, u); time.sleep(0.08)


def prefs_model():
    try:
        return json.loads(io.open(PREFS, encoding='utf-8').read()).get('last_model_selection')
    except Exception as e:
        return 'read err %s' % e


h = ui.find_inscode()
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.0)


def findit():
    try:
        w = auto.ControlFromHandle(h)
        it = auto.Control(searchFromControl=w, ControlType=auto.ControlType.MenuItemControl,
                          Name='deepseek-v4-pro', searchDepth=20)
        return it if it.Exists(1.2, 0.3) else None
    except Exception:
        return None


print('prefs BEFORE =', prefs_model())
it = findit()
print('float visible =', it is not None)
if it is None:
    ctrl_m(); time.sleep(2.4)
    it = findit(); print('after ctrl+m =', it is not None)

if it is not None:
    # 通道 1：UIA Invoke
    try:
        pat = it.GetInvokePattern()
        pat.Invoke()
        print('INVOKE ok')
    except Exception as e:
        print('invoke unavailable:', type(e).__name__, str(e)[:80])
        # 通道 2：更长按压的物理点击
        r = it.BoundingRectangle
        cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
        print('fallback click at', cx, cy, 'n =', click(cx, cy, 0.15))
    time.sleep(5.0)
    print('prefs AFTER  =', prefs_model())
    print('float still visible =', findit() is not None)
else:
    print('ITEM NOT FOUND')
print('DONE')
