# -*- coding: utf-8 -*-
# R298 B4 探针 2：契约「鉴权」列 ≡ 代码实然（归属校验面）
# 只读；不改任何文件。
import os, re, io

# ROOT：从本文件出发向上找 `verify_all.js`（仓根哨兵）—— 本件放在 review/evidence/** 下，
# ROOT：向上找 `verify_all.js`（仓根哨兵）。本件位于 review/evidence/** 下，
#   按固定层数回退会算错（实测：按 2 层落到 review/ ⇒ FileNotFoundError）。
def _find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            raise RuntimeError('仓根未找到（缺 verify_all.js 哨兵）')
        d = parent
ROOT = _find_root(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')
DOC = os.path.join(ROOT, 'specs/dev-specs/core/10_云函数清单与接口契约.md')

def read(p):
    with io.open(p, encoding='utf-8', errors='replace') as f:
        return f.read()

def strip_comments(s):
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return '\n'.join('' if re.match(r'^\s*//', l) else l for l in re.split(r'\r?\n', s))

# 1) 解析契约表：| `fn` | 用途 | 入参 | 出参 | 鉴权 |
doc = read(DOC).replace('\ufeff', '')
rows = []
for i, l in enumerate(doc.split('\n'), 1):
    m = re.match(r'^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|(.*)\|\s*$', l)
    if not m:
        continue
    fn = m.group(1)
    cells = [c.strip() for c in l.strip().strip('|').split('|')]
    if len(cells) < 5:
        continue
    auth_cell = '|'.join(cells[4:])   # 鉴权列（可能含 | 分隔的多段）
    rows.append((i, fn, auth_cell))

# 2) 代码实然
def code_info(fn):
    p = os.path.join(CF, fn, 'index.js')
    if not os.path.isfile(p):
        return None
    code = strip_comments(read(p))
    return dict(
        owner=bool(re.search(r'assertShopOwner\s*\(', code)),
        owner_prod=bool(re.search(r'=\s*await\s+assertShopOwner\s*\(', code)),
        auth=bool(re.search(r'resolveAuth\s*\(', code)),
        admin=bool(re.search(r'requireAuth\s*\(', code)),
        default_shop=bool(re.search(r'defaultShopId\s*\(', code)),
        ctx=bool(re.search(r'getWXContext\s*\(', code)),
    )

print('===== 契约鉴权列含 shop 但代码无 assertShopOwner（契约 ≡ 实然 不一致）=====')
bad = []
for ln, fn, auth in rows:
    info = code_info(fn)
    if info is None:
        continue
    if 'shop' in auth and not info['owner']:
        bad.append((ln, fn, auth, info))
for ln, fn, auth, info in bad:
    print('  🔴 L%-4d %-22s 契约=%-28s 代码: auth=%s defaultShopId=%s' %
          (ln, fn, auth[:28], info['auth'], info['default_shop']))
if not bad:
    print('  （无）')

print()
print('===== 契约鉴权列含 shop 且代码有 assertShopOwner（一致）=====')
okl = [(ln, fn) for ln, fn, auth in rows if 'shop' in auth and (code_info(fn) or {}).get('owner')]
print('  共 %d 个：%s' % (len(okl), ', '.join(fn for _, fn in okl)))

print()
print('===== 契约鉴权列 = 无（免鉴权）的函数 =====')
free = [(ln, fn, auth) for ln, fn, auth in rows if auth.startswith('无')]
for ln, fn, auth in free:
    info = code_info(fn) or {}
    print('  L%-4d %-22s 契约=%s ｜ 代码: ctx=%s owner=%s auth=%s' %
          (ln, fn, auth[:40], info.get('ctx'), info.get('owner'), info.get('auth')))

print()
print('===== 契约鉴权列 = user（不含 shop）的函数 =====')
u = [(ln, fn, auth) for ln, fn, auth in rows if auth and 'shop' not in auth and not auth.startswith('无')]
for ln, fn, auth in u:
    info = code_info(fn) or {}
    print('  L%-4d %-22s 契约=%-24s 代码: owner=%s' % (ln, fn, auth[:24], info.get('owner')))

print()
print('===== 契约表行总数 = %d ｜ 有 index.js 的行数 = %d =====' %
      (len(rows), sum(1 for _, fn, _ in rows if code_info(fn) is not None)))
