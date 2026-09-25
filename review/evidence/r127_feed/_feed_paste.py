# -*- coding: utf-8 -*-
"""投喂 InsCode：UIA 定位输入框 + SendInput 真实 Ctrl+V（可选 Enter 发送）。
用法：_feed_paste.py          → 只粘贴，打印 UIA 读回长度
      _feed_paste.py --send   → 粘贴后按 Enter 发送
"""
import sys, os, time, io, ctypes, ctypes.wintypes as wt

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(8.0)

PAYLOAD = io.open(r'C:/Users/lzj/AppData/Local/Temp/inscode/payload_m3v12_p0.txt', encoding='utf-8').read()
SEND = '--send' in sys.argv

u = ctypes.windll.user32
k = ctypes.windll.kernel32


def foreground(h):
    fg = u.GetForegroundWindow()
    if fg == h:
        return True
    t_fg = u.GetWindowThreadProcessId(fg, None)
    t_me = k.GetCurrentThreadId()
    u.AttachThreadInput(t_me, t_fg, True)
    u.SetForegroundWindow(h); u.BringWindowToTop(h); u.SetFocus(h)
    u.AttachThreadInput(t_me, t_fg, False)
    time.sleep(0.6)
    return u.GetForegroundWindow() == h


def enum_children(h):
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    rows = []

    def cb(ch, l):
        b = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(ch, b, 256)
        rows.append((int(ch), b.value))
        return True
    u.EnumChildWindows(h, CB(cb), 0)
    return rows


h = ui.find_inscode()
print('hwnd =', h)
print('置前成功 =', foreground(h))
try:
    ui.focus(h)
except Exception as e:
    print('ui.focus 异常(可忽略):', e)

rows = enum_children(h)
print('子窗口数 =', len(rows))
doc = None
for hw, cls in rows:
    c = auto.ControlFromHandle(hw)
    if not c:
        continue
    if c.ControlTypeName == 'DocumentControl':
        doc = c
        print('DocumentControl =', hw, cls)
        break
    for kk in c.GetChildren():
        if kk.ControlTypeName == 'DocumentControl':
            doc = kk
            print('DocumentControl(嵌套) =', hw, cls)
            break
    if doc:
        break

if doc is None:
    print('❌ 未找到 DocumentControl —— 界面可能不在聊天页')
    sys.exit(2)

edit = None
try:
    edit = doc.EditControl(searchDepth=25)
except Exception as e:
    print('EditControl 查找异常:', e)

if edit is None:
    print('❌ 未找到 EditControl（聊天输入框）')
    sys.exit(3)

print('EditControl Name =', repr(edit.Name))
print('EditControl Rect =', edit.BoundingRectangle)


def value_len():
    try:
        return len(edit.GetValuePattern().Value or '')
    except Exception as e:
        return 'ERR:%s' % e


def send_state():
    try:
        # 找到"发送"按钮的 legacy state（0x1=disabled / 0x100000=enabled）
        for b in doc.GetChildren():
            pass
        btn = doc.ButtonControl(searchDepth=25)
        if btn:
            st = btn.GetLegacyIAccessiblePattern().State
            return hex(st)
    except Exception:
        pass
    return '(读不到)'


print()
print('--- 粘贴前 ---')
print('输入框 len =', value_len())
print('按钮 state =', send_state())

# 清残留 + 写剪贴板 + 自证
try:
    edit.GetValuePattern().SetValue('')
except Exception as e:
    print('清空异常(可忽略):', e)
time.sleep(0.3)

ok = ui.set_clipboard(PAYLOAD)
time.sleep(0.5)
back = ui.get_clipboard() or ''
print('set_clipboard =', ok, ' 回读一致 =', back == PAYLOAD, ' len =', len(back))
if back != PAYLOAD:
    print('❌ 剪贴板回读不一致，禁止发送')
    sys.exit(4)

print()
print('--- 真实粘贴 ---')
try:
    edit.SetFocus()
except Exception as e:
    print('SetFocus 异常:', e)
time.sleep(0.8)

rc = ui.chord(0x11, 0x56)
print('chord(Ctrl+V) 返回 =', rc)
time.sleep(3.0)

n = value_len()
print('粘贴后 输入框 len =', n, ' 期望 =', len(PAYLOAD), ' ★一致 =', n == len(PAYLOAD))
print('粘贴后 按钮 state =', send_state())

if SEND:
    if n != len(PAYLOAD):
        print('❌ 长度不符，拒绝发送')
        sys.exit(5)
    print()
    print('--- 发送 ---')
    print('send_vk(Enter) 返回 =', ui.send_vk(0x0D))
    time.sleep(0.1)
    print('send_vk(Enter up) 返回 =', ui.send_vk(0x0D, up=True))
    time.sleep(3.0)
    print('发送后 输入框 len =', value_len())
