# -*- coding: utf-8 -*-
"""R224 r1 等豆包写完 v2：每轮滚到底再截图 OCR，尾部连续 3 轮不变即完成（最长 22 分钟）"""
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32
LOG = open(os.path.join(OUT, 'wait_r1.log'), 'w', encoding='utf-8')


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s); LOG.write(s + '\n'); LOG.flush()


wb = find_window(title='WorkBuddy')
_c = [x for x in find_windows(title='豆包') if rect(x)[2] - rect(x)[0] > 1000]
h = _c[0]
prev, stable, i = None, 0, 0
end = time.time() + 22 * 60
while time.time() < end and stable < 3:
    i += 1
    if wb:
        u.SetWindowPos(wb, -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
    u.ShowWindow(h, 9); time.sleep(0.3)
    u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
    focus(h, settle=0.6); time.sleep(0.5)
    for _ in range(8):
        scroll(1000, 500, -900); time.sleep(0.35)
    time.sleep(1.5)
    f = os.path.join(OUT, 'v%02d.png' % i)
    screenshot_screen(f)
    v = os.path.join(OUT, 'v%02d_view.png' % i)
    Image.open(f).crop((500, 50, 1560, 850)).save(v)
    r = subprocess.run([PY, OCR, 'read', v], capture_output=True, text=True, encoding='utf-8', errors='replace')
    t = (r.stdout or '').strip()
    open(os.path.join(OUT, 'v%02d.txt' % i), 'w', encoding='utf-8').write(t)
    log('[%02d] %s len=%d tail=%r' % (i, time.strftime('%H:%M:%S'), len(t), t[-90:]))
    stable = stable + 1 if (t == prev and t) else 0
    prev = t
    if stable < 3:
        time.sleep(25)
log('DONE i=%d stable=%d at %s' % (i, stable, time.strftime('%H:%M:%S')))
LOG.close()
