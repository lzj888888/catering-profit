# -*- coding: utf-8 -*-
"""在「用户态 cmd」里跑 N1 那条只读 CLI 命令（回到 sandbox 外的用户环境 ⇒ reg.exe 不被拦、IDE 又开着）。"""
import sys, time, os, ctypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'
N1 = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r181b_gate\N1_timeout_readback_cmd.txt'
OUTFILE = OUT.replace('/', '\\') + r'\c3_timeout_cli.txt'

cmd = None
for ln in open(N1, encoding='utf-8'):
    if ln.strip().startswith('"C:\\Program Files'):
        cmd = ln.strip()
        break
assert cmd, 'command line not found in N1 file'
full = cmd + ' > "' + OUTFILE + '" 2>&1'
print('[payload len] =', len(full), flush=True)

if os.path.exists(OUTFILE):
    os.rename(OUTFILE, OUTFILE + '.bak')
    print('old output archived', flush=True)

u = ctypes.windll.user32


def press_win_r():
    u.keybd_event(0x5B, 0, 0, 0)
    u.keybd_event(0x52, 0, 0, 0)
    u.keybd_event(0x52, 0, 2, 0)
    u.keybd_event(0x5B, 0, 2, 0)


print('[1] Win+R -> cmd', flush=True)
press_win_r()
time.sleep(1.4)
set_clipboard('cmd')
assert get_clipboard() == 'cmd'
key(VK['V'], ctrl=True)
time.sleep(0.6)
key(VK['ENTER'])
time.sleep(3.0)
screenshot_screen(OUT + '/c2_cmd_open.png')

print('[2] paste CLI command', flush=True)
set_clipboard(full)
assert get_clipboard() == full, 'clipboard mismatch'
key(VK['V'], ctrl=True)
time.sleep(1.5)
screenshot_screen(OUT + '/c3_cmd_pasted.png')
key(VK['ENTER'])
print('[3] running ... poll output file', flush=True)

for i in range(40):
    time.sleep(3)
    if os.path.exists(OUTFILE):
        sz = os.path.getsize(OUTFILE)
        txt = open(OUTFILE, encoding='utf-8', errors='replace').read()
        print('[%3ds] size=%d' % ((i + 1) * 3, sz), flush=True)
        if sz > 200 and ('timeout' in txt.lower() or 'adminExport' in txt):
            time.sleep(3)
            break
else:
    print('TIMEOUT waiting output', flush=True)

screenshot_screen(OUT + '/c4_cmd_result.png')
print('=== OUTPUT FILE ===', flush=True)
if os.path.exists(OUTFILE):
    print(open(OUTFILE, encoding='utf-8', errors='replace').read()[:6000], flush=True)
else:
    print('NO OUTPUT FILE', flush=True)
