# -*- coding: utf-8 -*-
"""R85 守卫回灌：四组变异。期望 红/绿/绿/绿。
手法：在既有活文档末尾**追加**探针行（不新建文件 ⇒ 无需删除），跑完按备份逐字节恢复并校验 md5。
"""
import io, os, subprocess, hashlib, sys

NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
GUARD = 'tools/check_stale_claims.js'
TARGET = 'BATCH0_DELIVERY.md'          # 已有政策行的活文档，正好再测一遍政策豁免
BAK = os.path.join(os.environ.get('TEMP', '/tmp'), 'r85_%s.bak' % TARGET)

tp = os.path.join(ROOT, TARGET)
orig = io.open(tp, 'rb').read()
io.open(BAK, 'wb').write(orig)
md5_orig = hashlib.md5(orig).hexdigest()


def run():
    p = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    red = '❌' in out
    return p.returncode, red, out


def set_tail(line):
    body = orig.decode('utf-8')
    io.open(tp, 'w', encoding='utf-8', newline='').write(body + ('\n' + line if line else ''))


CASES = [
    ('M1 裸断言（不带任何标记）',
     '<!-- r85 probe -->索引必须手工建，因为 SDK 没有 createIndex。',
     True),
    ('M2 同一句**带证伪标记**',
     '<!-- r85 probe -->索引必须手工建（旧口径，已于 2026-09-17 证伪）。',
     False),
    ('M3 政策类（prod 集合）',
     '<!-- r85 probe -->prod 集合在控制台手工建，initDb 绝不部署到 prod。',
     False),
    ('M4 恢复原状（按备份逐字节还原）', None, False),
]

okN = 0
for name, line, expect_red in CASES:
    if line is None:
        io.open(tp, 'wb').write(orig)
    else:
        set_tail(line)
    rc, red, out = run()
    got_red = (rc != 0) or red
    good = (got_red == expect_red)
    okN += 1 if good else 0
    print('%-38s 期望=%s 实测=%s rc=%d  %s'
          % (name, '红' if expect_red else '绿', '红' if got_red else '绿', rc,
             '✅' if good else '❌ 判据失效'))
    if expect_red and got_red:
        for L in out.split('\n'):
            if '⛔' in L or ('r85 probe' in L):
                print('        ↳ ' + L.strip()[:120])

# 收尾：确认恢复到了原始字节
now = io.open(tp, 'rb').read()
print()
print('恢复校验：md5 %s  %s' % (hashlib.md5(now).hexdigest()[:8],
                              '✅ 与原始逐字节一致' if hashlib.md5(now).hexdigest() == md5_orig else '❌ 未还原'))
print('===== R85 回灌：%d / %d 符合预期 =====' % (okN, len(CASES)))
sys.exit(0 if okN == len(CASES) else 1)
