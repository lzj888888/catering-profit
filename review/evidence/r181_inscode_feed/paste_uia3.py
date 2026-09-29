import ctypes, sys, time, os
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(6.0)

PAYLOAD = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/lzj/AppData/Local/Temp/inscode/feed_r174.txt'
DO_SEND = '--send' in sys.argv
text = open(PAYLOAD, encoding='utf-8').read()

ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG),
                ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class _IU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _IU)]


_SI = ctypes.windll.user32.SendInput   # 不设 argtypes，避免污染 inscode_ui
_SI.restype = wintypes.UINT


def _one(inp):
    return _SI(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def mouse_click(x, y):
    win32api.SetCursorPos((x, y))
    time.sleep(0.35)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None))))
        time.sleep(0.06)
    return n


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def ctrl_v():
    r = key(0x11); time.sleep(0.05)
    r += key(0x56); time.sleep(0.08); r += key(0x56, up=True); time.sleep(0.05)
    r += key(0x11, up=True)
    return r


h = ui.find_inscode()
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e)
time.sleep(0.8)
print('hwnd', h, win32gui.GetWindowRect(h))

u = ctypes.windll.user32
CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
rows = []
def _cb(ch, l):
    buf = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(ch, buf, 256)
    rows.append((int(ch), buf.value))
    return True
u.EnumChildWindows(h, CB(_cb), 0)
doc = None
for hw, cls in rows:
    try:
        c = auto.ControlFromHandle(hw)
        if not c: continue
        if c.ControlTypeName == 'DocumentControl':
            doc = c; break
        for k in c.GetChildren():
            if k.ControlTypeName == 'DocumentControl':
                doc = k; break
    except Exception as e:
        print('  uia probe skip', type(e).__name__)
        continue
    if doc: break
if doc is None:
    for _ in range(3):
        try:
            c = auto.ControlFromHandle(h)
            for k in c.GetChildren():
                if k.ControlTypeName == 'DocumentControl':
                    doc = k; break
        except Exception:
            pass
        if doc: break
        time.sleep(0.8)
print('doc =', doc)
edit = doc.EditControl(searchDepth=25)
r = edit.BoundingRectangle
cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
print('edit center', cx, cy)


def val():
    try: return edit.GetValuePattern().Value or ''
    except Exception: return ''


print('before len', len(val()))
print('click n =', mouse_click(cx, cy))
time.sleep(0.9)

ui.set_clipboard(text)
time.sleep(0.5)
rb = ui.get_clipboard()
print('clip match =', rb == text)
print('ctrl+v n =', ctrl_v())
time.sleep(2.5)
after = val()
print('after len =', len(after))
print('after head =', after[:90].replace('\n', ' | '))

if len(after) == len(text):
    print('PASTE-OK')
    if DO_SEND:
        print('enter n =', key(0x0D)); time.sleep(0.15); key(0x0D, up=True)
        time.sleep(4.0)
        import sqlite3
        con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
        print('inflight =', con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0])
        print('post-send len =', len(val()))
else:
    print('PASTE-FAILED')
