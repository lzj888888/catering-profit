# -*- coding: utf-8 -*-
"""tools/gen_hub_icons.py —— M3 枢纽页图标生成器（R758）

为什么是 PNG 位图而不是 SVG / iconfont / emoji：
  · 本仓真机踩过两轮图标坑 —— emoji 在部分字体下宽高不一致会塌行（terms.js 头注 R192）、
    内联 SVG / webfont 依赖微信 webview 版本，真机渲染不确定；
  · 位图零依赖，任何基础库版本都按像素渲染，代价只是 8 张 ~2KB 的小图。
  · 线性白描边 + 渐变底（色值在 app.wxss 单源），风格统一、可复现。

运行： python tools/gen_hub_icons.py
产出： images/hub/{material,card,takeaway,groupon,review,revenue,recon,promo}.png
       review/evidence/hub_icons_preview.png（8 图标拼图，供人眼验收）
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'images', 'hub')
PREVIEW = os.path.join(ROOT, 'review', 'evidence', 'hub_icons_preview.png')

S = 4                 # 超采样倍率（抗锯齿：4x 画 → LANCZOS 缩到 96）
SZ = 96 * S
W = 7 * S             # 线宽（缩小后 7px @96，显示 44rpx 约等于 3rpx 描边）
WHITE = (255, 255, 255, 255)

# 图标底色的渐变端点（与 app.wxss 的 .hub-ico-* 一致，仅用于预览拼图）
COLORS = {
    'material': ((0x2f, 0xae, 0x7c), (0x1a, 0x7d, 0x55)),
    'card':     ((0x2a, 0x4e, 0x7c), (0x16, 0x2c, 0x49)),
    'takeaway': ((0xc2, 0x70, 0x1a), (0x8f, 0x4f, 0x08)),
    'groupon':  ((0xb7, 0x7a, 0x2a), (0x7a, 0x4e, 0x12)),
    'review':   ((0xb0, 0x52, 0x8a), (0x7a, 0x34, 0x5f)),
    'revenue':  ((0x1a, 0x7d, 0x55), (0x0f, 0x52, 0x37)),
    'recon':    ((0xa9, 0x9e, 0x8e), (0x56, 0x60, 0x70)),
    'promo':    ((0x56, 0x60, 0x70), (0x33, 0x3b, 0x47)),
}


def line(d, pts, w=W):
    d.line([(x * S, y * S) for x, y in pts], fill=WHITE, width=w, joint='curve')


def ellipse(d, box, w=W, fill=None):
    b = [v * S for v in box]
    if fill:
        d.ellipse(b, fill=WHITE)
    else:
        d.ellipse(b, outline=WHITE, width=w)


def arc(d, box, start, end, w=W):
    d.arc([v * S for v in box], start, end, fill=WHITE, width=w)


def draw_material(d):
    """原料进价表 —— 储物箱 + 标签线"""
    line(d, [(26, 34), (70, 34), (64, 76), (32, 76), (26, 34)])
    line(d, [(22, 34), (74, 34)])
    line(d, [(26, 34), (32, 25), (68, 25), (74, 34)])
    line(d, [(39, 54), (57, 54)], w=W - 2 * S)


def draw_card(d):
    """菜品成本毛利 —— 文档卡 + 折角 + 文字行"""
    line(d, [(26, 17), (58, 17), (72, 31), (72, 79), (26, 79), (26, 17)])
    line(d, [(58, 17), (58, 31), (72, 31)])
    for y in (45, 57, 69):
        line(d, [(37, y), (61, y)], w=W - 2 * S)


def draw_takeaway(d):
    """外卖每单赚多少 —— 提手袋"""
    line(d, [(24, 38), (72, 38), (68, 79), (28, 79), (24, 38)])
    arc(d, (35, 22, 61, 50), 180, 360)
    line(d, [(24, 51), (72, 51)], w=W - 2 * S)


def draw_groupon(d):
    """团购每单赚多少 —— 两人成团"""
    ellipse(d, (27, 27, 49, 49))
    ellipse(d, (49, 30, 69, 50))
    arc(d, (20, 52, 52, 82), 180, 360)
    arc(d, (46, 55, 76, 82), 180, 360)


def draw_review(d):
    """菜品赚多赚少排行榜 —— 递增柱状"""
    line(d, [(18, 79), (78, 79)])
    for x, y in ((30, 60), (48, 45), (66, 29)):
        line(d, [(x, 79), (x, y)])
        line(d, [(x - 6, y), (x + 6, y)], w=W - S)


def draw_revenue(d):
    """渠道营收 —— 一进三出的分流"""
    line(d, [(18, 48), (38, 48)])
    line(d, [(38, 24), (38, 72)])
    for y in (24, 48, 72):
        line(d, [(38, y), (72, y)])
        line(d, [(65, y - 6), (73, y), (65, y + 6)], w=W - S)


def draw_recon(d):
    """账上利润和实际营收对不对 —— 账本 + 对勾"""
    line(d, [(24, 18), (68, 18), (68, 79), (24, 79), (24, 18)])
    line(d, [(35, 18), (35, 79)])
    line(d, [(44, 31), (60, 31)], w=W - 2 * S)
    line(d, [(42, 55), (50, 63), (64, 43)])


def draw_promo(d):
    """做活动划算吗 —— 价格吊牌 + 百分号"""
    line(d, [(30, 19), (66, 19), (78, 48), (66, 77), (30, 77), (18, 48), (30, 19)])
    ellipse(d, (34, 33, 44, 43), w=W - 2 * S)
    ellipse(d, (52, 53, 62, 63), w=W - 2 * S)
    line(d, [(60, 35), (36, 61)], w=W - 2 * S)


DRAW = {
    'material': draw_material,
    'card': draw_card,
    'takeaway': draw_takeaway,
    'groupon': draw_groupon,
    'review': draw_review,
    'revenue': draw_revenue,
    'recon': draw_recon,
    'promo': draw_promo,
}


def gradient(c1, c2, size=96):
    im = Image.new('RGB', (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
    icons = {}
    for name, fn in DRAW.items():
        im = Image.new('RGBA', (SZ, SZ), (0, 0, 0, 0))
        fn(ImageDraw.Draw(im))
        small = im.resize((96, 96), Image.LANCZOS)
        small.save(os.path.join(OUT, name + '.png'))
        icons[name] = small
        print('  generated images/hub/%s.png' % name)

    # 预览拼图：8 个图标贴到各自渐变底上，横跨一行
    gap, pad = 12, 10
    cw = 96 + pad * 2
    prev = Image.new('RGB', (cw * 8 + gap * 7, 96 + 32), (245, 242, 235))
    for i, (name, (c1, c2)) in enumerate(COLORS.items()):
        bg = gradient(c1, c2)
        x = i * (cw + gap) + pad
        prev.paste(bg, (x, 16))
        prev.paste(icons[name], (x, 16), icons[name])
    prev.save(PREVIEW)
    print('  preview -> review/evidence/hub_icons_preview.png')


if __name__ == '__main__':
    main()
