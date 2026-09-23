# -*- coding: utf-8 -*-
"""round81：重启键两处套件数 84 -> 85（字节级替换，保持 CRLF）"""
import io, sys

P = 'specs/dev-specs/★知识存储点_2026-09-10.md'
d = open(P, 'rb').read()
crlf_before = d.count(b'\r\n')
lf_before = d.count(b'\n')

# ① §1.1 一键校验入口行
a1 = '串 **84** 个套件'.encode('utf-8')
b1 = '串 **85** 个套件'.encode('utf-8')
n1 = d.count(a1)
assert n1 == 1, f'A1 anchor count={n1}'
d = d.replace(a1, b1, 1)

# ② 「套件数会漂」演进链：追加第 85 条
a2 = '**。⚠️ **本重启键里「套件数」已写死两处'.encode('utf-8')
add = ('** → **85（round81：新增 `tools/check_audit_redlines.js`，微信审核硬红线条数口径守卫，R112 —— '
       '根因＝`core/11_微信审核自查清单.md` §2 那条清单自称「权威计数」、是**提审前逐条勾的面**，'
       '而 `tools/`+`prototype/` 对 core/11 **零引用**、既有的 R100 把单源写死为 `core/04` ⇒ 长期零守卫；'
       'round81 回源实扫**当前零漂移**（全仓仅清单标题一处提及）⇒ 本守卫属**防复发**而非修缺陷；'
       '裸扫「N 条红线」会误杀本行演进链里的历史值 ⇒ 走语义标记 + 锚点就近）**').encode('utf-8')
b2 = ('** → **85（round81：新增 `tools/check_audit_redlines.js`，微信审核硬红线条数口径守卫，R112 —— '
      '根因＝`core/11_微信审核自查清单.md` §2 那条清单自称「权威计数」、是**提审前逐条勾的面**，'
      '而 `tools/`+`prototype/` 对 core/11 **零引用**、既有的 R100 把单源写死为 `core/04` ⇒ 长期零守卫；'
      'round81 回源实扫**当前零漂移**（全仓仅清单标题一处提及）⇒ 本守卫属**防复发**而非修缺陷；'
      '裸扫「N 条红线」会误杀本行演进链里的历史值 ⇒ 走语义标记 + 锚点就近）**'
      '。⚠️ **本重启键里「套件数」已写死两处').encode('utf-8')
assert add == b2[:len(add)]
n2 = d.count(a2)
assert n2 == 1, f'A2 anchor count={n2}'
d = d.replace(a2, b2, 1)

open(P, 'wb').write(d)
d2 = open(P, 'rb').read()
print('CRLF before/after: %d/%d   LF before/after: %d/%d' % (
    crlf_before, d2.count(b'\r\n'), lf_before, d2.count(b'\n')))
print('串 **85** 出现次数 =', d2.count('串 **85** 个套件'.encode('utf-8')))
print('R112 提及次数 =', d2.count(b'R112'))
