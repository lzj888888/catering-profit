import ctypes, time, os, re, subprocess
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
import win32gui, win32con, win32api
from PIL import ImageGrab, Image

OUT = r'C:/Users/lzj/AppData/Local/Temp/inscode'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'


def find_ins():
    res = []
    def cb(h, _):
        if win32gui.IsWindowVisible(h):
            if win32gui.GetWindowText(h) == 'InsCode':
                res.append(h)
        return True
    win32gui.EnumWindows(cb, None)
    return res[0] if res else None


hwnd = find_ins()
try:
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE); time.sleep(0.4)
    win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE); time.sleep(0.8)
except Exception as e:
    print('show err', e)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(hwnd)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e)
time.sleep(1.0)
print('rect:', win32gui.GetWindowRect(hwnd))

im = ImageGrab.grab()
im.save(os.path.join(OUT, 'FI_full.png'))
W, H = im.size
print('screen', W, H)

# 底部输入框区域
c = im.crop((int(W * 0.30), int(H * 0.86), int(W * 0.92), H))
c.save(os.path.join(OUT, 'FI_bottom.png'))
c2 = c.resize((c.width * 2, c.height * 2), Image.LANCZOS)
c2.save(os.path.join(OUT, 'FI_bottom2x.png'))
print('bottom crop size', c.size)

r = subprocess.run([PY, OCR, 'list', os.path.join(OUT, 'FI_bottom2x.png'), '--scale', '1'],
                   capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=200)
print('=== OCR bottom (2x 图内坐标，除以2加偏移即屏幕) ===')
print(r.stdout[:1500])
