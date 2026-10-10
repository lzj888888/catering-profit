# -*- coding: utf-8 -*-
"""R263 变异回灌：故意把 hub 引导改回错误写法，看 check_hub_guide 是否点名转红。
🔴 一律二进制读写（Python 文本写在 Windows 会把 LF 变 CRLF ⇒ 还原后 md5 不等，R262 踩过）。"""
import io, os, subprocess, hashlib

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
WXML = 'pages/m3/hub.wxml'
TERMS = 'miniprogram/i18n/terms.js'
TERMS_B = 'specs/dev-specs/i18n/terms.js'
HUBJS = 'pages/m3/hub.js'
FILES = [WXML, TERMS, TERMS_B, HUBJS]


def rb(p):
    return io.open(os.path.join(REPO, p), 'rb').read()


def wb(p, b):
    io.open(os.path.join(REPO, p), 'wb').write(b)


def md5(p):
    return hashlib.md5(rb(p)).hexdigest()


def run():
    r = subprocess.run([NODE, 'tools/check_hub_guide.js'], cwd=REPO,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    reds = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
    return r.returncode, reds


orig = {p: rb(p) for p in FILES}
orig_md5 = {p: md5(p) for p in FILES}

rc0, reds0 = run()
print('基线：rc=%d 红=%d' % (rc0, len(reds0)))

cases = []

# ---- M1：空状态判据放宽（=== 0 → <= 0）----
b = orig[WXML].replace('cardCount === 0'.encode('utf-8'), 'cardCount <= 0'.encode('utf-8'))
cases.append(('M1 空状态判据放宽成 `<= 0`（网络抖动会误报「你还没有卡」）', WXML, b, 'G2-1'))

# ---- M2：把三步走块挪到第一张卡之后 ----
b = orig[WXML]
key = '<!-- ===== R263：三步走'.encode('utf-8')
i0 = b.find(key)
i1 = b.find(b'</view>', b.find(b'</view>', i0) + 7) if i0 >= 0 else -1
if i0 >= 0 and i1 > 0:
    i1 += len(b'</view>')
    blk = b[i0:i1]
    rest = b[:i0] + b[i1:]
    last = rest.rfind(b'</view>')
    b2 = rest[:last] + blk + b'\n' + rest[last:]
    cases.append(('M2 三步走块挪到卡片之后（老板还是先看到 5 张卡）', WXML, b2, 'G4-1'))
else:
    print('!! M2 取块失败，跳过')

# ---- M3：卡名改回旧名（两个副本一起改，避免 md5 先红掩盖 G6）----
bA = orig[TERMS].replace('takeawayTitle: \'外卖单均测算\''.encode('utf-8'),
                         'takeawayTitle: \'外卖菜品成本及利润\''.encode('utf-8'))
bB = orig[TERMS_B].replace('takeawayTitle: \'外卖单均测算\''.encode('utf-8'),
                           'takeawayTitle: \'外卖菜品成本及利润\''.encode('utf-8'))
cases.append(('M3 卡名改回「外卖菜品成本及利润」（与页面标题不一致）', TERMS, bA, 'G6-1', (TERMS_B, bB)))

# ---- M4：页面 t:{} 漏登记 flowSteps（数组漏登记 ⇒ 引导条静默空白）----
b = orig[HUBJS].replace('      flowSteps: TERMS.hub.flowSteps,\n'.encode('utf-8'), b'')
cases.append(('M4 hub.js 漏登记 flowSteps（数组漏登记 ⇒ 静默空白）', HUBJS, b, 'G5-2'))

ok = 0
for c in cases:
    name, path, mutated = c[0], c[1], c[2]
    extra = c[4] if len(c) > 4 else None
    target = c[3]
    wb(path, mutated)
    if extra:
        wb(extra[0], extra[1])
    rc, reds = run()
    hit = any(target in l for l in reds)
    print('%-58s rc=%d 红=%d 点名[%s]=%s' % (name, rc, len(reds), target, 'YES' if hit else 'NO'))
    if hit:
        ok += 1
    for r in reds[:3]:
        print('      ' + r)
    # 还原
    for p in FILES:
        wb(p, orig[p])

# 还原校验
bad = [p for p in FILES if md5(p) != orig_md5[p]]
print('\n还原校验：', '全部 md5 一致 ✅' if not bad else ('不一致 ❌ ' + str(bad)))
rcF, redsF = run()
print('还原后：rc=%d 红=%d' % (rcF, len(redsF)))
print('变异点名转红：%d/%d' % (ok, len(cases)))
