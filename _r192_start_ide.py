# -*- coding: utf-8 -*-
"""R192：用户态启动微信开发者工具（沙箱内起不了 IDE ⇒ 走 Win+R 路由，与 R190 同一条路）。"""
import sys, time, ctypes

sys.path.insert(0, r'C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts')
from win_gui import set_dpi_aware, type_text, wait_window

set_dpi_aware()  # 🔴 必须最先：1920x1080 @150% ⇒ 不设则坐标被 clamp

KEYEVENTF_KEYUP = 2
VK_LWIN, VK_R, VK_RETURN = 0x5B, 0x52, 0x0D


def tap(vk, mods=()):
    for m in mods:
        ctypes.windll.user32.keybd_event(m, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    for m in reversed(mods):
        ctypes.windll.user32.keybd_event(m, 0, KEYEVENTF_KEYUP, 0)


tap(VK_R, (VK_LWIN,))          # Win+R
time.sleep(1.5)
type_text(r'C:\Users\lzj\ide_go.bat', settle=0.8)
time.sleep(0.6)
tap(VK_RETURN)
print('winr dispatched')

hwnd = wait_window(title='微信开发者工具', timeout=90, poll=2.0)
print('ide hwnd =', hwnd)
