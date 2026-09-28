"""R165 等输出稳定 + 读回全文
用法: waitread.py <tag> [max_minutes]
判稳定 = 对话区 OCR 文本连续 2 帧相同（间隔 interval 秒）
读全文 = 优先剪贴板（点对话区 → Ctrl+A → Ctrl+C），失败则 OCR 逐页兜底
"""
import sys, os, time, ctypes, subprocess
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
from PIL import Image

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
CROP = (500, 60, 1800, 830)     # 对话区（全屏 PNG 坐标 = 屏幕坐标）

tag = sys.argv[1]
max_min = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0
interval = 30.0

def snap():
    full = os.path.join(OUT, '_r165_%s_w.png' % tag)
    screenshot_screen(full)
    t = os.path.join(OUT, '_r165_%s_wcrop.png' % tag)
    Image.open(full).crop(CROP).save(t)
    r = subprocess.run([PY, OCR, 'read', t], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return (r.stdout or '').strip()

h = find_window(title='豆包')
for a in range(5):
    focus(h); time.sleep(1.0)
    if ctypes.windll.user32.GetForegroundWindow() == h:
        break

prev, stable, frames = '', 0, 0
t0 = time.time()
while stable < 2 and (time.time() - t0) < max_min * 60:
    txt = snap(); frames += 1
    stable = stable + 1 if txt == prev else 0
    prev = txt
    print('[%5.1f min] 帧%d len=%d stable=%d' % ((time.time() - t0) / 60, frames, len(txt), stable), flush=True)
    if stable < 2:
        time.sleep(interval)

print('==== 稳定（%d 帧）====' % frames)

# ---- 读全文：剪贴板优先 ----
got = ''
try:
    click(900, 400); time.sleep(0.8)
    key(VK['A'], ctrl=True); time.sleep(0.6)
    key(VK['C'], ctrl=True); time.sleep(1.2)
    got = get_clipboard() or ''
    print('[剪贴板] %d 字符' % len(got))
except Exception as e:
    print('[剪贴板] 失败', e)

# ---- 兜底：OCR 全对话区 ----
ocr_txt = prev
with open(os.path.join(OUT, '%s_answer_ocr.txt' % tag), 'w', encoding='utf-8') as f:
    f.write(ocr_txt)
print('[OCR 兜底] %d 字符 → %s_answer_ocr.txt' % (len(ocr_txt), tag))

with open(os.path.join(OUT, '%s_answer_clip.txt' % tag), 'w', encoding='utf-8') as f:
    f.write(got)
print('[剪贴板] → %s_answer_clip.txt' % tag)
