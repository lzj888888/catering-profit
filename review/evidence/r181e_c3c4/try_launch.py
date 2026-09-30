# -*- coding: utf-8 -*-
"""尝试以 explorer 转交姿势拉起微信开发者工具，并轮询窗口是否出现。"""
import subprocess, time, sys
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
import ctypes

exe = r'C:/Program Files (x86)\Tencent\微信web开发者工具\wechatdevtools.exe'
proj = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
print('launch via explorer ...', flush=True)
subprocess.Popen([r'C:/Windows/explorer.exe', exe, proj])
for i in range(20):
    time.sleep(6)
    ws = find_windows(title='Devtools')
    print('[%3ds] Devtools windows = %s' % ((i+1)*6, [(w, rect(w)) for w in ws]), flush=True)
    if ws:
        print('WINDOW_APPEARED', flush=True)
        break
else:
    print('NO_WINDOW_AFTER_120S', flush=True)

# 进程探测
r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq wechatdevtools.exe'],
                   capture_output=True, text=True, errors='replace')
print('--- tasklist ---', flush=True)
print(r.stdout[:1500], flush=True)
