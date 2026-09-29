import ctypes, sys, time, json, sqlite3
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(6.0)

DB = 'file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro'
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


def mclick(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.3)
    n = _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, 0x0002, 0, None)))); time.sleep(0.08)
    n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, 0x0004, 0, None))))
    return n


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def counts():
    con = sqlite3.connect(DB, uri=True)
    body = con.execute("SELECT body FROM sessions ORDER BY updated_at DESC LIMIT 1").fetchone()[0]
    msgs = json.loads(body)['messages']
    u = sum(1 for m in msgs if m.get('role') == 'User' and (m.get('text') or '').strip())
    a = sum(1 for m in msgs if m.get('role') == 'Assistant' and (m.get('text') or '').strip())
    inF = con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0]
    con.close()
    return u, a, inF


h = ui.find_inscode()
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception: pass
time.sleep(0.7)

print('BEFORE  user/assistant/inflight =', counts())

u_, a_, f_ = counts()

# 方式 A：Enter
print('enter n =', key(0x0D), end=' ')
time.sleep(0.15); key(0x0D, up=True)
time.sleep(4.0)
after = counts()
print('-> after', after)
if after[2] > 0 or after[0] > u_:
    print('SENT-BOARD via Enter')
    sys.exit(0)

# 方式 B：Ctrl+Enter
print('ctrl+enter ...')
key(0x11); time.sleep(0.05)
key(0x0D); time.sleep(0.12); key(0x0D, up=True)
key(0x11, up=True)
time.sleep(4.0)
after = counts()
print('-> after', after)
if after[2] > 0 or after[0] > u_:
    print('SENT-BOARD via Ctrl+Enter')
    sys.exit(0)

# 方式 C：点发送钮
SX, SY = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (1409, 985)
print('click send btn at', SX, SY, 'n =', mclick(SX, SY))
time.sleep(4.0)
after = counts()
print('-> after', after)
print('SENT-BOARD via button' if (after[2] > 0 or after[0] > u_) else 'ALL-METHODS-FAILED')
