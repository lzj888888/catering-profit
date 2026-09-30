# -*- coding: utf-8 -*-
"""投喂前状态探针：找 InsCode → 还原/移窗/钉顶 → 截图 → 报告输入框占位符是否存在（页面归属）。"""
import ctypes, sys, time, subprocess
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageGrab

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181j_m319_m321_feed'
h = ui.find_inscode()
print('hwnd =', h, flush=True)
if not h:
    print('NO-WINDOW'); sys.exit(3)
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(0.9)
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040); time.sleep(0.5)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('front err', e, flush=True)
time.sleep(1.5)
print('LTRB =', win32gui.GetWindowRect(h), flush=True)
print('IsIconic =', win32gui.IsIconic(h), flush=True)
p = OUT + '/p0_state.png'
ImageGrab.grab().save(p)
print('saved', p, flush=True)
# 页面归属：OCR 找占位符
r = subprocess.run(['C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe',
                    r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py',
                    'find', p, '描述你的任务'], capture_output=True, text=True, encoding='utf-8', errors='replace')
print('OCR-find 描述你的任务 ->', (r.stdout or '').strip()[:300], '| rc', r.returncode, flush=True)
print('----', flush=True)
print((r.stderr or '')[:300], flush=True)
