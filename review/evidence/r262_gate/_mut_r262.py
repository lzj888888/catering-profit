# -*- coding: utf-8 -*-
"""R262 变异回灌：把源码改回错误写法，看 ⑪ 段断言是否**点名转红**。

纪律（PITFALLS/技能 mutation-backfill）：
  · 崩溃红 ≠ 有效红 ⇒ 必须红在「目标断言名」上
  · 每条变异独立、可还原；还原后 md5 必须与改前全等
"""
import subprocess, hashlib, io, sys

NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
PAGE = r'pages/m3/dishreview/index.js'
TERMS = r'miniprogram/i18n/terms.js'


def md5(p):
    return hashlib.md5(io.open(p, 'rb').read()).hexdigest()


def rd(p):
    # 🔴 本机坑：文本模式写入会把 LF 变 CRLF ⇒ md5 与 git 视角双重失真（实测 571 处）
    #    ⇒ 读写一律走**二进制**，字节级还原。
    return io.open(p, 'rb').read().decode('utf-8')


def wr(p, s):
    io.open(p, 'wb').write(s.encode('utf-8'))


def run_guard():
    r = subprocess.run([NODE, 'tools/check_dishreview_engine.js'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    reds = [l.strip() for l in out.splitlines() if '❌' in l]
    return r.returncode, reds


CASES = [
    # (说明, 目标文件, 原文锚点, 错误写法, 期望点名转红的断言)
    ('M1 退化成旧行为：只看卡数是否为 0 ⇒ 3 卡 51 菜时零提示',
     PAGE,
     "const shortCardGap = unmatched.length - (cardOptions || []).length;",
     "const shortCardGap = (cardOptions || []).length ? 0 : unmatched.length;",
     '11-③'),
    ('M2 不替换 {n} 占位 ⇒ 用户看到字面 {n}',
     PAGE,
     "String(TERMS.card.reviewMapShortCard).replace('{n}', String(shortCardGap))",
     "String(TERMS.card.reviewMapShortCard)",
     '11-②'),
    ('M3 文案去掉 {n} 占位 ⇒ 缺口数字无处可填',
     TERMS,
     "reviewMapShortCard: '还有 {n} 道菜挂不上成本卡",
     "reviewMapShortCard: '还有几道菜挂不上成本卡",
     '11-①'),
]

ok = 0
for desc, target, old, new, expect in CASES:
    orig = rd(target)
    h0 = md5(target)
    if old not in orig:
        print('❌ 锚点未命中：%s | %s' % (desc, old[:60]))
        continue
    wr(target, orig.replace(old, new, 1))
    if rd(target) == orig:
        print('❌ Edit 未落盘：%s' % desc)
        wr(target, orig)
        continue
    rc, reds = run_guard()
    hit = [l for l in reds if expect in l]
    good = (rc != 0) and bool(hit)
    print('%s %s | rc=%s | 红 %d 条 | 命中 %s: %s'
          % ('✅' if good else '❌', desc, rc, len(reds), expect, bool(hit)))
    for l in hit[:2]:
        print('      ', l[:110])
    if good:
        ok += 1
    wr(target, orig)
    if md5(target) != h0:
        print('❌ 还原失败（md5 不等）：%s' % target)
        sys.exit(1)

print('\n===== 变异回灌：%d/%d 点名转红；三份文件 md5 已还原 =====' % (ok, len(CASES)))
print('  page  md5 =', md5(PAGE))
print('  terms md5 =', md5(TERMS))
sys.exit(0 if ok == len(CASES) else 1)
