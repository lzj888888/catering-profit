# -*- coding: utf-8 -*-
"""DPI / 光标坐标可用性验证：GetSystemMetrics + SetCursorPos→GetCursorPos 回读。"""
import ctypes, time
from ctypes import wintypes
import win32api

u = ctypes.windll.user32
print('BEFORE dpi call: metrics =', u.GetSystemMetrics(0), u.GetSystemMetrics(1))

r = None
try:
    r = ctypes.windll.shcore.SetProcessDpiAwareness(2)
    print('SetProcessDpiAwareness(2) hr =', r)
except Exception as e:
    print('shcore err', e)
    try:
        print('fallback SetProcessDPIAware =', u.SetProcessDPIAware())
    except Exception as e2:
        print('fallback err', e2)

time.sleep(0.2)
print('AFTER  dpi call: metrics =', u.GetSystemMetrics(0), u.GetSystemMetrics(1))

for pt in [(500, 1018), (1079, 985), (1390, 1018)]:
    win32api.SetCursorPos(pt)
    time.sleep(0.25)
    got = win32api.GetCursorPos()
    print('set %-14s -> get %-14s  %s' % (pt, got, 'OK' if tuple(got) == pt else '*** CLAMPED ***'))
