# -*- coding: utf-8 -*-
"""R224 投喂 r1 v2：当前新对话已就绪 -> 点输入框两次 -> 清空 -> 粘贴 -> 蓝钮发送 -> 验证"""
import sys, os, time, ctypes, subprocess
from PIL import Image
from collections import deque
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32


def find_send_button(png):
    im = Image.open(png).convert('RGB'); px = im.load()
    W, H = im.size
    x0, x1 = 1150, min(1580, W)
    y0, y1 = 810, min(1010, H)
    mask = [[False] * (x1 - x0) for _ in range(y1 - y0)]
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if b > 170 and b - r > 60 and g > 80:
                mask[y - y0][x - x0] = True
    seen = [[False] * (x1 - x0) for _ in range(y1 - y0)]
    best = None
    for j in range(y1 - y0):
        for i in range(x1 - x0):
            if mask[j][i] and not seen[j][i]:
                q = deque([(i, j)]); seen[j][i] = True; pts = []
                while q:
                    ci, cj = q.popleft(); pts.append((ci, cj))
                    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ni, nj = ci + di, cj + dj
                        if 0 <= ni < x1 - x0 and 0 <= nj < y1 - y0 and mask[nj][ni] and not seen[nj][ni]:
                            seen[nj][ni] = True; q.append((ni, nj))
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                w = max(xs) - min(xs) + 1; hh = max(ys) - min(ys) + 1
                fill = len(pts) / float(w * hh)
                if 700 <= len(pts) <= 5000 and abs(w - hh) <= 14 and fill > 0.5:
                    if best is None or len(pts) > best[0]:
                        best = (len(pts), sum(xs) / len(xs) + x0, sum(ys) / len(ys) + y0, w, hh, round(fill, 2))
    return best


def ocr_read(png, crop, name):
    t = os.path.join(OUT, '_r223_%s.png' % name)
    Image.open(png).crop(crop).save(t)
    r = subprocess.run([PY, OCR, 'read', t], capture_output=True, text=True, encoding='utf-8', errors='replace')
    return (r.stdout or '').strip()


wb = find_window(title='WorkBuddy')
if wb:
    u.SetWindowPos(wb, -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
_c = [x for x in find_windows(title='豆包') if rect(x)[2] - rect(x)[0] > 1000]
assert _c, '找不到豆包主窗口'
h = _c[0]
u.ShowWindow(h, 9); time.sleep(0.6)
u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
focus(h); time.sleep(1.2)
print('[0] hwnd=%s rect=%s fg_ok=%s' % (h, rect(h), u.GetForegroundWindow() == h))

# 点输入框两次（R218：必须两次才落焦）
click(900, 858); time.sleep(0.9)
click(900, 858); time.sleep(1.0)
key(VK['A'], ctrl=True); time.sleep(0.4)
key(0x2E); time.sleep(0.7)

text = open(os.path.join(OUT, 'payload_r224_1.txt'), encoding='utf-8').read()
set_clipboard(text)
assert get_clipboard() == text, '剪贴板自检失败'
key(VK['V'], ctrl=True); time.sleep(2.5)
print('[1] 已粘贴 %d 字符' % len(text))

f2 = os.path.join(OUT, 's2_pasted.png')
screenshot_screen(f2)
inbox = ocr_read(f2, (500, 700, 1560, 1010), 'inbox')
print('[2] 输入框内容尾部:', repr(inbox[-200:]))
btn = find_send_button(f2)
print('[2] 蓝钮实测:', btn)
if not btn:
    print('    ❌ 未找到发送钮'); sys.exit(1)

click(int(round(btn[1])), int(round(btn[2]))); time.sleep(5.0)
f3 = os.path.join(OUT, 's3_sent.png')
screenshot_screen(f3)
inbox2 = ocr_read(f3, (500, 700, 1560, 1010), 'inbox2')
conv2 = ocr_read(f3, (500, 55, 1545, 800), 'conv2')
print('[3] 发送后输入框:', repr(inbox2[:120]))
print('[3] 发送后对话区尾部:', repr(conv2[-300:]))
print('[4] 对话区出现 payload 特征词?', ('统一式' in conv2) or ('var_items' in conv2) or ('扣点费率' in conv2))
