# -*- coding: utf-8 -*-
"""C3 · 用正确参数格式（--names 空格分隔）在用户态 cmd 里做一次只读回读。"""
import sys, time, os, re, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'
N1 = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r181b_gate\N1_timeout_readback_cmd.txt'
OUTFILE = OUT.replace('/', '\\') + r'\c3_timeout_final.txt'

names = None
for ln in open(N1, encoding='utf-8'):
    m = re.search(r'--names\s+(\S+)', ln)
    if m:
        names = m.group(1).split(',')
        break
assert names and len(names) == 42, 'expect 42 names, got %s' % (len(names) if names else None)
print('names =', len(names), flush=True)

CLI = r'"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions info'
full = r'%s --project "C:\Users\lzj\WorkBuddy\Claw\catering-profit" -e cloud1-d4gphpoxy337f2a25 --names %s > "%s" 2>&1' % (
    CLI, ' '.join(names), OUTFILE)
print('payload len =', len(full), flush=True)

if os.path.exists(OUTFILE):
    os.rename(OUTFILE, OUTFILE + '.prev')

u = ctypes.windll.user32
u.keybd_event(0x5B, 0, 0, 0)
u.keybd_event(0x52, 0, 0, 0)
u.keybd_event(0x52, 0, 2, 0)
u.keybd_event(0x5B, 0, 2, 0)
time.sleep(1.4)
set_clipboard('cmd')
key(VK['V'], ctrl=True)
time.sleep(0.5)
key(VK['ENTER'])
time.sleep(3.0)

print('[2] paste & run', flush=True)
set_clipboard(full)
assert get_clipboard() == full
key(VK['V'], ctrl=True)
time.sleep(1.5)
key(VK['ENTER'])

for i in range(30):
    time.sleep(3)
    if os.path.exists(OUTFILE) and os.path.getsize(OUTFILE) > 300:
        time.sleep(4)
        break

screenshot_screen(OUT + '/c6_timeout_result.png')
print('=== c3_timeout_final.txt ===', flush=True)
if os.path.exists(OUTFILE):
    print(open(OUTFILE, encoding='utf-8', errors='replace').read()[:8000], flush=True)
else:
    print('NO OUTPUT', flush=True)
