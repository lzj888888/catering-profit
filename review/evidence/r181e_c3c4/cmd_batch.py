# -*- coding: utf-8 -*-
"""在「用户态 cmd」窗口里执行若干条命令（Win+R 新开 cmd ⇒ 粘贴 ⇒ 回车 ⇒ 读输出文件）。

用法: python cmd_batch.py <payload_file> <tag>
  payload_file 每行一条命令；输出分别落到 <tag>_<i>.txt
"""
import sys, time, os, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'

u = ctypes.windll.user32


def press_win_r():
    u.keybd_event(0x5B, 0, 0, 0)
    u.keybd_event(0x52, 0, 0, 0)
    u.keybd_event(0x52, 0, 2, 0)
    u.keybd_event(0x5B, 0, 2, 0)


CLI = r'"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions info'
PROJ = r'--project "C:\Users\lzj\WorkBuddy\Claw\catering-profit"'
ENV = '-e cloud1-d4gphpoxy337f2a25'

jobs = [
    ('t1_small3', '%s %s %s --names adminExport,adminInit,initDb' % (CLI, PROJ, ENV)),
    ('t2_help', '%s --help' % CLI),
]

ops = []
for tag, base in jobs:
    of = OUT.replace('/', '\\') + '\\%s.txt' % tag
    if os.path.exists(of):
        os.remove(of)
    ops.append((tag, base + ' > "' + of + '" 2>&1'))

print('[1] open user-mode cmd', flush=True)
press_win_r()
time.sleep(1.4)
set_clipboard('cmd')
key(VK['V'], ctrl=True)
time.sleep(0.5)
key(VK['ENTER'])
time.sleep(3.0)

for tag, full in ops:
    of = OUT.replace('/', '\\') + '\\%s.txt' % tag
    print('[2] run', tag, 'payload', len(full), flush=True)
    set_clipboard(full)
    assert get_clipboard() == full
    key(VK['V'], ctrl=True)
    time.sleep(1.2)
    key(VK['ENTER'])
    for i in range(20):
        time.sleep(2)
        if os.path.exists(of) and os.path.getsize(of) > 80:
            time.sleep(2)
            break
    time.sleep(1.0)

screenshot_screen(OUT + '/c5_batch_done.png')
for tag, _ in ops:
    of = OUT.replace('/', '\\') + '\\%s.txt' % tag
    print('=== %s ===' % tag, flush=True)
    if os.path.exists(of):
        print(open(of, encoding='utf-8', errors='replace').read()[:3000], flush=True)
    else:
        print('(no file)', flush=True)
