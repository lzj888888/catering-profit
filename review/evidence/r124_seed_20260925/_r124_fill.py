# -*- coding: utf-8 -*-
"""round124 步骤1：在云开发控制台「测试普通云函数 > initDb」的编辑器里填入补种入参。

坐标来源（全部实测，非估算）：
  - 控制台窗口 rect = (60, 0, 1860, 1034)（win_gui，DPI-aware ⇒ 物理坐标）
  - 截图为窗口 1:1 ⇒ 屏幕坐标 = png 坐标 + (60, 0)
  - 「运行测试」按钮：绿色像素簇 png x 1638-1709 / y 579-605 ⇒ 中心 (1673,592) ⇒ 屏幕 (1733,592)
  - 编辑器点击点：取编辑器区中央（屏幕 1200,400）
"""
import sys, time, ctypes
from ctypes import wintypes

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import win_gui as G
import inscode_ui as I

u = ctypes.windll.user32
T = r'C:\Users\lzj\AppData\Local\Temp'
PAYLOAD = '{"only":"seed_missing"}'


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
time.sleep(0.8)

print('① 点编辑器 (1200, 400)')
G.click(1200, 400)
time.sleep(0.9)

print('② Ctrl+A 全选 → Delete 清空')
I.chord(0x11, 0x41)
time.sleep(0.3)
I.send_vk(0x2E)
time.sleep(0.35)

print('③ 粘贴 payload: %s' % PAYLOAD)
I.set_clipboard(PAYLOAD)
time.sleep(0.4)
I.chord(0x11, 0x56)
time.sleep(1.6)

G.screenshot_window(h, T + r'\r124_cb_filled.png')
print('已截图 r124_cb_filled.png')
