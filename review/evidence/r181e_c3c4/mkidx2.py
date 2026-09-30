# -*- coding: utf-8 -*-
"""建索引通用脚本：idx_dm_card_code（shop_dish_mapping，非唯一，shop_id + card_code）。"""
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
    return ((min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2, len(xs))


click(729, 304); time.sleep(3.0)                       # + 添加索引
click(900, 236); time.sleep(0.9)
set_clipboard('idx_dm_card_code'); key(VK['V'], ctrl=True); time.sleep(1.2)
click(870, 292); time.sleep(1.0)                       # 索引属性：非唯一
click(890, 351); time.sleep(0.9)
set_clipboard('shop_id'); key(VK['V'], ctrl=True); time.sleep(1.2)
click(1228, 351); time.sleep(2.2)                      # 加字段行
click(895, 417); time.sleep(1.0)
set_clipboard('card_code'); key(VK['V'], ctrl=True); time.sleep(1.5)

tmp = OUT + '/c38_before_ok.png'
screenshot_screen(tmp)
btn = find_green_btn(tmp)
print('OK_BTN =', btn, flush=True)
if btn:
    click(btn[0], btn[1])
    time.sleep(6)
    screenshot_screen(OUT + '/c39_created_idx2.png')
    print('submitted', flush=True)
