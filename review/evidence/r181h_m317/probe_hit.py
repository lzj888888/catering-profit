# -*- coding: utf-8 -*-
"""诊断①：目标点位归哪个 HWND/进程；② InsCode 窗口是否还响应/是否冻结。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api, win32process, win32event
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageGrab, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
u32 = ctypes.windll.user32

h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.5)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
L, T, R, B = win32gui.GetWindowRect(h)
print('InsCode hwnd =', h, 'LTRB =', (L, T, R, B), flush=True)


def is_desc(hwnd, root):
    p = hwnd
    for _ in range(12):
        if p == root:
            return True
        p = win32gui.GetParent(p)
        if not p:
            break
    return False


print('=== WindowFromPoint 归属 ===')
for (x, y) in [(700, 930), (790, 950), (1340, 981), (900, 700), (200, 300), (700, 700)]:
    try:
        hw = u32.WindowFromPoint(wintypes.POINT(x, y))
    except Exception as e:
        print((x, y), 'ERR', e); continue
    if not hw:
        print((x, y), 'NO-WINDOW'); continue
    cls = win32gui.GetClassName(hw)
    tit = win32gui.GetWindowText(hw)
    root = win32gui.GetAncestor(hw, win32con.GA_ROOT)
    rootcls = win32gui.GetClassName(root)
    roottit = win32gui.GetWindowText(root)
    try:
        _, pid = win32process.GetWindowThreadProcessId(hw)
    except Exception:
        pid = -1
    print('(%d,%d) hw=%s cls=%r title=%r | root=%s cls=%r title=%r pid=%s | inInsCode=%s' % (
        x, y, hw, cls, tit[:40], root, rootcls, roottit[:40], pid, is_desc(hw, h)), flush=True)

print()
print('=== InsCode 是否响应（SendMessageTimeout WM_NULL, 1500ms）===')
r = u32.SendMessageTimeoutW(h, 0x0000, 0, 0, 0x0002, 1500, ctypes.byref(wintypes.DWORD()))
print('toplevel hwnd WM_NULL ->', r, '(0=超时/无响应)', flush=True)
# 子窗口也试
kids = []
win32gui.EnumChildWindows(h, lambda c, l: kids.append(c) or True, None)
print('child hwnd count =', len(kids), flush=True)
for c in kids[:6]:
    r2 = u32.SendMessageTimeoutW(c, 0x0000, 0, 0, 0x0002, 1200, ctypes.byref(wintypes.DWORD()))
    print('  child %s cls=%r title=%r WM_NULL -> %s' % (
        c, win32gui.GetClassName(c)[:30], win32gui.GetWindowText(c)[:30], r2), flush=True)

print()
print('=== 是否在重绘（3 秒两次全屏 diff，只统计窗口区）===')
p1 = OUT + '/h1.png'; ImageGrab.grab().save(p1); time.sleep(3.0)
p2 = OUT + '/h2.png'; ImageGrab.grab().save(p2)
box = (L, T, R, B)
ia = Image.open(p1).convert('RGB').crop(box); ib = Image.open(p2).convert('RGB').crop(box)
dd = ImageChops.difference(ia, ib).convert('L')
ch = sum(dd.histogram()[10:])
print('窗口区 3s 变化像素 =', ch, 'bbox =', dd.getbbox(), flush=True)

print()
print('=== 全局键盘注入可用性（Ctrl+M 浮层）===')
p3 = OUT + '/h3.png'; ImageGrab.grab().save(p3); time.sleep(0.6)
print('send_vk ok =', ui.chord(0x11, 0x4D), flush=True)   # Ctrl+M
time.sleep(1.6)
p4 = OUT + '/h4.png'; ImageGrab.grab().save(p4)
ia = Image.open(p3).convert('RGB').crop(box); ib = Image.open(p4).convert('RGB').crop(box)
dd = ImageChops.difference(ia, ib).convert('L')
print('Ctrl+M 后窗口区变化 =', sum(dd.histogram()[10:]), 'bbox =', dd.getbbox(), flush=True)
# 关掉浮层
ui.send_vk(0x1B); time.sleep(0.6)
