# -*- coding: utf-8 -*-
"""逐步取证式粘贴：先确认焦点 -> Ctrl+V -> 不行则 Shift+Insert -> 再不行则逐字输入前 20 字校验"""
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32

def snap(tag):
    f = os.path.join(OUT, 'pr_%s.png' % tag)
    screenshot_screen(f)
    c = os.path.join(OUT, 'pr_%s_in.png' % tag)
    Image.open(f).crop((500, 815, 1580, 1005)).save(c)
    r = subprocess.run([PY, OCR, 'read', c], capture_output=True, text=True, encoding='utf-8', errors='replace')
    return (r.stdout or '').strip()

wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0,0,0,0, 0x0001|0x0002|0x0010)
h = [x for x in find_windows(title='豆包') if rect(x)[2]-rect(x)[0] > 1000][0]
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0,0,0,0, 0x0001|0x0002|0x0040)
focus(h, settle=0.8); time.sleep(0.8)

text = open(os.path.join(OUT, 'payload_r224_1.txt'), encoding='utf-8').read()
print('payload 字符数 =', len(text))
set_clipboard(text)
time.sleep(0.6)
print('clipboard 自检 =', get_clipboard() == text, 'len =', len(get_clipboard() or ''))

# 点输入框（两次，R218）
click(700, 855); time.sleep(0.9)
click(700, 855); time.sleep(1.0)
print('A 焦点后输入框 OCR:', repr(snap('a')[:120]))

key(VK['V'], ctrl=True); time.sleep(2.5)
t = snap('b')
print('B Ctrl+V 后输入框 OCR:', repr(t[:150]))
if 'payload' in t or 'WorkBuddy' in t or '仓内' in t or '扣点' in t:
    print('==> Ctrl+V 成功'); sys.exit(0)

key(0x2D, shift=True); time.sleep(2.5)   # VK_INSERT = 0x2D
t = snap('c')
print('C Shift+Insert 后输入框 OCR:', repr(t[:150]))
if 'WorkBuddy' in t or '仓内' in t or '扣点' in t:
    print('==> Shift+Insert 成功'); sys.exit(0)

# 兜底：直接 key 打一小段 ASCII 探针，确认键盘通道是否可用
for ch in 'TEST224':
    key(ord(ch)); time.sleep(0.08)
time.sleep(1.0)
t = snap('d')
print('D 键盘探针后输入框 OCR:', repr(t[:150]))
print('==> 详见截图')
