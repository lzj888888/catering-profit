# -*- coding: utf-8 -*-
"""生成 C3 用的短路径 bat（GBK 编码，含中文 CLI 路径），用 Win+R 以用户态执行。"""
import sys, time, os, re, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'
N1 = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r181b_gate\N1_timeout_readback_cmd.txt'
OUTFILE = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r181e_c3c4\c3_timeout_final.txt'
BAT = r'C:\Users\lzj\c3.bat'

names = None
for ln in open(N1, encoding='utf-8'):
    m = re.search(r'--names\s+(\S+)', ln)
    if m:
        names = m.group(1).split(',')
        break
assert names and len(names) == 42

lines = [
    '@echo off',
    'chcp 936 >nul',
    '"C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat" cloud functions info'
    ' --project "C:\\Users\\lzj\\WorkBuddy\\Claw\\catering-profit" -e cloud1-d4gphpoxy337f2a25'
    ' --names ' + ' '.join(names) + ' > "' + OUTFILE + '" 2>&1',
    'echo __BAT_DONE__ >> "' + OUTFILE + '"',
]
with open(BAT, 'w', encoding='gbk', errors='replace') as f:
    f.write('\r\n'.join(lines) + '\r\n')
print('bat written, bytes =', os.path.getsize(BAT), flush=True)

if os.path.exists(OUTFILE):
    os.rename(OUTFILE, OUTFILE + '.prev')

u = ctypes.windll.user32
u.keybd_event(0x5B, 0, 0, 0)
u.keybd_event(0x52, 0, 0, 0)
u.keybd_event(0x52, 0, 2, 0)
u.keybd_event(0x5B, 0, 2, 0)
time.sleep(1.4)
set_clipboard(BAT)
assert get_clipboard() == BAT
key(VK['V'], ctrl=True)
time.sleep(0.7)
screenshot_screen(OUT + '/c7_runbox_bat.png')
key(VK['ENTER'])
print('[run] invoked', BAT, flush=True)

for i in range(40):
    time.sleep(3)
    if os.path.exists(OUTFILE):
        t = open(OUTFILE, encoding='utf-8', errors='replace').read()
        if '__BAT_DONE__' in t:
            print('done at %ds' % ((i + 1) * 3), flush=True)
            break
        print('[%3ds] size=%d (running)' % ((i + 1) * 3, os.path.getsize(OUTFILE)), flush=True)
else:
    print('WAIT_TIMEOUT', flush=True)

screenshot_screen(OUT + '/c8_timeout_result.png')
print('=== c3_timeout_final.txt ===', flush=True)
if os.path.exists(OUTFILE):
    print(open(OUTFILE, encoding='utf-8', errors='replace').read()[:9000], flush=True)
else:
    print('NO OUTPUT', flush=True)
