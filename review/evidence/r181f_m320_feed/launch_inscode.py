# -*- coding: utf-8 -*-
"""用键鼠走「用户态启动」拉起 InsCode（Win+R 运行框，进程由 explorer 创建 ⇒ 不受沙箱约束）。"""
import sys, time, ctypes, subprocess
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

u = ctypes.windll.user32
EXE = r'C:\Users\lzj\AppData\Local\InsCode\InsCode.exe'

print('[1] send Win+R', flush=True)
u.keybd_event(0x5B, 0, 0, 0)
u.keybd_event(0x52, 0, 0, 0)
u.keybd_event(0x52, 0, 2, 0)
u.keybd_event(0x5B, 0, 2, 0)
time.sleep(1.5)

print('[2] paste path', flush=True)
set_clipboard(EXE)
assert get_clipboard() == EXE, 'clipboard mismatch'
key(VK['V'], ctrl=True)
time.sleep(0.8)

print('[3] press ENTER', flush=True)
key(VK['ENTER'])

print('[4] poll for InsCode window ...', flush=True)
found = None
for i in range(24):
    time.sleep(5)
    ws = find_windows(title='InsCode')
    if ws:
        found = ws
        print('[%3ds] InsCode = %s' % ((i + 1) * 5, [(w, rect(w)) for w in ws]), flush=True)
        break
    if i % 3 == 2:
        print('[%3ds] not yet' % ((i + 1) * 5), flush=True)
else:
    print('NO_WINDOW_AFTER_120S', flush=True)

r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq InsCode.exe'],
                   capture_output=True, text=True, errors='replace')
print('--- tasklist ---', flush=True)
print(r.stdout.strip()[:800], flush=True)
print('RESULT=', 'WINDOW_OK' if found else 'WINDOW_MISSING', flush=True)
