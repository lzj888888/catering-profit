# -*- coding: utf-8 -*-
# R210 追加变异：验证 D-⑩（店名截断）不是恒真
import io, os, hashlib, subprocess, sys, re

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
GUARD = 'tools/check_shop_reset.js'

def rd(p): return io.open(p, 'r', encoding='utf-8', newline='').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)
def md5(p): return hashlib.md5(io.open(p, 'rb').read()).hexdigest()

def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=REPO, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=180)
    out = (r.stdout or '') + (r.stderr or '')
    reds = set()
    for line in out.splitlines():
        line = line.strip()
        if line.startswith('\u274c'):
            m = re.match(r'\u274c\s+([A-Z]-\S+)', line)
            if m: reds.add(m.group(1))
    return r.returncode, reds

MUTS = [
    ('M11', os.path.join(REPO, 'pages/shop/switch.wxml'),
     '          <text class="nm">{{item.name}}</text>',
     '          {{item.name}}',
     {'D-⑩'}),
    ('M12', os.path.join(REPO, 'pages/shop/switch.wxss'),
     '.shop-main .shop-name .nm { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
     '.shop-main .shop-name .nm { flex: 1 1 auto; min-width: 0; }',
     {'D-⑩'}),
]

BASE = {}
for tag, p, old, new, exp in MUTS:
    BASE.setdefault(p, rd(p))
    if BASE[p].count(old) != 1:
        print('ANCHOR FAIL', tag, BASE[p].count(old)); sys.exit(2)
print('锚点自校验通过：%d 条' % len(MUTS))

H = {p: md5(p) for p in BASE}
bad = []
for tag, p, old, new, exp in MUTS:
    src = BASE[p]
    wr(p, src.replace(old, new, 1))
    try:
        rc, reds = run_guard()
    finally:
        wr(p, src)
    ok = rc == 1 and exp <= reds
    print('%s rc=%s 期望=%s 实红=%s %s' % (tag, rc, sorted(exp), sorted(reds), 'OK' if ok else 'FAIL'))
    if md5(p) != H[p]:
        print('  !! 还原失败', tag); sys.exit(3)
    if not ok: bad.append(tag)

print('\n追加变异：%d/%d 点名目标断言' % (len(MUTS) - len(bad), len(MUTS)))
if bad: sys.exit(4)
