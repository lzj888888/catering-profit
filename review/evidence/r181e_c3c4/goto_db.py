# -*- coding: utf-8 -*-
"""把鼠标移离任务栏 → 控制台临时 TOPMOST → 点标题栏激活 → 点「数据库」。"""
import sys, time, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

u = ctypes.windll.user32
k = ctypes.windll.kernel32


def info(h):
    b = ctypes.create_unicode_buffer(512)
    u.GetWindowTextW(h, b, 512)
    c = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(h, c, 256)
    return '%s|%s' % (c.value, b.value)


h = find_window(title='云开发控制台')

# 1) 鼠标移离任务栏（屏幕中央空白处）
move_to(960, 560)
time.sleep(1.2)
fg = u.GetForegroundWindow()
print('after move, FG = %s %s' % (fg, info(fg)), flush=True)

# 2) 控制台临时置顶（位置尺寸不变）
u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)   # HWND_TOPMOST|NOSIZE|NOMOVE|SHOWWINDOW
time.sleep(0.8)

# 3) 点它的标题栏 → 激活
click(900, 12)
time.sleep(0.8)
fg2 = u.GetForegroundWindow()
print('after title click, FG = %s %s  (target=%s)' % (fg2, info(fg2), h), flush=True)

# 4) 点「数据库」左栏
click(150, 264)
time.sleep(6)
screenshot_screen(r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4/c11_db.png')
print('shot c11_db.png', flush=True)
