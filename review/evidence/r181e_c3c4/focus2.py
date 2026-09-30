# -*- coding: utf-8 -*-
"""强化置前：关掉自己开的 cmd 窗口 → SwitchToThisWindow/AttachThreadInput/TOPMOST 三管齐下。"""
import sys, time, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

u = ctypes.windll.user32
k = ctypes.windll.kernel32
user32 = u


def win_text(h):
    b = ctypes.create_unicode_buffer(512)
    u.GetWindowTextW(h, b, 512)
    return b.value


def cls_name(h):
    b = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(h, b, 256)
    return b.value


fg = u.GetForegroundWindow()
print('FG hwnd=%s cls=%r title=%r' % (fg, cls_name(fg), win_text(fg)), flush=True)

# 1) 关掉我方开的 cmd 窗口
killed = []
for w in find_windows(title='cmd.exe'):
    print('close cmd hwnd=%s rect=%s' % (w, rect(w)), flush=True)
    u.PostMessageW(w, 0x0010, 0, 0)   # WM_CLOSE
    killed.append(w)
time.sleep(1.5)
print('closed cmds =', len(killed), flush=True)

h = find_window(title='云开发控制台')


def force_focus2(h):
    tid_cur = k.GetCurrentThreadId()
    for i in range(6):
        # cross-thread attach ⇒ 允许 SetForegroundWindow 成功
        tid_tgt = u.GetWindowThreadProcessId(h, None)
        u.AttachThreadInput(tid_cur, tid_tgt, True)
        u.ShowWindow(h, 9)
        u.BringWindowToTop(h)
        u.SetActiveWindow(h)
        u.SetForegroundWindow(h)
        u.AttachThreadInput(tid_cur, tid_tgt, False)
        time.sleep(0.3)
        if u.GetForegroundWindow() == h:
            return True, i + 1
        # 2) SwitchToThisWindow 兜底
        u.SwitchToThisWindow(h, True)
        time.sleep(0.3)
        if u.GetForegroundWindow() == h:
            return True, i + 1
        # 3) 短暂 TOPMOST
        u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002)
        time.sleep(0.35)
        if u.GetForegroundWindow() == h:
            return True, i + 1
        u.SetWindowPos(h, -2, 0, 0, 0, 0, 0x0001 | 0x0002)
    return False, 6


ok, n = force_focus2(h)
print('CONTROL focus=%s tries=%d' % (ok, n), flush=True)
if ok:
    click(150, 264)
    time.sleep(6)
    screenshot_screen(r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4/c11_db.png')
    print('clicked db + shot', flush=True)
