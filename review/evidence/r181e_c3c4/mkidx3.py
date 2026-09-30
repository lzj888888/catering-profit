# -*- coding: utf-8 -*-
"""切到 external_sales_daily，建 idx_esd_uniq（唯一：shop_id, biz_date, external_ref_id）。"""
import sys, time
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
from PIL import Image

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181e_c3c4'


def find_green_btn(png, y0=380, y1=880, x0=1150, x1=1345):
    im = Image.open(png).convert('RGB')
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = im.getpixel((x, y))
            if g > 140 and g - r > 50 and g - b > 30:
                xs.append(x); ys.append(y)
    if not xs:
        return None
    return ((min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2)


# 1) 切到 external_sales_daily
click(470, 269); time.sleep(0.9)
key(VK['A'], ctrl=True); time.sleep(0.4)
set_clipboard('external'); key(VK['V'], ctrl=True); time.sleep(2.5)
click(450, 332); time.sleep(4.0)
click(1239, 239); time.sleep(3.5)
screenshot_screen(OUT + '/c40_esd_idxmgr.png')
print('switched', flush=True)

# 2) 新建索引
click(729, 304); time.sleep(3.0)
click(900, 236); time.sleep(0.9)
set_clipboard('idx_esd_uniq'); key(VK['V'], ctrl=True); time.sleep(1.2)
click(772, 294); time.sleep(1.0)                 # 唯一
click(890, 351); time.sleep(0.9)
set_clipboard('shop_id'); key(VK['V'], ctrl=True); time.sleep(1.2)
click(1228, 351); time.sleep(2.2)                # 加行2
click(895, 417); time.sleep(1.0)
set_clipboard('biz_date'); key(VK['V'], ctrl=True); time.sleep(1.2)
click(1228, 351); time.sleep(2.2)                # 加行3
click(895, 483); time.sleep(1.0)
set_clipboard('external_ref_id'); key(VK['V'], ctrl=True); time.sleep(1.5)

tmp = OUT + '/c41_before_ok.png'
screenshot_screen(tmp)
btn = find_green_btn(tmp)
print('OK_BTN =', btn, flush=True)
if btn:
    click(btn[0], btn[1]); time.sleep(6)
    screenshot_screen(OUT + '/c42_created_idx3.png')
    print('submitted', flush=True)
