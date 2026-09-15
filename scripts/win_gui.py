#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""win_gui.py — Windows 桌面「键鼠控制 + 真实截屏」通用驱动。

零 GUI 依赖：纯标准库 ctypes 直调 user32/kernel32（不需要 pywin32）。
截屏用 Pillow 的 ImageGrab（唯一外部依赖，仅截屏需要；没有 Pillow 时其余能力照常可用）。

既能当模块用，也能当命令行用：

  模块：  from win_gui import *
          h = find_window(title='Devtools', contains=True)
          focus(h); screenshot_window(h, r'C:\\tmp\\a.png'); key(VK['B'], ctrl=True)

  命令行（推荐，一行搞定，不用每次写脚本）：
    python win_gui.py list                      列出所有可见窗口（句柄/类名/标题/尺寸）
    python win_gui.py find  --title Devtools --contains
    python win_gui.py focus --title "Devtools"
    python win_gui.py shot  --title "Devtools" --out a.png      # 只截该窗口
    python win_gui.py shot  --screen --out a.png                # 全屏
    python win_gui.py shot  --region 0,0,800,600 --out a.png    # 区域
    python win_gui.py click --x 1147 --y 573                    # 左键单击
    python win_gui.py click --x 100 --y 200 --right             # 右键（菜单要点就在同一次调用里…见 rclick 说明）
    python win_gui.py dblclick --x 100 --y 200
    python win_gui.py move  --x 100 --y 200
    python win_gui.py scroll --x 800 --y 500 --delta -300       # 负=下滚
    python win_gui.py key --vk 0x42 --ctrl                      # Ctrl+B
    python win_gui.py key --name ENTER
    python win_gui.py type --text "hello"                       # 剪贴板+Ctrl+V（中文安全）
    python win_gui.py type --file payload.txt                   # 粘贴整份文件
    python win_gui.py probe --title "Devtools" --x 900 --y 60   # 判定窗口是否卡死
    python win_gui.py close --title "Devtools"                  # PostMessage(WM_CLOSE)
    python win_gui.py selfcheck                                 # 环境自检

编码实战经验已写进代码（详见 references/pitfalls.md）：
  * 先 SetProcessDpiAwareness，否则 HiDPI 下坐标/截图整体偏移。
  * 中文/长文本一律走剪贴板 + Ctrl+V，绝不用 keybd_event 逐字打（输入法会吞字）。
  * SetForegroundWindow 会静默失败 → 兜底 AttachThreadInput（属 user32，不是 kernel32！）。
  * 关窗口用 PostMessage，不要 SendMessage（模态保存框会永久阻塞）。
  * 判断窗口是否卡死看「会不会重绘」，不要信 IsHungAppWindow（Chromium 死了也应答）。
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import hashlib
import os
import sys
import time

u = ctypes.windll.user32
k = ctypes.windll.kernel32

# ---------------------------------------------------------------- 基础/常量
CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

VK = {
    'LBUTTON': 0x01, 'RBUTTON': 0x02, 'CANCEL': 0x03, 'BACK': 0x08, 'TAB': 0x09,
    'ENTER': 0x0D, 'RETURN': 0x0D, 'SHIFT': 0x10, 'CTRL': 0x11, 'ALT': 0x12,
    'ESC': 0x1B, 'ESCAPE': 0x1B, 'SPACE': 0x20, 'LEFT': 0x25, 'UP': 0x26,
    'RIGHT': 0x27, 'DOWN': 0x28, 'DEL': 0x2E, 'DELETE': 0x2E,
    '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34, '5': 0x35,
    '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
    'A': 0x41, 'B': 0x42, 'C': 0x43, 'D': 0x44, 'E': 0x45, 'F': 0x46, 'G': 0x47,
    'H': 0x48, 'I': 0x49, 'J': 0x4A, 'K': 0x4B, 'L': 0x4C, 'M': 0x4D, 'N': 0x4E,
    'O': 0x4F, 'P': 0x50, 'Q': 0x51, 'R': 0x52, 'S': 0x53, 'T': 0x54, 'U': 0x55,
    'V': 0x56, 'W': 0x57, 'X': 0x58, 'Y': 0x59, 'Z': 0x5A,
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
    'F11': 0x7A, 'F12': 0x7B,
}


def set_dpi_aware():
    """HiDPI 必做第一步。失败回退到老 API。返回用了哪种。"""
    try:
        sh = ctypes.windll.shcore
        if sh.SetProcessDpiAwareness(2) == 0:      # PROCESS_PER_MONITOR_DPI_AWARE
            return 'shcore(2)'
    except Exception:
        pass
    try:
        if u.SetProcessDPIAware():
            return 'user32'
    except Exception:
        pass
    return 'none'


set_dpi_aware()

# 64 位指针必须显式声明 restype，否则指针被截成 32 位 → GlobalLock 返 0 → access violation
k.GlobalAlloc.restype = ctypes.c_void_p
k.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
k.GlobalLock.restype = ctypes.c_void_p
k.GlobalLock.argtypes = [ctypes.c_void_p]
k.GlobalUnlock.restype = ctypes.c_int
k.GlobalUnlock.argtypes = [ctypes.c_void_p]
u.OpenClipboard.argtypes = [ctypes.c_void_p]
u.SetClipboardData.restype = ctypes.c_void_p
u.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
u.GetClipboardData.restype = ctypes.c_void_p
u.GetClipboardData.argtypes = [ctypes.c_uint]
# AttachThreadInput 属 user32 —— 曾误挂到 kernel32 上导致兜底分支 AttributeError
u.AttachThreadInput.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_bool]
u.AttachThreadInput.restype = ctypes.c_bool
u.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(ctypes.c_ulong)]
u.GetWindowThreadProcessId.restype = ctypes.c_ulong


def _vk(v):
    """接受 0x42 / 66 / 'B' / 'ENTER' 四种写法。"""
    if isinstance(v, int):
        return v
    s = str(v).strip().upper()
    if s in VK:
        return VK[s]
    if s.upper().startswith('0X'):
        return int(s, 16)
    return int(s)


# ---------------------------------------------------------------- 窗口
def enum_windows():
    """返回 [(hwnd, class, title, w, h), ...]（仅可见且有标题的窗口）。"""
    out = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

    def cb(h, l):
        if u.IsWindowVisible(h):
            c = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(h, c, 256)
            n = u.GetWindowTextLengthW(h)
            b = ctypes.create_unicode_buffer(n + 2)
            u.GetWindowTextW(h, b, n + 1)
            if b.value.strip():
                r = wt.RECT()
                u.GetWindowRect(h, ctypes.byref(r))
                out.append((int(h), c.value, b.value, r.right - r.left, r.bottom - r.top))
        return True
    u.EnumWindows(CB(cb), 0)
    return out


def find_windows(title=None, cls=None, contains=True, min_w=0, min_h=0):
    """返回所有匹配的 hwnd 列表。默认子串匹配（窗口标题常带后缀/空格）。"""
    res = []
    for h, c, t, w, hh in enum_windows():
        if title:
            ok = (title in t) if contains else (t == title)
        else:
            ok = True
        if cls:
            ok = ok and ((cls in c) if contains else (c == cls))
        if ok and w >= min_w and hh >= min_h:
            res.append(h)
    return res


def find_window(title=None, cls=None, contains=True, min_w=0, min_h=0):
    """取第一个匹配窗口；没有返回 None。"""
    r = find_windows(title, cls, contains, min_w, min_h)
    return r[0] if r else None


def rect(hwnd):
    r = wt.RECT()
    u.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def wait_window(title=None, cls=None, contains=True, timeout=30, poll=1.0):
    """等某个窗口出现（App 冷启动常用）。返回 hwnd 或 None。"""
    end = time.time() + timeout
    while time.time() < end:
        h = find_window(title, cls, contains)
        if h:
            return h
        time.sleep(poll)
    return None


def focus(hwnd, settle=0.7):
    """还原 + 置前。SetForegroundWindow 失败时兜底 AttachThreadInput。"""
    u.ShowWindow(hwnd, 9)                            # SW_RESTORE（别用 3/MAXIMIZE，易把窗口搞成空白态）
    if not u.SetForegroundWindow(hwnd):
        fg = u.GetForegroundWindow()
        tf = u.GetWindowThreadProcessId(fg, None)
        tt = u.GetWindowThreadProcessId(hwnd, None)
        u.AttachThreadInput(tf, tt, True)
        u.SetForegroundWindow(hwnd)
        u.AttachThreadInput(tf, tt, False)
    time.sleep(settle)
    return u.GetForegroundWindow() == hwnd


def close_window(hwnd, force=False):
    """关窗口。只用 PostMessage（SendMessage 遇模态保存框会永久阻塞）。force 走 taskkill。"""
    ok = bool(u.PostMessageW(hwnd, 0x0010, 0, 0))     # WM_CLOSE
    if not ok and force:
        pid = ctypes.c_ulong()
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        import subprocess
        subprocess.run(['taskkill', '/PID', str(pid.value), '/T', '/F'])
    return ok


# ---------------------------------------------------------------- 鼠标/键盘
def move_to(x, y):
    u.SetCursorPos(int(x), int(y))
    time.sleep(0.2)


def click(x, y, settle=0.9, button='left'):
    down, up = (2, 4) if button == 'left' else (8, 16)
    u.SetCursorPos(int(x), int(y))
    time.sleep(0.25)
    u.mouse_event(down, 0, 0, 0, 0)
    time.sleep(0.07)
    u.mouse_event(up, 0, 0, 0, 0)
    time.sleep(settle)


def rclick(x, y, settle=0.6):
    """右键。⚠ 弹出菜单后必须在【同一段脚本】里接着点菜单项，脚本一结束菜单就没了。"""
    click(x, y, settle=settle, button='right')


def dblclick(x, y, settle=0.9):
    click(x, y, settle=0.05)
    click(x, y, settle=settle)


def drag(x1, y1, x2, y2, settle=0.5, steps=12):
    u.SetCursorPos(int(x1), int(y1))
    time.sleep(0.2)
    u.mouse_event(2, 0, 0, 0, 0)
    for i in range(1, steps + 1):
        u.SetCursorPos(int(x1 + (x2 - x1) * i / steps), int(y1 + (y2 - y1) * i / steps))
        time.sleep(0.02)
    u.mouse_event(4, 0, 0, 0, 0)
    time.sleep(settle)


def scroll(x, y, delta=-300, settle=0.4):
    """delta 负=向下滚。部分应用需要先点一下窗口内部才有焦点。"""
    u.SetCursorPos(int(x), int(y))
    time.sleep(0.2)
    u.mouse_event(0x0800, 0, 0, int(delta), 0)       # MOUSEEVENTF_WHEEL
    time.sleep(settle)


def key(vk, ctrl=False, alt=False, shift=False, settle=0.25):
    """敲键/组合键。vk 见 _vk() 支持的写法。"""
    mods = []
    if ctrl:
        mods.append(VK['CTRL'])
    if shift:
        mods.append(VK['SHIFT'])
    if alt:
        mods.append(VK['ALT'])
    for m in mods:
        u.keybd_event(m, 0, 0, 0)
    v = _vk(vk)
    u.keybd_event(v, 0, 0, 0)
    u.keybd_event(v, 0, 2, 0)
    for m in reversed(mods):
        u.keybd_event(m, 0, 2, 0)
    time.sleep(settle)


def set_clipboard(text):
    """写剪贴板（带重试，防别的程序占用）。"""
    h = k.GlobalAlloc(GMEM_MOVEABLE, (len(text) + 1) * 2)
    p = k.GlobalLock(h)
    ctypes.memmove(ctypes.c_void_p(p), ctypes.create_unicode_buffer(text), (len(text) + 1) * 2)
    k.GlobalUnlock(h)
    for _ in range(10):
        if u.OpenClipboard(None):
            u.EmptyClipboard()
            u.SetClipboardData(CF_UNICODETEXT, h)
            u.CloseClipboard()
            return True
        time.sleep(0.3)
    return False


def get_clipboard():
    if not u.OpenClipboard(None):
        return None
    h = u.GetClipboardData(CF_UNICODETEXT)
    val = None
    if h:
        p = k.GlobalLock(h)
        val = ctypes.wstring_at(p)
        k.GlobalUnlock(h)
    u.CloseClipboard()
    return val


def type_text(text, settle=0.6):
    """安全文本输入：剪贴板 + Ctrl+V（搜狗等输入法会吞逐字输入）。"""
    ok = set_clipboard(text)
    time.sleep(0.25)
    key(VK['V'], ctrl=True, settle=settle)
    return ok


def paste_file(path, encoding='utf-8', settle=1.0):
    with open(path, encoding=encoding) as f:
        return type_text(f.read(), settle=settle)


# ---------------------------------------------------------------- 截屏
def _pil():
    from PIL import ImageGrab
    return ImageGrab


def screenshot_screen(path):
    im = _pil().grab()
    im.save(path)
    return str(path)


def screenshot_window(hwnd, path, focus_first=True):
    if focus_first:
        focus(hwnd)
    im = _pil().grab(bbox=rect(hwnd))
    im.save(path)
    return str(path)


def screenshot_region(path, left, top, right, bottom):
    im = _pil().grab(bbox=(left, top, right, bottom))
    im.save(path)
    return str(path)


def frames_hash(hwnd, frames=3, interval=1.0, tmp=None):
    """连拍多帧返回 md5 列表；全同 = 屏幕根本不重绘（疑似卡死）。"""
    tmp = tmp or os.path.join(os.environ.get('TEMP', '.'), '_win_gui_probe.png')
    out = []
    for _ in range(frames):
        screenshot_window(hwnd, tmp)
        with open(tmp, 'rb') as f:
            out.append(hashlib.md5(f.read()).hexdigest())
        time.sleep(interval)
    return out


def probe_alive(hwnd=None, x=None, y=None, frames=3, interval=1.0, move_probe=True):
    """判定 UI 是否还活着：看会不会重绘，而不是问消息队列。

    返回 dict：{'alive': bool, 'hashes': [...], 'hover_diff': bool, 'note': str}
    hover 探针：把鼠标放到已知按钮上，比对「移上去前后」是否变化（Chromium/Electron 悬停必高亮）。
    """
    res = {'alive': False, 'hashes': [], 'hover_diff': None, 'note': ''}
    if hwnd is None:
        res['note'] = 'no hwnd'
        return res
    focus(hwnd)
    tmp = os.path.join(os.environ.get('TEMP', '.'), '_win_gui_probe.png')
    base = None
    if move_probe and x is not None and y is not None:
        move_to(0, 0) if False else None
        u.SetCursorPos(5, 5)
        time.sleep(0.4)
        screenshot_window(hwnd, tmp)
        with open(tmp, 'rb') as f:
            base = hashlib.md5(f.read()).hexdigest()
        move_to(x, y)
        time.sleep(1.2)
        screenshot_window(hwnd, tmp)
        with open(tmp, 'rb') as f:
            h2 = hashlib.md5(f.read()).hexdigest()
        res['hover_diff'] = (base != h2)
    hs = frames_hash(hwnd, frames=frames, interval=interval, tmp=tmp)
    res['hashes'] = hs
    stable = len(set(hs)) == 1
    res['alive'] = (not stable) or bool(res['hover_diff'])
    res['note'] = ('多帧字节全同' if stable else '画面有变化') + \
                  ('；悬停无高亮' if res['hover_diff'] is False else '') + \
                  '（勿信 IsHungAppWindow，Chromium 卡死时也应答）'
    return res


def find_color_center(path, pred, min_px=20):
    """按颜色定位控件中心：扫全图找满足 pred(r,g,b) 的像素团。返回 (x, y) 或 None。"""
    from PIL import Image
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    pts = [(x, y) for y in range(0, h, 2) for x in range(0, w, 2) if pred(*px[x, y])]
    if len(pts) < min_px:
        return None
    return (sum(p[0] for p in pts) // len(pts), sum(p[1] for p in pts) // len(pts))


def is_bright_green(r, g, b):
    return g > 150 and r < 120 and b < 140 and (g - r) > 60 and (g - b) > 40


# ---------------------------------------------------------------- 原生对话框
def save_dialog_fill(path, dlg_hwnd=None, settle=1.2):
    """给原生保存/打开框（class '#32770'）填全路径并回车。"""
    dlg = dlg_hwnd or find_window(cls='#32770', contains=False) or find_window(cls='#32770')
    if not dlg:
        return False
    focus(dlg, settle=0.7)
    set_clipboard(path)
    key(VK['A'], ctrl=True)          # 全选文件名
    key(VK['V'], ctrl=True)          # 粘贴全路径
    key(VK['ENTER'], settle=settle)  # 保存
    return True


# ---------------------------------------------------------------- 自检
def selfcheck(out_dir=None):
    out_dir = out_dir or os.environ.get('TEMP', '.')
    report = {'dpi': set_dpi_aware(), 'windows': 0, 'clipboard': False, 'screenshot': None, 'pillow': True}
    report['windows'] = len(enum_windows())
    report['clipboard'] = set_clipboard('WIN_GUI_SELFCHECK_OK') and (get_clipboard() == 'WIN_GUI_SELFCHECK_OK')
    p = os.path.join(out_dir, '_win_gui_selfcheck.png')
    try:
        screenshot_screen(p)
        report['screenshot'] = p
    except ImportError:
        report['pillow'] = False
        report['screenshot'] = None
    report['foreground'] = u.GetForegroundWindow() != 0
    return report


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description='Windows 桌面键鼠 + 截屏驱动')
    sub = ap.add_subparsers(dest='cmd', required=True)

    sub.add_parser('list', help='列出可见窗口')

    p = sub.add_parser('find')
    p.add_argument('--title'); p.add_argument('--class', dest='cls')
    p.add_argument('--exact', action='store_true', help='精确匹配（默认子串）')
    p.add_argument('--all', action='store_true', help='列出所有匹配')

    p = sub.add_parser('focus')
    p.add_argument('--title'); p.add_argument('--class', dest='cls')
    p.add_argument('--exact', action='store_true')

    p = sub.add_parser('shot')
    p.add_argument('--title'); p.add_argument('--class', dest='cls')
    p.add_argument('--exact', action='store_true')
    p.add_argument('--screen', action='store_true')
    p.add_argument('--region', help='left,top,right,bottom')
    p.add_argument('--out', required=True)
    p.add_argument('--no-focus', action='store_true')

    p = sub.add_parser('click')
    p.add_argument('--x', type=int, required=True); p.add_argument('--y', type=int, required=True)
    p.add_argument('--right', action='store_true')

    p = sub.add_parser('dblclick')
    p.add_argument('--x', type=int, required=True); p.add_argument('--y', type=int, required=True)

    p = sub.add_parser('move')
    p.add_argument('--x', type=int, required=True); p.add_argument('--y', type=int, required=True)

    p = sub.add_parser('scroll')
    p.add_argument('--x', type=int, required=True); p.add_argument('--y', type=int, required=True)
    p.add_argument('--delta', type=int, default=-300)

    p = sub.add_parser('drag')
    p.add_argument('--x1', type=int, required=True); p.add_argument('--y1', type=int, required=True)
    p.add_argument('--x2', type=int, required=True); p.add_argument('--y2', type=int, required=True)

    p = sub.add_parser('key')
    p.add_argument('--vk'); p.add_argument('--name')
    p.add_argument('--ctrl', action='store_true')
    p.add_argument('--alt', action='store_true')
    p.add_argument('--shift', action='store_true')

    p = sub.add_parser('type')
    p.add_argument('--text'); p.add_argument('--file')

    p = sub.add_parser('clip')
    p.add_argument('--set'); p.add_argument('--get', action='store_true')

    p = sub.add_parser('probe')
    p.add_argument('--title'); p.add_argument('--class', dest='cls')
    p.add_argument('--x', type=int); p.add_argument('--y', type=int)
    p.add_argument('--frames', type=int, default=3)

    p = sub.add_parser('close')
    p.add_argument('--title'); p.add_argument('--class', dest='cls')
    p.add_argument('--force', action='store_true')

    p = sub.add_parser('save-dialog')
    p.add_argument('--path', required=True)

    p = sub.add_parser('selfcheck')

    a = ap.parse_args(argv)

    def pick(title, cls, exact=False, all_=False):
        if all_:
            return find_windows(title, cls, contains=not exact)
        return find_window(title, cls, contains=not exact)

    if a.cmd == 'list':
        for h, c, t, w, hh in enum_windows():
            print(f'{h:<12} {c[:22]:22} {w}x{hh:<6} {t[:60]}')
        return 0

    if a.cmd == 'find':
        if a.all:
            for h in find_windows(a.title, a.cls, contains=not a.exact):
                print(h)
        else:
            print(pick(a.title, a.cls, a.exact))
        return 0

    if a.cmd == 'focus':
        h = pick(a.title, a.cls, a.exact)
        print('hwnd', h, 'focused', focus(h) if h else False)
        return 0

    if a.cmd == 'shot':
        if a.screen:
            print(screenshot_screen(a.out))
        elif a.region:
            print(screenshot_region(a.out, *[int(v) for v in a.region.split(',')]))
        else:
            h = pick(a.title, a.cls, a.exact)
            if not h:
                print('ERROR: window not found', file=sys.stderr)
                return 2
            print(screenshot_window(h, a.out, focus_first=not a.no_focus))
        return 0

    if a.cmd == 'click':
        click(a.x, a.y, button=('right' if a.right else 'left'))
        print('clicked', a.x, a.y)
        return 0

    if a.cmd == 'dblclick':
        dblclick(a.x, a.y)
        print('dblclicked', a.x, a.y)
        return 0

    if a.cmd == 'move':
        move_to(a.x, a.y)
        print('moved', a.x, a.y)
        return 0

    if a.cmd == 'scroll':
        scroll(a.x, a.y, a.delta)
        print('scrolled', a.delta)
        return 0

    if a.cmd == 'drag':
        drag(a.x1, a.y1, a.x2, a.y2)
        print('dragged')
        return 0

    if a.cmd == 'key':
        v = a.name or a.vk
        if v is None:
            print('ERROR: need --vk or --name', file=sys.stderr)
            return 2
        key(v, ctrl=a.ctrl, alt=a.alt, shift=a.shift)
        print('key', v, {'ctrl': a.ctrl, 'alt': a.alt, 'shift': a.shift})
        return 0

    if a.cmd == 'type':
        if a.file:
            paste_file(a.file)
            print('pasted file', a.file)
        else:
            type_text(a.text or '')
            print('typed', len(a.text or ''), 'chars')
        return 0

    if a.cmd == 'clip':
        if a.get:
            print(get_clipboard())
        if a.set is not None:
            print('set ok', set_clipboard(a.set))
        return 0

    if a.cmd == 'probe':
        h = pick(a.title, a.cls)
        if not h:
            print('ERROR: window not found', file=sys.stderr)
            return 2
        r = probe_alive(h, a.x, a.y, frames=a.frames)
        print('alive =', r['alive'])
        print('hover_diff =', r['hover_diff'])
        print('hashes =', r['hashes'][:4])
        print('note =', r['note'])
        return 0

    if a.cmd == 'close':
        h = pick(a.title, a.cls)
        print('closed', close_window(h, force=a.force) if h else False)
        return 0

    if a.cmd == 'save-dialog':
        print('save dialog filled', save_dialog_fill(a.path))
        return 0

    if a.cmd == 'selfcheck':
        r = selfcheck()
        for kk, vv in r.items():
            print(f'{kk:12} = {vv}')
        ok = bool(r['windows']) and r['clipboard'] and bool(r['screenshot'])
        print('SELFCHECK', 'PASS' if ok else 'FAIL')
        return 0 if ok else 1

    return 1


if __name__ == '__main__':
    sys.exit(main())
