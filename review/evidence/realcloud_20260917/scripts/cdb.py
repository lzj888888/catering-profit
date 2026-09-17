# -*- coding: utf-8 -*-
"""云开发控制台 · 键鼠驱动公共层（真云三验用）

坐标约定：png 坐标 = 窗口客户区 1:1；屏幕坐标 = png + 窗口原点 (L,T)。
窗口原点每次现取（别缓存），并打印出来核对。
"""
import os
import sys
import time

SCRIPTS = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts'
sys.path.insert(0, SCRIPTS)
from win_gui import *  # noqa

import ctypes
u32 = ctypes.windll.user32

EV = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\realcloud_20260917'
TITLE = '云开发控制台'


def hwnd():
    h = find_window(title=TITLE)
    if not h:
        raise RuntimeError('云开发控制台窗口不存在')
    return h


def origin():
    h = hwnd()
    L, T, R, B = rect(h)
    return h, L, T, R, B


def shot(name, quiet=False):
    h, L, T, R, B = origin()
    p = os.path.join(EV, name)
    focus(h)
    time.sleep(0.35)
    screenshot_window(h, p)
    if not quiet:
        print('[shot]', name, 'rect=', (L, T, R, B), 'size=', (R - L, B - T))
    return p


def click_png(h, L, T, x, y, note=''):
    sx, sy = L + x, T + y
    click(sx, sy)
    time.sleep(0.55)
    print('[click] png(%s,%s) -> screen(%s,%s) %s' % (x, y, sx, sy, note))
    return sx, sy


def fg():
    return u32.GetForegroundWindow()


def verify_click(x, y, tag, note=''):
    """点前后各截一张，md5 不同 ⇒ 点击确实生效（防"能截图不能点击"）。"""
    import hashlib
    h, L, T, R, B = origin()

    def md5(p):
        return hashlib.md5(open(p, 'rb').read()).hexdigest()

    a = shot('%s_pre.png' % tag)
    m1 = md5(a)
    click_png(h, L, T, x, y, note)
    time.sleep(0.9)
    b = shot('%s_post.png' % tag)
    m2 = md5(b)
    print('[verify_click] %s changed=%s' % (tag, m1 != m2))
    return m1 != m2, b


def type_clipboard(text, tag='clip'):
    set_clipboard(text)
    time.sleep(0.2)
