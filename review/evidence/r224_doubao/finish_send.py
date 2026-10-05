# -*- coding: utf-8 -*-
"""清掉键盘探针残留 -> 校验输入框尾部 -> 点蓝钮发送 -> 校验已发出"""
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32

def lower_text(tag):
    f = os.path.join(OUT, 'fs_%s.png' % tag)
    screenshot_screen(f)
    c = os.path.join(OUT, 'fs_%s_low.png' % tag)
    Image.open(f).crop((500, 520, 1600, 1010)).save(c)
    r = subprocess.run([PY, OCR, 'read', c], capture_output=True, text=True, encoding='utf-8', errors='replace')
    return (r.stdout or '').strip()

wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0,0,0,0, 0x0001|0x0002|0x0010)
h = [x for x in find_windows(title='豆包') if rect(x)[2]-rect(x)[0] > 1000][0]
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0,0,0,0, 0x0001|0x0002|0x0040)
focus(h, settle=0.8); time.sleep(0.8)
print('fg_ok =', u.GetForegroundWindow() == h)

click(700, 855); time.sleep(0.8)
click(700, 855); time.sleep(0.8)
key(0x23, ctrl=True); time.sleep(0.6)      # Ctrl+End 到文末
key(0x1B); time.sleep(0.4)                 # ESC 取消输入法候选
for _ in range(12):
    key(0x08); time.sleep(0.12)            # BackSpace x12
time.sleep(1.0)
t = lower_text('after')                    # 注意：Ctrl+End 后输入框滚到底，裁剪会看到尾部
open(os.path.join(OUT, 'fs_after.txt'), 'w', encoding='utf-8').write(t)
print('清残留后 尾部 OCR:', repr(t[-260:]))
print('仍含探针残留?', '托尔斯泰' in t or 'TEST' in t)

# 找蓝钮
im = Image.open(os.path.join(OUT, 'fs_after.png')).convert('RGB'); px = im.load()
x0, x1, y0, y1 = 1200, 1560, 700, 1010
cand = []
for y in range(y0, y1):
    for x in range(x0, x1):
        r_, g_, b_ = px[x, y]
        if b_ > 170 and b_ - r_ > 60 and g_ > 80:
            cand.append((x, y))
print('蓝色像素数 =', len(cand))
if cand:
    xs = [p[0] for p in cand]; ys = [p[1] for p in cand]
    # 取最大连通块的近似中心：用中位数稳健
    xs.sort(); ys.sort()
    cx, cy = xs[len(xs)//2], ys[len(ys)//2]
    print('蓝钮中心估计 =', (cx, cy))
    click(cx, cy); time.sleep(6.0)
    t2 = lower_text('sent')
    open(os.path.join(OUT, 'fs_sent.txt'), 'w', encoding='utf-8').write(t2)
    print('发送后 OCR:', repr(t2[:300]))
    print('占位符回来了?', '消息或按' in t2)
