# -*- coding: utf-8 -*-
"""R202 变异回灌：证明 tools/check_shop_read_by_bizkey.js 新增的 A-⑩/A-⑪ 真能抓错。

纪律（沿用 mutation-backfill）：
  · 每条变异独立、锚点必须命中 == 1 次；
  · 判据必须**点名到目标断言**（不是"套件整体红"）；
  · 组 A 该红、组 B 不该红（防判据过严）；
  · 还原必须**字节级**（write_bytes，防文本写回把 LF 翻成 CRLF）。
"""
import os
import subprocess

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
AUTH = os.path.join(ROOT, 'cloudfunctions/common/auth.js')
CK = os.path.join(ROOT, 'tools/check_shop_read_by_bizkey.js')
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'

orig = open(AUTH, 'rb').read()


def run():
    p = subprocess.run([NODE, CK], cwd=ROOT, capture_output=True)
    out = (p.stdout or b'').decode('utf-8', 'replace')
    red = [ln for ln in out.splitlines() if ln.startswith('\u274c')]
    return p.returncode, red


def restore():
    open(AUTH, 'wb').write(orig)


def mutate(name, old, new, target):
    s = orig.decode('utf-8')
    hit = s.count(old)
    if hit != 1:
        print(f'{name}: 锚点命中 {hit} 次（须为 1） -> 跳过')
        return
    open(AUTH, 'wb').write(s.replace(old, new).encode('utf-8'))
    rc, red = run()
    named = [ln for ln in red if target in ln]
    flag = '\u2705 \u6709\u6548\u7ea2' if named else '\u274c \u672a\u70b9\u540d'
    print(f'{name}: rc={rc} \u7ea2\u603b\u6570={len(red)} \u70b9\u540d[{target}]={flag}')
    for ln in red:
        print('     ', ln[:120])
    restore()


print('===== \u57fa\u7ebf =====')
rc0, red0 = run()
print(f'\u57fa\u7ebf: rc={rc0} \u7ea2\u603b\u6570={len(red0)}')

print()
print('===== \u7ec4 A\uff08\u8be5\u7ea2\uff09=====')
mutate(
    'A1 \u56de\u9000\u5230 R201 \u65e7\u5f62\u6001\uff1a\u5220\u6389 id \u5151\u5e95\u6bb5',
    "      const q2 = await db.collection('shop').where({ id: shopId, is_deleted: false }).limit(1).get();",
    '      // MUTATED: id \u5151\u5e95\u5df2\u79fb\u9664',
    'A-\u2469',
)
mutate(
    'A2 \u9000\u56de\u5355\u952e\uff1ashop_id \u6539\u6210 shop_id_x\uff08\u5019\u9009\u952e\u53ea\u5269 1\uff09',
    'where({ shop_id: shopId, is_deleted: false })',
    'where({ shop_id_x: shopId, is_deleted: false })',
    'A-\u2462',
)
mutate(
    'A3 \u56de\u9000\u5230\u672a\u4fee\u590d\u65e7\u5b9e\u73b0\uff1a\u5151\u5e95\u6574\u6bb5\u6362\u6210\u88f8 doc \u76f4\u63a5 return',
    '      const q = await db.collection(\'shop\').where({ shop_id: shopId, is_deleted: false }).limit(1).get();',
    "      return { error: ERROR_CODES.RESOURCE_NOT_FOUND };",
    'A-\u2462',
)

print()
print('===== \u7ec4 B\uff08\u4e0d\u8be5\u7ea2\uff1a\u8bed\u4e49\u7b49\u4ef7\u6539\u5199\uff09=====')
mutate(
    'B1 \u7b49\u4ef7\uff1aid \u6bb5 limit(1) -> limit(2)',
    "await db.collection('shop').where({ id: shopId, is_deleted: false }).limit(1).get();",
    "await db.collection('shop').where({ id: shopId, is_deleted: false }).limit(2).get();",
    'A-\u2469',
)
# \u26a0\ufe0f B2 \u521d\u7248\u5199\u9519\u8fc7\uff08\u5df2\u4fee\u6b63\uff0c\u5199\u8fdb\u6765\u4f5c\u4e3a\u8bb0\u5f55\uff09\uff1a
#   \u539f\u610f\u662f\u201c\u4ea4\u6362\u4e24\u6bb5\u5151\u5e95\u987a\u5e8f\u201d\uff0c\u4f46\u5b9e\u9645\u628a `shop_id` \u6bb5\u7684\u67e5\u8be2\u6539\u6210\u4e86 `id` \u67e5\u8be2
#   \u2014\u2014 \u90a3\u7b49\u4e8e\u201c\u5220\u6389 shop_id \u6bb5\u201d\uff0c\u5b88\u536b\u5224\u7ea2\u662f**\u6b63\u786e**\u7684\uff08\u4e0d\u662f\u5224\u636e\u8fc7\u4e25\uff09\u3002
#   \u73b0\u6539\u7528\u771f\u7b49\u4ef7\u6539\u5199\uff1a`is_deleted: false` -> `is_deleted: !true`\uff08\u503c\u4ecd\u4e3a false\uff09\u3002
mutate(
    'B2 \u7b49\u4ef7\uff1aid \u6bb5 is_deleted: false -> !true\uff08\u503c\u76f8\u540c\u3001\u5b57\u9762\u4e0d\u540c\uff09',
    "await db.collection('shop').where({ id: shopId, is_deleted: false }).limit(1).get();",
    "await db.collection('shop').where({ id: shopId, is_deleted: !true }).limit(1).get();",
    'A-\u2469',
)

print()
print('===== \u8fd8\u539f\u540e =====')
restore()
rc2, red2 = run()
after = open(AUTH, 'rb').read()
print(f'\u8fd8\u539f\u540e: rc={rc2} \u7ea2\u603b\u6570={len(red2)} \u5b57\u8282\u4e00\u81f4={after == orig}')
