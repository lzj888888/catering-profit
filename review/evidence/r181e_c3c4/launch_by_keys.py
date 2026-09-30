# -*- coding: utf-8 -*-
"""用键鼠走「用户态启动」拉起微信开发者工具（Win+R 运 行框，进程由 explorer 创建 ⇒ 不受沙箱约束）。"""
import sys, time, ctypes, subprocess

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'
u = ctypes.windll.user32
EXE = r'"C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe"'

print('[1] send Win+R', flush=True)
u.keybd_event(0x5B, 0, 0, 0)   # LWIN down
u.keybd_event(0x52, 0, 0, 0)   # R down
u.keybd_event(0x52, 0, 2, 0)   # R up
u.keybd_event(0x5B, 0, 2, 0)   # LWIN up
time.sleep(1.5)
screenshot_screen(OUT + '/s1_runbox_open.png')

print('[2] paste path', flush=True)
set_clipboard(EXE)
assert get_clipboard() == EXE, 'clipboard mismatch'
key(VK['V'], ctrl=True)
time.sleep(0.8)
screenshot_screen(OUT + '/s2_runbox_filled.png')

print('[3] press ENTER', flush=True)
key(VK['ENTER'])

print('[4] poll for Devtools window ...', flush=True)
found = None
for i in range(30):
    time.sleep(5)
    ws = find_windows(title='Devtools')
    if ws:
        found = ws
        print('[%3ds] Devtools = %s' % ((i + 1) * 5, [(w, rect(w)) for w in ws]), flush=True)
        break
    if i % 3 == 2:
        print('[%3ds] not yet' % ((i + 1) * 5), flush=True)
else:
    print('NO_WINDOW_AFTER_150S', flush=True)

time.sleep(2)
screenshot_screen(OUT + '/s3_after_launch.png')
for name in ('wechatdevtools.exe', '微信开发者工具.exe'):
    r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ' + name],
                       capture_output=True, text=True, errors='replace')
    print('--- tasklist %s ---' % name, flush=True)
    print(r.stdout.strip()[:800], flush=True)
print('RESULT=', 'WINDOW_OK' if found else 'WINDOW_MISSING', flush=True)
