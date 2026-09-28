"""R165 投喂：点输入框 → 粘贴 → 实测蓝色圆钮 → 点击发送 → OCR 硬判据验证
用法: feed.py <payload.txt> <tag> <特征词>"""
import sys, os, time, ctypes, subprocess
from collections import deque
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
from PIL import Image

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
IB_X, IB_Y = 700, 855          # 输入框（本机实测：OCR '空格' 行 y=854）

def ocr_crop(png, box, name):
    t = os.path.join(OUT, '_r165_%s_%s.png' % (name, tag))
    Image.open(png).crop(box).save(t)
    r = subprocess.run([PY, OCR, 'read', t], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return (r.stdout or '').strip()

def find_send_button(png):
    im = Image.open(png).convert('RGB'); px = im.load()
    W, H = im.size
    x0, x1, y0, y1 = 500, min(1900, W), 560, min(1015, H)
    mask = [[False] * (x1 - x0) for _ in range(y1 - y0)]
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if b > 170 and b - r > 60 and g > 80:
                mask[y - y0][x - x0] = True
    seen = [[False] * (x1 - x0) for _ in range(y1 - y0)]
    best = None
    for j in range(y1 - y0):
        for i in range(x1 - x0):
            if mask[j][i] and not seen[j][i]:
                q = deque([(i, j)]); seen[j][i] = True; pts = []
                while q:
                    ci, cj = q.popleft(); pts.append((ci, cj))
                    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ni, nj = ci + di, cj + dj
                        if 0 <= ni < x1 - x0 and 0 <= nj < y1 - y0 and mask[nj][ni] and not seen[nj][ni]:
                            seen[nj][ni] = True; q.append((ni, nj))
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                w = max(xs) - min(xs) + 1; hh = max(ys) - min(ys) + 1
                fill = len(pts) / float(w * hh)
                if 700 <= len(pts) <= 5000 and abs(w - hh) <= 12 and fill > 0.55:
                    if best is None or len(pts) > best[0]:
                        best = (len(pts), sum(xs) / len(xs) + x0, sum(ys) / len(ys) + y0, w, hh, round(fill, 2))
    return best

payload, tag, hint = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(payload, encoding='utf-8').read()

h = find_window(title='豆包')
for a in range(5):
    focus(h); time.sleep(1.0)
    if ctypes.windll.user32.GetForegroundWindow() == h:
        print('[0] 置前成功（第%d次）' % (a + 1)); break
else:
    print('❌ 置前失败'); sys.exit(1)

click(IB_X, IB_Y); time.sleep(0.8)
key(VK['A'], ctrl=True); time.sleep(0.3)
key(0x2E); time.sleep(0.6)
set_clipboard(text)
assert get_clipboard() == text, '剪贴板自检失败'
key(VK['V'], ctrl=True); time.sleep(2.0)
print('[1] 已粘贴 %d 字符' % len(text))

full = os.path.join(OUT, '_r165_%s_full.png' % tag)
screenshot_screen(full)
print('[2] 输入框尾部:', repr(ocr_crop(full, (500, 800, 1800, 900), 'inbox')[-80:]))

btn = find_send_button(full)
print('[3] 蓝钮实测:', btn)
if not btn:
    print('❌ 未找到发送按钮'); sys.exit(1)

click(int(round(btn[1])), int(round(btn[2]))); time.sleep(4.0)
full2 = os.path.join(OUT, '_r165_%s_full2.png' % tag)
screenshot_screen(full2)
inbox2 = ocr_crop(full2, (500, 800, 1800, 900), 'inbox2')
conv2 = ocr_crop(full2, (500, 60, 1800, 830), 'conv2')
print('[4] 发送后输入框:', repr(inbox2[:60]))
print('[5] 对话区尾部:', repr(conv2[-200:]))
print('[6] 对话区出现「%s」? %s' % (hint, hint in conv2))
