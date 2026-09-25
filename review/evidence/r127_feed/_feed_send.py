# -*- coding: utf-8 -*-
"""在同一进程内：还原/置前 InsCode → UIA 复验输入框内容 → 发送 → 读 DB 核对。
判据（不靠截图）：sessions.body 的 User 非空条数 +1，或 inflight_turn 出现行。
"""
import sys, time, io, ctypes, ctypes.wintypes as wt, sqlite3, json

sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
import uiautomation as auto
auto.SetGlobalSearchTimeout(8.0)

PAYLOAD = io.open(r'C:/Users/lzj/AppData/Local/Temp/inscode/payload_m3v12_p0.txt', encoding='utf-8').read()
SID = '831bd65c-70cb-4600-8fb6-7ebe07886768'
DB = r'C:/Users/lzj/.config/inscode/inscode.db'
u = ctypes.windll.user32
k = ctypes.windll.kernel32


def counts():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    b = cur.execute('select body from sessions where id=?', (SID,)).fetchone()[0]
    msgs = json.loads(b)['messages']
    A = [m for m in msgs if m.get('role') == 'Assistant' and (m.get('text') or '').strip()]
    U = [m for m in msgs if m.get('role') == 'User' and (m.get('text') or '').strip()]
    infl = cur.execute('select count(*) from inflight_turn').fetchone()[0]
    con.close()
    return len(A), len(U), len(msgs), infl, U


def foreground(h):
    u.ShowWindow(h, 9)
    time.sleep(0.6)
    fg = u.GetForegroundWindow()
    if fg != h:
        tf = u.GetWindowThreadProcessId(fg, None)
        tm = k.GetCurrentThreadId()
        u.AttachThreadInput(tm, tf, True)
        u.SetForegroundWindow(h); u.BringWindowToTop(h); u.SetFocus(h)
        u.AttachThreadInput(tm, tf, False)
        time.sleep(0.6)
    return u.GetForegroundWindow() == h


A0, U0, M0, I0, _ = counts()
print('=== 发送前基线 ===')
print('Assistant=%d  User=%d  msgs=%d  inflight=%d' % (A0, U0, M0, I0))

h = ui.find_inscode()
print('hwnd =', h, ' 置前成功 =', foreground(h))

CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
rows = []
def cb(ch, l):
    b = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(ch, b, 256)
    rows.append((int(ch), b.value))
    return True
u.EnumChildWindows(h, CB(cb), 0)

doc = None
for hw, cls in rows:
    c = auto.ControlFromHandle(hw)
    if not c:
        continue
    if c.ControlTypeName == 'DocumentControl':
        doc = c; break
    for kk in c.GetChildren():
        if kk.ControlTypeName == 'DocumentControl':
            doc = kk; break
    if doc:
        break
if doc is None:
    print('❌ 没有 DocumentControl'); sys.exit(2)

edit = doc.EditControl(searchDepth=25)
n = len(edit.GetValuePattern().Value or '')
print('输入框当前 len =', n, ' 期望 =', len(PAYLOAD), ' ★一致 =', (n == len(PAYLOAD)))
if n != len(PAYLOAD):
    print('⚠️ 内容不符 —— 重新粘贴一次')
    try:
        edit.GetValuePattern().SetValue('')
    except Exception:
        pass
    time.sleep(0.3)
    ui.set_clipboard(PAYLOAD)
    time.sleep(0.5)
    assert (ui.get_clipboard() or '') == PAYLOAD, '剪贴板回读不一致'
    edit.SetFocus(); time.sleep(0.8)
    print('chord(Ctrl+V) =', ui.chord(0x11, 0x56))
    time.sleep(3.0)
    n = len(edit.GetValuePattern().Value or '')
    print('重贴后 len =', n, ' 一致 =', (n == len(PAYLOAD)))

if n != len(PAYLOAD):
    print('❌ 仍不符，拒绝发送')
    sys.exit(3)

# 确保焦点在输入框（点一下其 UIA 焦点 + 用 Ctrl+End 把光标推到末尾）
try:
    edit.SetFocus()
except Exception:
    pass
time.sleep(0.6)
print('chord(Ctrl+End) =', ui.chord(0x11, 0x23))
time.sleep(0.4)

print('--- 发送 ---')
print('send_vk(Enter down) =', ui.send_vk(0x0D))
time.sleep(0.12)
print('send_vk(Enter up)   =', ui.send_vk(0x0D, up=True))
time.sleep(5.0)

A1, U1, M1, I1, Ulist = counts()
print()
print('=== 发送后 ===')
print('Assistant=%d (%+d)  User=%d (%+d)  msgs=%d (%+d)  inflight=%d' % (
    A1, A1 - A0, U1, U1 - U0, M1, M1 - M0, I1))
print('输入框 现在 len =', len(edit.GetValuePattern().Value or ''))
print()
print('★ 硬判据 · User +1 =', U1 == U0 + 1)
print('★ 硬判据 · inflight 出现行 =', I1 > 0)
if U1 > U0:
    t = Ulist[-1]['text'] or ''
    print()
    print('最后一条 User 头 80 =', t[:80].replace('\n', ' / '))
    print('最后一条 User 尾 60 =', t[-60:].replace('\n', ' / '))
    print('★ 与我们载荷同源 =', t.strip()[:40] in PAYLOAD)

p = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_m3/ins_after_send.png'
ui.screenshot(p)
print()
print('已截 =', p)
