import ctypes, sys, time
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(6.0)

h = ui.find_inscode()
w = auto.ControlFromHandle(h)
print('root =', w.ControlTypeName, repr(w.Name)[:40])
cnt = 0
for c, d in auto.WalkControl(w, maxDepth=16):
    try:
        tn = c.ControlTypeName
        aid = (c.AutomationId or '')
        nm = (c.Name or '')
        if tn in ('ButtonControl',) or 'send' in aid.lower() or '发送' in nm:
            r = c.BoundingRectangle
            print('d=%d' % d, tn, repr(nm)[:34], 'aid=%s' % aid, 'rect=', (r.left, r.top, r.right, r.bottom))
            cnt += 1
    except Exception:
        pass
print('total buttons =', cnt)
