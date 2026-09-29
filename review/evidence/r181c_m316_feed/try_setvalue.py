import ctypes, sys, time
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(5.0)

PAYLOAD = r'C:/Users/lzj/AppData/Local/Temp/inscode/feed_m316.txt'
text = open(PAYLOAD, encoding='utf-8').read()
print('payload len =', len(text))

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
time.sleep(1.0)
print('fg =', win32gui.GetForegroundWindow(), 'ok=', win32gui.GetForegroundWindow() == h)

u = ctypes.windll.user32
CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
rows = []


def cb(ch, l):
    b = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(ch, b, 256)
    rows.append((int(ch), b.value))
    return True


u.EnumChildWindows(h, CB(cb), 0)
print('child windows =', len(rows))
doc = None
for hw, cls in rows:
    try:
        c = auto.ControlFromHandle(hw)
        if not c:
            continue
        if c.ControlTypeName == 'DocumentControl':
            doc = c; break
        for k in c.GetChildren():
            if k.ControlTypeName == 'DocumentControl':
                doc = k; break
    except Exception:
        continue
    if doc:
        break
print('doc =', doc is not None)

edit = None
if doc:
    try:
        e = doc.EditControl(searchDepth=25)
        if e.Exists(1.5, 0.3):
            edit = e
    except Exception as ex:
        print('edit err', type(ex).__name__, ex)
print('edit =', edit is not None)

if edit:
    r = edit.BoundingRectangle
    print('edit rect =', (r.left, r.top, r.right, r.bottom))
    try:
        v = edit.GetValuePattern().Value or ''
        print('len before =', len(v), '| head =', repr(v[:50]))
    except Exception as ex:
        print('read err', type(ex).__name__, ex)
    try:
        edit.GetValuePattern().SetValue(text)
        print('SETVALUE called')
    except Exception as ex:
        print('SETVALUE err', type(ex).__name__, ex)
    time.sleep(1.2)
    try:
        v = edit.GetValuePattern().Value or ''
        print('len after =', len(v), '| match =', v == text)
        print('head =', repr(v[:80]))
    except Exception as ex:
        print('read2 err', type(ex).__name__, ex)
print('DONE')
