# -*- coding: utf-8 -*-
"""R224 通用发送器：argv[1] = payload 文件名（在 _r224_doubao 下）
流程：置前 -> 点输入框两次 -> 清空 -> 粘贴 -> 校验输入框尾部 -> 找蓝钮 -> 发送 -> 校验占位符回来
"""
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32
TAG = sys.argv[2] if len(sys.argv) > 2 else 'x'


def lower(tag):
    f = os.path.join(OUT, 'sd_%s_%s.png' % (TAG, tag))
    screenshot_screen(f)
    c = os.path.join(OUT, 'sd_%s_%s_low.png' % (TAG, tag))
    Image.open(f).crop((500, 500, 1600, 1010)).save(c)
    r = subprocess.run([PY, OCR, 'read', c], capture_output=True, text=True, encoding='utf-8', errors='replace')
    return (r.stdout or '').strip(), f


payload = open(os.path.join(OUT, sys.argv[1]), encoding='utf-8').read()
print('payload 字符数 =', len(payload))

wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
h = [x for x in find_windows(title='豆包') if rect(x)[2] - rect(x)[0] > 1000][0]
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
focus(h, settle=0.8); time.sleep(0.8)
print('[0] fg_ok =', u.GetForegroundWindow() == h, 'rect =', rect(h))

click(700, 855); time.sleep(0.9)
click(700, 855); time.sleep(0.9)
key(VK['A'], ctrl=True); time.sleep(0.4)
key(0x2E); time.sleep(0.6)

set_clipboard(payload)
if get_clipboard() != payload:
    print('❌ 剪贴板自检失败'); sys.exit(1)
key(VK['V'], ctrl=True); time.sleep(2.5)

t, f = lower('pasted')
print('[1] 粘贴后输入框尾 120:', repr(t[-120:]))
tail = payload.strip()[-26:]
ok = tail.replace('\n', '')[:14] in t.replace('\n', '')
print('[1] 尾部特征命中?', ok, '| 期望含:', repr(tail[:14]))

im = Image.open(f).convert('RGB'); px = im.load()
x0, x1, y0, y1 = 1200, 1560, 700, 1010
pts = [(x, y) for y in range(y0, y1) for x in range(x0, x1)
       if (lambda c: c[2] > 170 and c[2] - c[0] > 60 and c[1] > 80)(px[x, y])]
print('[2] 蓝色像素 =', len(pts))
if len(pts) < 700:
    print('❌ 未找到蓝色发送钮'); sys.exit(1)
xs = sorted(p[0] for p in pts); ys = sorted(p[1] for p in pts)
cx, cy = xs[len(xs) // 2], ys[len(ys) // 2]
print('[2] 蓝钮中心 =', (cx, cy))
click(cx, cy); time.sleep(6.0)

t2, _ = lower('sent')
open(os.path.join(OUT, 'sent_%s.txt' % TAG), 'w', encoding='utf-8').write(t2)
sent = '消息或按' in t2
conv = any(k in t2 for k in ('展开全部', 'WorkBuddy', '扣点', '回本'))
print('[3] 输入框占位符回来了?', sent, '| 对话区有新内容?', conv)
print('[3] 发送后 OCR 尾 200:', repr(t2[-200:]))
print('==> %s' % ('发送成功' if sent else '发送存疑，请看截图'))
