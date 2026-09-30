# -*- coding: utf-8 -*-
"""继续建 external_sales_daily 的两条非唯一索引。"""
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
    return ((min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2) if xs else None


def make_index(name, fields, tag):
    click(729, 304); time.sleep(3.0)                    # + 添加索引
    click(900, 236); time.sleep(0.9)
    set_clipboard(name); key(VK['V'], ctrl=True); time.sleep(1.2)
    click(870, 292); time.sleep(1.0)                    # 非唯一
    click(890, 351); time.sleep(0.9)
    set_clipboard(fields[0]); key(VK['V'], ctrl=True); time.sleep(1.2)
    for i, f in enumerate(fields[1:], start=1):
        click(1228, 351); time.sleep(2.2)               # 加行
        click(895, 351 + 66 * i); time.sleep(1.0)
        set_clipboard(f); key(VK['V'], ctrl=True); time.sleep(1.2)
    tmp = '%s/c_%s_before.png' % (OUT, tag)
    screenshot_screen(tmp)
    btn = find_green_btn(tmp)
    print('[%s] OK_BTN = %s' % (tag, btn), flush=True)
    if btn:
        click(btn[0], btn[1]); time.sleep(6)
        screenshot_screen('%s/c_%s_after.png' % (OUT, tag))
        print('[%s] submitted' % tag, flush=True)


make_index('idx_esd_shop_date', ['shop_id', 'biz_date'], 'esd2')
make_index('idx_esd_dish_key', ['shop_id', 'dish_key'], 'esd3')

screenshot_screen(OUT + '/c45_esd_final.png')
print('done', flush=True)
