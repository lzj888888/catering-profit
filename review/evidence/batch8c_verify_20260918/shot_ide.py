"""截微信开发者工具整窗（自动找句柄、必要时恢复），用于 8c 视觉取证。
用法: python shot_ide.py <out.png> [--crop left,top,right,bottom]"""
import sys, ctypes, ctypes.wintypes as wt, time
sys.path.insert(0, r'C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts')
from win_gui import focus, screenshot_window, enum_windows

u = ctypes.windll.user32
out = sys.argv[1]
crop = None
if '--crop' in sys.argv:
    crop = [int(x) for x in sys.argv[sys.argv.index('--crop') + 1].split(',')]

h = None
for hwnd, cls, title, w, hh in enum_windows():
    if 'Devtools' in (title or ''):
        h = hwnd
        break
if not h:
    print('FAIL: 未找到开发者工具窗口')
    sys.exit(1)
if u.IsIconic(h):
    u.ShowWindow(h, 9)
    time.sleep(1.0)
focus(h, settle=1.0)
screenshot_window(h, out)
print('OK', out, 'hwnd', h)

if crop:
    from PIL import Image
    im = Image.open(out).convert('RGB')
    w, hh = im.size
    box = (max(0, crop[0]), max(0, crop[1]), min(w, crop[2]), min(hh, crop[3]))
    im.crop(box).save(out)
    print('cropped ->', box, im.crop(box).size)
