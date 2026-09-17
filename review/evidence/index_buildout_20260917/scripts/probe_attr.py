# -*- coding: utf-8 -*-
"""一次性探针：subscription_plan 的 idx_plan_enabled 行，「索引属性」列在哪个 crop/scale 下能读出 sort。

背景：verify_fields.py 用 (850, ay-45, 1010, ay+45) scale=3 读该行，得到 `so戊`（sort 被读歪）。
      `so戊` → nz() = "so"（戊 非 ASCII 被剔除），与 "sort" 相似度 0.67 < 0.86 ⇒ 判红。
      放大截图已证明真值是 `sort 升序`。本探针穷举读取参数，找出稳定读法。
"""
import sys, re, time, json, subprocess
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
from collections import Counter

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
TMP = r'C:/Users/lzj/AppData/Local/Temp'
LINE_RE = re.compile(r"\[\s*([\d.]+),\s*([\d.]+)\]\s*'(.*)'")

H = find_window(title='云开发控制台')
focus(H)
SEARCH, FIRST, TAB = (470, 280), (400, 333), (1232, 228)


def shot(tag):
    png = '%s/pa_%s.png' % (TMP, tag)
    r = subprocess.run([PY, OCR, 'shot', '--window', '云开发控制台', '--out', png],
                       capture_output=True, text=True, timeout=90)
    return png, [(float(m.group(1)), float(m.group(2)), m.group(3))
                 for m in LINE_RE.finditer(r.stdout or '')]


def ocr(png, crop, scale):
    r = subprocess.run([PY, OCR, 'list', png, '--crop'] + [str(v) for v in crop] + ['--scale', str(scale)],
                       capture_output=True, text=True, timeout=90)
    return [(float(m.group(1)), float(m.group(2)), m.group(3))
            for m in LINE_RE.finditer(r.stdout or '')]


def close_dialog():
    for _ in range(3):
        png, L = shot('cd')
        if not any('添加索引' in t and y < 250 for _, y, t in L):
            return
        key(VK['ESCAPE']); time.sleep(0.8)


def paste(s):
    key(VK['A'], ctrl=True); time.sleep(0.12)
    key(VK['DELETE']); time.sleep(0.12)
    set_clipboard(s); time.sleep(0.28)
    key(VK['V'], ctrl=True); time.sleep(0.4)


def goto(coll):
    click(*SEARCH); time.sleep(0.45)
    paste(coll); time.sleep(1.4)
    click(*FIRST); time.sleep(1.8)
    click(*TAB); time.sleep(1.1)
    _, L = shot('nav')
    if not any('索引占用空间' in t or '索引名称' in t for _, _, t in L):
        click(*TAB); time.sleep(1.3)


close_dialog()
goto('subscription_plan')
close_dialog()
png, _ = shot('plan')
size = ocr(png, (1240, 385, 1430, 1015), 3)
anchors = sorted(int(y) for _, y, t in size if 'KB' in t.upper())
print('行锚点:', anchors, flush=True)
names = ocr(png, (560, 385, 830, 1015), 3)
print('名称列原样:', [(int(y), t) for _, y, t in names], flush=True)

# 找 idx_plan_enabled 所在行
target = None
for ay in anchors:
    cells = ocr(png, (560, ay - 45, 1010, ay + 45), 3)
    nm = '  '.join(t for x, y, t in cells if x < 830)
    if 'plan' in nm or 'enabled' in nm:
        target = ay
        print('目标行 ay=%d 名称读作 %r' % (ay, nm), flush=True)
if target is None:
    print('!! 未定位到 idx_plan_enabled 行'); sys.exit(2)

print('\n--- 属性列穷举 (crop 顺序 L,T,R,B) ---', flush=True)
trials = [
    (850, target - 45, 1010, target + 45, 3),
    (850, target - 45, 1010, target + 45, 4),
    (850, target - 40, 1010, target + 40, 5),
    (850, target - 35, 1010, target + 35, 6),
    (860, target - 30, 1005, target + 30, 8),
    (830, target - 50, 1015, target + 50, 4),
    (850, 385, 1010, 1015, 4),
    (850, 385, 1010, 1015, 6),
]
for (x0, y0, x1, y1, sc) in trials:
    r = ocr(png, (x0, y0, x1, y1), sc)
    print('crop=(%d,%d,%d,%d) scale=%d -> %s' % (x0, y0, x1, y1, sc, [t for _, _, t in r]), flush=True)

# 字段列同样打一遍（对照）
print('\n--- 字段列对照 ---', flush=True)
for (x0, y0, x1, y1, sc) in [(1010, 385, 1245, 1015, 3), (1010, target - 25, 1245, target + 95, 3),
                             (1010, target - 25, 1245, target + 95, 5)]:
    r = ocr(png, (x0, y0, x1, y1), sc)
    print('crop=(%d,%d,%d,%d) scale=%d -> %s' % (x0, y0, x1, y1, sc,
          [(int(y), t) for _, y, t in r if y0 <= y <= y1]), flush=True)
print('\nDONE', flush=True)
