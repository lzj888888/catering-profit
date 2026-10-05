# -*- coding: utf-8 -*-
"""R224 整窗 Ctrl+A 抓全文（R223 实测法：15186 字一次到手）"""
import sys, os, time, ctypes
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32

wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0,0,0,0, 0x0001|0x0002|0x0010)
h = [x for x in find_windows(title='豆包') if rect(x)[2]-rect(x)[0] > 1000][0]
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0,0,0,0, 0x0001|0x0002|0x0040)
focus(h, settle=0.8); time.sleep(0.8)

set_clipboard('<<EMPTY_MARK_R4>>')
# 点对话区的**文字**处（避开图片）：试几个点，取第一个有产出的
for xy in [(900, 300), (900, 500), (700, 700)]:
    click(*xy); time.sleep(1.0)
    key(VK['A'], ctrl=True); time.sleep(0.8)
    key(VK['C'], ctrl=True); time.sleep(1.5)
    t = get_clipboard() or ''
    print('click', xy, '-> len', len(t))
    if t != '<<EMPTY_MARK_R4>>' and len(t) > 800:
        open(os.path.join(OUT, 'conv_r4.txt'), 'w', encoding='utf-8').write(t)
        print('SAVED len =', len(t))
        print('--- HEAD 500 ---'); print(t[:500])
        print('--- TAIL 800 ---'); print(t[-800:])
        break
else:
    print('NO_TEXT_CAPTURED')
