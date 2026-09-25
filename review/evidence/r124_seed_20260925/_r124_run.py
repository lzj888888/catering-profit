# -*- coding: utf-8 -*-
"""round124 步骤2：点击「运行测试」执行 initDb 的补种入参，并留存结果截图。

坐标来源：绿色像素簇实测（png x 1638-1709 / y 579-605）⇒ 中心 (1673,592) ⇒ 屏幕 (1733,592)
"""
import sys, time, ctypes
from ctypes import wintypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
import win_gui as G

u = ctypes.windll.user32
T = r'C:\Users\lzj\AppData\Local\Temp'


def find_cb():
    hit = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def eb(h, l):
        b = ctypes.create_unicode_buffer(512)
        u.GetWindowTextW(h, b, 512)
        if '云开发' in b.value:
            hit.append(h)
        return True

    u.EnumWindows(eb, 0)
    return hit


hs = find_cb()
print('控制台 hwnd =', hs)
if not hs:
    raise SystemExit(2)
h = hs[0]
G.focus(h)
time.sleep(0.7)

print('点击「运行测试」(1733, 592) —— 这是真正的云端调用')
G.click(1733, 592)
for i in range(4):
    time.sleep(4)
    G.screenshot_window(h, T + r'\r124_cb_result_%d.png' % i)
    print('  %ds 已截图 r124_cb_result_%d.png' % ((i + 1) * 4, i))
