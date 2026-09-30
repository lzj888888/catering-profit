# -*- coding: utf-8 -*-
"""判定 composer 是否为空：裁输入框区域算非背景像素 + 发送钮中心色。"""
import ctypes, sys, time
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: ctypes.windll.user32.SetProcessDPIAware()
import win32gui, win32con
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import ImageGrab
import numpy as np

h = ui.find_inscode()
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040)
try: win32gui.SetForegroundWindow(h)
except Exception: pass
time.sleep(1.0)
L,T,R,B = win32gui.GetWindowRect(h)
img = ImageGrab.grab(bbox=(L,T,R,B))
a = np.array(img)
H,W = a.shape[:2]
print("win", W, "x", H, flush=True)
# 输入框大致区域：底部 60~140 px 高、左边 8% ~ 82% 宽
y0, y1 = int(H*0.86), int(H*0.955)
x0, x1 = int(W*0.06), int(W*0.84)
reg = a[y0:y1, x0:x1]
# 背景色取四角众数
bg = np.median(a[y0+2:y0+6, x0+2:x0+6].reshape(-1,3), axis=0)
diff = np.abs(reg.astype(int) - bg.astype(int)).sum(axis=2)
ink = (diff > 40).mean()
print(f"composer 区域 ink 占比 = {ink*100:.2f}%  (bg={bg})", flush=True)
# 发送钮：右下角
bx0, by0 = int(W*0.845), int(H*0.885)
btn = a[by0:by0+40, bx0:bx0+50]
mid = btn.reshape(-1,3).mean(axis=0)
print("send 按钮均值 RGB =", np.round(mid,1), flush=True)
dark = mid.mean() < 90
print("判定：", "有内容/深色钮" if dark else "空(浅色钮)", flush=True)
print("COMPOSER_EMPTY" if ink*100 < 2.0 and not dark else "COMPOSER_HAS_TEXT", flush=True)
