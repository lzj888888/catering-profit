# -*- coding: utf-8 -*-
"""只读：把 InsCode 窗口归位 + 截图 + 裁出「聊天末尾 + 输入框」供人眼确认。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'

h = ui.find_inscode()
print('hwnd =', h, 'title =', win32gui.GetWindowText(h), flush=True)
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.5)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
# 置顶后再取消（破 TaskListThumbnailWnd 抢前台）
win32gui.SetWindowPos(h, -1, 20, 20, 1620, 1000, 0x0040); time.sleep(0.6)
win32gui.SetWindowPos(h, -2, 20, 20, 1620, 1000, 0x0040); time.sleep(0.3)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.8)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), 'fg =', win32gui.GetForegroundWindow(), flush=True)

p = OUT + '/now_full.png'
ui.screenshot(p)
im = Image.open(p).convert('RGB')
print('shot size =', im.size, flush=True)
# 输入框行（相对窗口底部）
im.crop((L, B - 130, R, B)).resize(((R - L) * 2, 260), Image.LANCZOS).save(OUT + '/now_input.png')
# 聊天区末尾（输入框上方 ~420px）
im.crop((L, max(0, B - 620), R, B - 130)).save(OUT + '/now_tail.png')
print('saved now_input.png / now_tail.png', flush=True)

# 输入框是否为空：占位符文字通常是浅灰；统计深色像素比例做粗判
crop = im.crop((L + 520, B - 70, R - 320, B - 20)).convert('L')
hgram = crop.histogram()
dark = sum(hgram[:90]); tot = sum(hgram)
print('输入框区 深色像素占比 = %.2f%% (%d/%d)' % (100.0 * dark / max(1, tot), dark, tot), flush=True)
