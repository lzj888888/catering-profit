# -*- coding: utf-8 -*-
"""查键盘焦点归属：GetGUIThreadInfo + 尝试 AttachThreadInput 强制聚焦 InsCode。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api, win32process
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui

u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD),
                ("hwndActive", wintypes.HWND), ("hwndFocus", wintypes.HWND),
                ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND),
                ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND),
                ("rcCaret", wintypes.RECT)]


def gti(tid):
    g = GUITHREADINFO(); g.cbSize = ctypes.sizeof(GUITHREADINFO)
    ok = u32.GetGUIThreadInfo(tid, ctypes.byref(g))
    return ok, g


h = ui.find_inscode()
print('InsCode hwnd =', h, flush=True)
fg = win32gui.GetForegroundWindow()
fg_tid, fg_pid = win32process.GetWindowThreadProcessId(fg)
ic_tid, ic_pid = win32process.GetWindowThreadProcessId(h)
print('fg hwnd =', fg, 'title =', repr(win32gui.GetWindowText(fg)), 'tid =', fg_tid, 'pid =', fg_pid, flush=True)
print('InsCode tid =', ic_tid, 'pid =', ic_pid, flush=True)
for name, tid in [('fg', fg_tid), ('inscode', ic_tid), ('self', k32.GetCurrentThreadId())]:
    ok, g = gti(tid)
    print('  [%s] tid=%s ok=%s hwndFocus=%s hwndActive=%s hwndCaret=%s' % (
        name, tid, ok, g.hwndFocus, g.hwndActive, g.hwndCaret), flush=True)
    if g.hwndFocus:
        try:
            print('       focus cls=%r title=%r' % (win32gui.GetClassName(g.hwndFocus),
                                                   win32gui.GetWindowText(g.hwndFocus)[:40]), flush=True)
        except Exception:
            pass

print()
print('=== 尝试 AttachThreadInput 强制聚焦 ===')
my_tid = k32.GetCurrentThreadId()
u32.AttachThreadInput(my_tid, ic_tid, True)
try:
    u32.BringWindowToTop(h)
    u32.SetForegroundWindow(h)
    ok_setfocus = u32.SetFocus(h)
    time.sleep(0.5)
    ok2, g2 = gti(ic_tid)
    print('SetFocus ret =', ok_setfocus, '| after: hwndFocus=%s hwndActive=%s' % (g2.hwndFocus, g2.hwndActive), flush=True)
    # 焦点下沉到 WebView 子窗口
    kids = []
    win32gui.EnumChildWindows(h, lambda c, l: kids.append((c, win32gui.GetClassName(c))) or True, None)
    for c, cls in kids:
        if cls in ('Chrome_RenderWidgetHostHWND', 'WRY_WEBVIEW', 'Chrome_WidgetWin_0'):
            r = u32.SetFocus(c)
            time.sleep(0.35)
            ok3, g3 = gti(ic_tid)
            print('  SetFocus(0x%x %s) ret=%s -> hwndFocus=%s' % (c, cls, r, g3.hwndFocus), flush=True)
            if g3.hwndFocus == c:
                print('  >>> 命中：%s 拿到焦点' % cls, flush=True)
                break
finally:
    u32.AttachThreadInput(my_tid, ic_tid, False)

ok4, g4 = gti(ic_tid)
print('最终 hwndFocus =', g4.hwndFocus, '| hwndActive =', g4.hwndActive, flush=True)
