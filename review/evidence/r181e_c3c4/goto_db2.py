# -*- coding: utf-8 -*-
"""临时最小化 WorkBuddy 窗口 → 控制台置前 → 点「数据库」→ 截图取证。
（C4 做完后由 restore_wb.py 恢复窗口）"""
import sys, time, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

u = ctypes.windll.user32
OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'

h = find_window(title='云开发控制台')

# 1) 最小化 WorkBuddy（含其所有顶层窗口），保留句柄以便恢复
wb = []
for w in find_windows(title='WorkBuddy'):
    if rect(w)[2] - rect(w)[0] > 300:      # 排除微小浮层
        wb.append(w)
print('WorkBuddy windows =', wb, [rect(w) for w in wb], flush=True)
for w in wb:
    u.ShowWindow(w, 6)                     # SW_MINIMIZE
time.sleep(1.5)

# 2) 控制台置顶 + 置前
u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
u.SetForegroundWindow(h)
time.sleep(1.0)
fg = u.GetForegroundWindow()
print('FG =', fg, 'target =', h, 'match =', fg == h, flush=True)
screenshot_screen(OUT + '/c12_console_front.png')

# 3) 点左侧「数据库」
click(150, 264)
time.sleep(6)
screenshot_screen(OUT + '/c13_db_page.png')
print('done', flush=True)
