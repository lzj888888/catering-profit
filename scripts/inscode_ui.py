"""Reusable InsCode desktop-UI driver.

Key findings encoded here:
  * The main window is a Tauri window titled 'InsCode' (class 'Tauri Window').
  * Sogou IME eats letters typed via keybd_event -> ALWAYS deliver text via clipboard + Ctrl+V.
  * Never SendMessage(WM_CLOSE) to Notepad-like apps (blocks on modal save dialog). Use PostMessage.
  * Screen is 1920x1080; screenshots via PIL.ImageGrab.
"""
import ctypes, ctypes.wintypes as wt, time, subprocess

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

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002


def _candidates():
    """All 'Tauri Window'-class windows titled 'InsCode', with their rects."""
    found = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, l):
        c = ctypes.create_unicode_buffer(256); u.GetClassNameW(h, c, 256)
        if c.value == "Tauri Window":
            n = u.GetWindowTextLengthW(h)
            b = ctypes.create_unicode_buffer(n + 2); u.GetWindowTextW(h, b, n + 1)
            r = wt.RECT(); u.GetWindowRect(h, ctypes.byref(r))
            if b.value == "InsCode":
                found.append((int(h), r.right - r.left))
        return True
    u.EnumWindows(CB(cb), 0)
    return found


def find_inscode():
    """Return the main InsCode window hwnd (restores it if minimized).

    ⚠️ 2026-09-17 fix: a MINIMIZED window reports rect ≈ (-21333,-21333,-21175,-21307),
    i.e. width 158px -> the old `width > 600` filter returned None and every
    downstream call (focus/screenshot/click) died with an empty image.
    Now: prefer a normal-sized window; if none, restore the minimized one and re-measure.
    """
    cands = _candidates()
    if not cands:
        return None
    big = [h for h, w in cands if w > 600]
    if big:
        return big[0]
    h = cands[0][0]
    u.ShowWindow(h, 9)          # SW_RESTORE
    time.sleep(1.0)
    return h


def focus(hwnd):
    u.ShowWindow(hwnd, 9)          # SW_RESTORE
    u.SetForegroundWindow(hwnd)
    time.sleep(0.7)


def click(x, y, settle=0.9):
    u.SetCursorPos(x, y)
    time.sleep(0.25)
    u.mouse_event(2, 0, 0, 0, 0)
    time.sleep(0.07)
    u.mouse_event(4, 0, 0, 0, 0)
    time.sleep(settle)


def key(vk, ctrl=False, alt=False, shift=False, settle=0.25):
    """⚠️ 2026-09-25: 本机安全软件会拦截 `keybd_event` / `mouse_event`（返回成功但界面零变化）。
    仅当确认 `SendInput` 也不可用时才用它。优先用 `send_vk` / `chord`（见下）。"""
    mods = []
    if ctrl:  mods.append(0x11)
    if shift: mods.append(0x10)
    if alt:   mods.append(0x12)
    for m in mods: u.keybd_event(m, 0, 0, 0)
    u.keybd_event(vk, 0, 0, 0)
    u.keybd_event(vk, 0, 2, 0)
    for m in reversed(mods): u.keybd_event(m, 0, 2, 0)
    time.sleep(settle)


# ───────────────────────────── SendInput 通道（实测可用）─────────────────────────────
# 2026-09-25 实测：`mouse_event` / `keybd_event` 被安全软件拦（CursorPos 能动、
# 但点击/按键对界面零效果）；而 **SendInput 未被拦**（返回 1）且真实生效：
#   UIA SetFocus 到输入框 → SendInput Ctrl+V 粘贴 → 输入框 len 由 0 变 8518
#   → 前端框架收到真实 paste 事件 → 发送按钮 legacy state 由 0x1(UNAVAILABLE) 变 0x100000
#   → SendInput Enter → 消息真正发出（数据库 inflight_turn 出现记录）。
# ⚠️ 纯 UIA `ValuePattern.SetValue` 虽能改 DOM 值，但**不触发前端状态更新**
#    ⇒ 发送按钮保持 disabled、UIA Invoke 返回 0x80040200(UIA_E_NOTSUPPORTED)。
#    投喂长文本必须走「剪贴板 + SendInput Ctrl+V」这条真实输入路径。
import ctypes.wintypes as _wt
_PUL = ctypes.POINTER(ctypes.c_ulong)


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", _wt.WORD), ("wScan", _wt.WORD), ("dwFlags", _wt.DWORD),
                ("time", _wt.DWORD), ("dwExtraInfo", _PUL)]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", _wt.LONG), ("dy", _wt.LONG), ("mouseData", _wt.DWORD),
                ("dwFlags", _wt.DWORD), ("time", _wt.DWORD), ("dwExtraInfo", _PUL)]


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", _wt.DWORD), ("wParamL", _wt.WORD), ("wParamH", _wt.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT), ("hi", _HARDWAREINPUT)]


class _INPUT(ctypes.Structure):
    _fields_ = [("type", _wt.DWORD), ("u", _INPUTUNION)]


def send_vk(vk, up=False):
    """SendInput 单键。返回 1 = 投递成功（0 = 被 UIPI/安全软件拦）。"""
    inp = _INPUT(type=1, u=_INPUTUNION(ki=_KEYBDINPUT(vk, 0, 2 if up else 0, 0, None)))
    return u.SendInput(1, ctypes.byref(inp), ctypes.sizeof(_INPUT))


def chord(*vks, hold=0.05):
    """SendInput 组合键，例如 chord(0x11, 0x56) = Ctrl+V。返回是否全部投递成功。"""
    ok = all(send_vk(v) for v in vks)
    time.sleep(hold)
    for v in reversed(vks):
        send_vk(v, up=True)
    return ok


def set_clipboard(text):
    """⚠️ 2026-09-25 FIX: 必须按 **UTF-16 code unit** 计长，不能按 Python 字符数。

    旧写法 `GlobalAlloc((len(text)+1)*2)` 按 Python 字符数分配：非 BMP 字符
    （🔴/⚠️ 等，1 个 Python 字符 = 2 个 UTF-16 unit）会少分配 unit ⇒
    **文本尾部被静默截断**。实测：8525 字符载荷（含 7 个 🔴）装进剪贴板后只剩
    8518，尾部 7 字符 `单，再动手。\n` 丢失 —— 而长度读回"看起来正常"，
    只在逐字 diff 时才暴露 ⇒ 属于必须防的静默数据损失。
    """
    data = text.encode('utf-16-le') + b'\x00\x00'
    n = len(data)
    h = k.GlobalAlloc(GMEM_MOVEABLE, n)
    p = k.GlobalLock(h)
    ctypes.memmove(ctypes.c_void_p(p), data, n)
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
        p = k.GlobalLock(h)
        val = ctypes.wstring_at(p)
        k.GlobalUnlock(h)
    u.CloseClipboard()
    return val


def screenshot(path):
    from PIL import ImageGrab
    img = ImageGrab.grab()
    img.save(path)
    return path
