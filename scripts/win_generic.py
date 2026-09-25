"""Generic Windows desktop driver (extracted & generalized from inscode_ui.py).

Same primitives, but NOT tied to InsCode: target any window by title / class.

Usage examples:
    from win_generic import *
    hwnd = find_window(title='catering-profit')
    focus(hwnd)
    screenshot_window(hwnd, r'C:\\temp\\a.png')
    key(0x42, ctrl=True)                    # Ctrl+B (compile in WeChat DevTools)
    click(x, y)
    set_clipboard('some text'); key(0x56, ctrl=True)   # Ctrl+V paste

Notes encoded from real sessions:
  * Always SetProcessDPIAware() first or coords/screenshots drift on HiDPI.
  * keybd_event loses characters under Sogou IME -> deliver text via clipboard + Ctrl+V.
  * SetForegroundWindow may silently fail -> fall back to AttachThreadInput.
  * Never SendMessage(WM_CLOSE) to Notepad-like apps (modal save dialog); use PostMessage.
"""
import ctypes, ctypes.wintypes as wt, time

u = ctypes.windll.user32
k = ctypes.windll.kernel32
u.SetProcessDPIAware()

k.GlobalAlloc.restype = ctypes.c_void_p
k.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
k.GlobalLock.restype = ctypes.c_void_p
k.GlobalLock.argtypes = [ctypes.c_void_p]
k.GlobalUnlock.restype = ctypes.c_int
k.GlobalUnlock.argtypes = [ctypes.c_void_p]
u.OpenClipboard.argtypes = [ctypes.c_void_p]
u.SetClipboardData.restype = ctypes.c_void_p
u.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
u.GetClipboardData.restype = ctypes.c_void_p
u.GetClipboardData.argtypes = [ctypes.c_uint]
# NOTE: AttachThreadInput lives in USER32 (not kernel32) — bug fixed 2026-09-16.
u.AttachThreadInput.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_bool]
u.AttachThreadInput.restype = ctypes.c_bool
u.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(ctypes.c_ulong)]
u.GetWindowThreadProcessId.restype = ctypes.c_ulong

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

VK = {'CTRL': 0x11, 'ALT': 0x12, 'SHIFT': 0x10, 'ENTER': 0x0D, 'ESC': 0x1B,
      'TAB': 0x09, 'F5': 0x74, 'V': 0x56, 'B': 0x42, 'S': 0x53}


def enum_windows():
    """Return [(hwnd, class, title, w, h), ...] for visible titled windows."""
    out = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

    def cb(h, l):
        if u.IsWindowVisible(h):
            c = ctypes.create_unicode_buffer(256); u.GetClassNameW(h, c, 256)
            n = u.GetWindowTextLengthW(h)
            b = ctypes.create_unicode_buffer(n + 2); u.GetWindowTextW(h, b, n + 1)
            if b.value.strip():
                r = wt.RECT(); u.GetWindowRect(h, ctypes.byref(r))
                out.append((int(h), c.value, b.value, r.right - r.left, r.bottom - r.top))
        return True
    u.EnumWindows(CB(cb), 0)
    return out


def find_window(title=None, cls=None, contains=False):
    """Find first hwnd matching title (exact or substring) and/or window class."""
    for h, c, t, w, hh in enum_windows():
        ok_t = True
        if title:
            ok_t = (title in t) if contains else (t == title)
        ok_c = True if not cls else (cls in c if contains else c == cls)
        if ok_t and ok_c:
            return h
    return None


def rect(hwnd):
    r = wt.RECT(); u.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def focus(hwnd, settle=0.7):
    u.ShowWindow(hwnd, 9)                      # SW_RESTORE
    if not u.SetForegroundWindow(hwnd):
        fg = u.GetForegroundWindow()
        tf = u.GetWindowThreadProcessId(fg, None)
        tt = u.GetWindowThreadProcessId(hwnd, None)
        u.AttachThreadInput(tf, tt, True)      # USER32, not kernel32
        u.SetForegroundWindow(hwnd)
        u.AttachThreadInput(tf, tt, False)
    time.sleep(settle)
    return u.GetForegroundWindow() == hwnd


def click(x, y, settle=0.9):
    u.SetCursorPos(int(x), int(y)); time.sleep(0.25)
    u.mouse_event(2, 0, 0, 0, 0); time.sleep(0.07)          # left down
    u.mouse_event(4, 0, 0, 0, 0); time.sleep(settle)        # left up


def move_to(x, y):
    u.SetCursorPos(int(x), int(y)); time.sleep(0.2)


def key(vk, ctrl=False, alt=False, shift=False, settle=0.25):
    mods = []
    if ctrl:  mods.append(VK['CTRL'])
    if shift: mods.append(VK['SHIFT'])
    if alt:   mods.append(VK['ALT'])
    for m in mods: u.keybd_event(m, 0, 0, 0)
    u.keybd_event(vk, 0, 0, 0)
    u.keybd_event(vk, 0, 2, 0)
    for m in reversed(mods): u.keybd_event(m, 0, 2, 0)
    time.sleep(settle)


def type_text(text):
    """Safe text entry: clipboard + Ctrl+V (IME-proof). Returns True on paste."""
    return set_clipboard(text) and (key(VK['V'], ctrl=True), True)[1]


def set_clipboard(text):
    h = k.GlobalAlloc(GMEM_MOVEABLE, (len(text) + 1) * 2)
    p = k.GlobalLock(h)
    ctypes.memmove(ctypes.c_void_p(p), ctypes.create_unicode_buffer(text), (len(text) + 1) * 2)
    k.GlobalUnlock(h)
    for _ in range(10):
        if u.OpenClipboard(None):
            u.EmptyClipboard()
            u.SetClipboardData(CF_UNICODETEXT, h)
            u.CloseClipboard()
            return True
        time.sleep(0.3)
    return False


def get_clipboard():
    if not u.OpenClipboard(None):
        return None
    h = u.GetClipboardData(CF_UNICODETEXT)
    val = None
    if h:
        p = k.GlobalLock(h); val = ctypes.wstring_at(p); k.GlobalUnlock(h)
    u.CloseClipboard()
    return val


def screenshot_screen(path):
    from PIL import ImageGrab
    im = ImageGrab.grab(); im.save(path)
    return str(path)


def screenshot_window(hwnd, path):
    from PIL import ImageGrab
    im = ImageGrab.grab(bbox=rect(hwnd)); im.save(path)
    return str(path)
