# -*- coding: utf-8 -*-
"""把 InsCode 窗口恢复到屏内 (20,20,1620,1000) 并置顶。"""
import ctypes, time, sys
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: ctypes.windll.user32.SetProcessDPIAware()
import win32gui, win32con

h = None
def cb(hwnd, _):
    global h
    if win32gui.IsWindowVisible(hwnd):
        t = win32gui.GetWindowText(hwnd)
        if 'InsCode' in t or 'inscode' in t:
            print('found:', hwnd, repr(t))
            h = hwnd
win32gui.EnumWindows(cb, None)
if not h:
    print('NO_WINDOW'); sys.exit(1)
print('before LTRB =', win32gui.GetWindowRect(h))
if win32gui.IsIconic(h):
    print('was minimized -> ShowWindow(SW_RESTORE)')
    win32gui.ShowWindow(h, win32con.SW_RESTORE)
    time.sleep(1.0)
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040)
time.sleep(0.8)
try: win32gui.SetForegroundWindow(h)
except Exception as e: print('setfg err:', e)
time.sleep(0.8)
L,T,R,B = win32gui.GetWindowRect(h)
print('after  LTRB =', (L,T,R,B))
print('OK' if (L,T)==(20,20) else 'STILL_OFF')
