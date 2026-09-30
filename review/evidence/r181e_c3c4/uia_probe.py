# -*- coding: utf-8 -*-
"""用 UI Automation 读「云开发控制台」Chromium 页面的可访问性树（可后台定位，不依赖前台）。"""
import sys, time

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import find_window
import uiautomation as auto

h = find_window(title='云开发控制台')
print('hwnd =', h, flush=True)
w = auto.ControlFromHandle(h)
print('root:', w.ControlTypeName, repr(w.Name), flush=True)

found = []
count = [0]


def walk(ctrl, depth=0):
    if depth > 12 or count[0] > 4000:
        return
    try:
        children = ctrl.GetChildren()
    except Exception:
        return
    for c in children:
        count[0] += 1
        try:
            nm = c.Name
            ct = c.ControlTypeName
            r = c.BoundingRectangle
            if nm and nm.strip():
                found.append((depth, ct, nm.strip()[:40], (r.left, r.top, r.right, r.bottom)))
        except Exception:
            pass
        walk(c, depth + 1)


t0 = time.time()
walk(w)
print('nodes =', count[0], 'named =', len(found), 'took %.1fs' % (time.time() - t0), flush=True)

KW = ('数据库', '云函数', '索引', '集合')
print('--- keyword hits ---', flush=True)
for d, ct, nm, r in found:
    if any(k in nm for k in KW):
        print('d=%d %-22s %-30r rect=%s' % (d, ct, nm, r), flush=True)

print('--- first 40 named nodes ---', flush=True)
for d, ct, nm, r in found[:40]:
    print('d=%d %-22s %-30r rect=%s' % (d, ct, nm, r), flush=True)
