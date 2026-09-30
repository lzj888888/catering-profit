# -*- coding: utf-8 -*-
"""强制置前工具：Alt 轻敲解锁前台权限 + 多次重试，返回是否成功。"""
import sys, time, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
u = ctypes.windll.user32


def force_focus(h, tries=8):
    for i in range(tries):
        u.keybd_event(0x12, 0, 0, 0)   # ALT down
        u.keybd_event(0x12, 0, 2, 0)   # ALT up
        time.sleep(0.15)
        u.ShowWindow(h, 9)             # SW_RESTORE
        time.sleep(0.15)
        u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002)  # HWND_TOPMOST, NOSIZE|NOMOVE
        u.SetWindowPos(h, -2, 0, 0, 0, 0, 0x0001 | 0x0002)  # HWND_NOTOPMOST
        u.SetForegroundWindow(h)
        time.sleep(0.35)
        if u.GetForegroundWindow() == h:
            return True, i + 1
    return False, tries


if __name__ == '__main__':
    from win_gui import find_window
    h = find_window(title=sys.argv[1] if len(sys.argv) > 1 else '云开发控制台')
    ok, n = force_focus(h)
    print('hwnd=%s focus=%s tries=%d' % (h, ok, n))
