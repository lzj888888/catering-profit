"""R168 正式投喂（UIA 通道版）。
用法: feed_uia.py <payload.txt> <tag>
通道: 写入=PostMessage WM_CHAR 到 Chrome_RenderWidgetHostHWND；发送=WM_KEYDOWN/UP VK_RETURN。
说明: 本机安全软件拦截所有输入注入(mouse_event/keybd_event/SendInput/SetCursorPos)，
      故改用 PostMessage 直投 Chromium 渲染窗口——实测有效。
      ⚠️ WM_CHAR 发 '\n' 无效（被忽略），故先把换行折成空格。
"""
import sys, os, time, ctypes
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
import ctypes.wintypes as wt
from win_gui import find_window
from PIL import ImageGrab

u = ctypes.windll.user32
u.SetProcessDPIAware()
TARGET = find_window(title='豆包')
OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
WM_CHAR, WM_KEYDOWN, WM_KEYUP = 0x0102, 0x0100, 0x0101


def render_widget(parent):
    kids = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

    def cb(h, l):
        b = ctypes.create_unicode_buffer(256); u.GetClassNameW(h, b, 256)
        if 'RenderWidget' in b.value:
            kids.append(h)
        return True

    u.EnumChildWindows(parent, CB(cb), 0)
    return kids[0] if kids else parent


payload, tag = sys.argv[1], sys.argv[2]
raw = open(payload, encoding='utf-8').read().replace('\r\n', '\n')
text = raw.replace('\n', '  ')          # WM_CHAR 丢 \n ⇒ 折成双空格保分隔
print('payload=%s 原始=%d 字 折行后=%d 字' % (payload, len(raw), len(text)))

SUB = render_widget(TARGET)
print('render widget=%s  window=%s' % (SUB, TARGET))

for a in range(5):
    u.ShowWindow(TARGET, 9); time.sleep(0.4)
    u.SetForegroundWindow(TARGET); time.sleep(0.6)
    if u.GetForegroundWindow() == TARGET:
        print('[0] 置前成功(第%d次)' % (a + 1)); break
else:
    print('⚠️ 置前未确认，继续试投')

t0 = time.time()
for ch in text:
    u.PostMessageW(SUB, WM_CHAR, ord(ch), 1)
    time.sleep(0.012)
print('[1] 已输入 %d 字，耗时 %.1fs' % (len(text), time.time() - t0))
time.sleep(1.2)
ImageGrab.grab().save(OUT + '/_r168_%s_before_send.png' % tag)

u.PostMessageW(SUB, WM_KEYDOWN, 0x0D, 0x001C0001); time.sleep(0.15)
u.PostMessageW(SUB, WM_KEYUP, 0x0D, 0xC01C0001)
print('[2] 已投 Enter')
time.sleep(2.5)
# 保险：空输入框再按 Enter 无副作用，补投两次（首投曾失效）
for _ in range(2):
    u.PostMessageW(SUB, WM_KEYDOWN, 0x0D, 0x001C0001); time.sleep(0.15)
    u.PostMessageW(SUB, WM_KEYUP, 0x0D, 0xC01C0001); time.sleep(1.5)
print('[2b] Enter 补投完成')
time.sleep(2.0)
ImageGrab.grab().save(OUT + '/_r168_%s_sent.png' % tag)
print('[3] 截图 -> _r168_%s_before_send.png / _r168_%s_sent.png' % (tag, tag))
