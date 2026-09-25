# -*- coding: utf-8 -*-
"""投喂自检/代操原语 —— 两段式：
  1) 剪贴板跨进程：进程 A write（含非 BMP 字符的真实载荷）⇒ 进程 B read 逐字比对
  2) 注入探针：send_vk / chord 的返回值（SendInput 是否投递成功）
用法：
  _fc.py clipwrite <payload路径>
  _fc.py clipread  <payload路径>
"""
import sys, os, time, io, ctypes, ctypes.wintypes as wt

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui

def rd(p):
    return io.open(p, encoding='utf-8').read()

def wnd():
    h = ui.find_inscode()
    print('find_inscode hwnd =', h)
    if h:
        u = ctypes.windll.user32
        r = wt.RECT(); u.GetWindowRect(h, ctypes.byref(r))
        print('window rect =', (r.left, r.top, r.right, r.bottom),
              ' size=', (r.right - r.left, r.bottom - r.top))
        print('IsWindowVisible =', bool(u.IsWindowVisible(h)))
    return h

cmd = sys.argv[1]
if cmd == 'clipwrite':
    payload = rd(sys.argv[2])
    h = wnd()
    ok = ui.set_clipboard(payload)
    time.sleep(0.5)
    back = ui.get_clipboard() or ''
    print('set_clipboard 返回 =', ok)
    print('原文 len =', len(payload), ' 读回 len =', len(back))
    print('★ 逐字一致 =', back == payload)
    if back != payload:
        n = min(len(back), len(payload))
        for i in range(n):
            if back[i] != payload[i]:
                print('  首个差异 @%d  原文=%r  读回=%r' % (i, payload[i:i+12], back[i:i+12]))
                break
        else:
            print('  前缀一致，差异在尾部：原文尾部=%r  读回尾部=%r' % (payload[-20:], back[-20:]))
    # 非 BMP 字符计数（验证代理对修复）
    nbsp = sum(1 for c in payload if ord(c) > 0xFFFF)
    print('载荷内非 BMP 字符数 =', nbsp)
elif cmd == 'clipread':
    payload = rd(sys.argv[2])
    back = ui.get_clipboard() or ''
    print('跨进程读回 len =', len(back), ' 期望 len =', len(payload))
    print('★ 跨进程逐字一致 =', back == payload)
elif cmd == 'probe':
    h = wnd()
    print('send_vk(0x0D) =', ui.send_vk(0x0D))
    print('chord(Ctrl+V) =', ui.chord(0x11, 0x56))
else:
    print('unknown cmd', cmd)
