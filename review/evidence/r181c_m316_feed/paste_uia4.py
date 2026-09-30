import ctypes, sys, time, os
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(5.0)

PAYLOAD = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/lzj/AppData/Local/Temp/inscode/feed_m316.txt'
DO_SEND = '--send' in sys.argv
text = open(PAYLOAD, encoding='utf-8').read()
print('payload len =', len(text))

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


def ctrl_v():
    r = key(0x11); time.sleep(0.05)
    r += key(0x56); time.sleep(0.08); r += key(0x56, up=True); time.sleep(0.05)
    r += key(0x11, up=True)
    return r


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.07)
    return n


h = ui.find_inscode()
print('hwnd', h, win32gui.GetWindowRect(h))
try:
    win32gui.ShowWindow(h, win32con.SW_RESTORE)
except Exception:
    pass
time.sleep(0.3)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e)
time.sleep(1.2)


def collect_docs():
    u = ctypes.windll.user32
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    rows = []

    def cb(ch, l):
        b = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(ch, b, 256)
        rows.append(int(ch))
        return True
    u.EnumChildWindows(h, CB(cb), 0)
    out = []
    for hw in rows:
        try:
            c = auto.ControlFromHandle(hw)
            if not c:
                continue
            if c.ControlTypeName == 'DocumentControl':
                out.append(c)
            else:
                for k in c.GetChildren():
                    if k.ControlTypeName == 'DocumentControl':
                        out.append(k)
        except Exception:
            continue
    return out


def pick_edit():
    docs = collect_docs()
    # ① 优先 AutomationId == RootWebArea
    for d in docs:
        try:
            if (d.AutomationId or '') == 'RootWebArea':
                try:
                    e = d.EditControl(searchDepth=25)
                    if e.Exists(1.5, 0.3):
                        r = e.BoundingRectangle
                        if r.right > r.left and r.bottom > r.top:
                            return e, 'RootWebArea'
                except Exception:
                    pass
        except Exception:
            pass
    # ② 退回：任意能取到有效 rect 的 edit
    for d in docs:
        try:
            e = d.EditControl(searchDepth=25)
            if e.Exists(1.2, 0.25):
                r = e.BoundingRectangle
                if r.right > r.left + 50 and r.bottom > r.top + 5:
                    return e, 'fallback(%s)' % (d.AutomationId or '')
        except Exception:
            continue
    return None, 'none'


edit, how = None, ''
for i in range(3):
    edit, how = pick_edit()
    if edit:
        break
    print(' attempt %d no edit' % (i + 1))
    time.sleep(1.2)
print('edit via', how, '=', edit is not None)
if not edit:
    print('NO-EDIT')
    sys.exit(1)

r = edit.BoundingRectangle
print('edit rect =', (r.left, r.top, r.right, r.bottom))
cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
print('center', cx, cy)


def val():
    try:
        return edit.GetValuePattern().Value or ''
    except Exception:
        return ''


print('before len', len(val()))
print('click n =', mouse_click(cx, cy))
time.sleep(1.0)
ui.set_clipboard(text)
time.sleep(0.5)
print('clip match =', ui.get_clipboard() == text)
print('ctrl+v n =', ctrl_v())
time.sleep(2.5)
after = val()
print('after len =', len(after))
print('after head =', after[:70].replace('\n', ' | '))
if len(after) == len(text):
    print('PASTE-OK')
    if DO_SEND:
        print('send-click n =', mouse_click(1411, 981))
        time.sleep(3.5)
        import sqlite3
        con = sqlite3.connect('file:C:/Users/lzj/.config/inscode/inscode.db?mode=ro', uri=True)
        print('inflight =', con.execute('SELECT count(*) FROM inflight_turn').fetchone()[0])
else:
    print('PASTE-FAILED')
