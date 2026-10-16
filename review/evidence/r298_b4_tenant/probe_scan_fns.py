# -*- coding: utf-8 -*-
# R298 B4 探针：逐个云函数判定「是否读前端传入 shop_id」×「是否做归属校验」
# 只读；不改任何文件。
import os, re, json, io

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

def read(p):
    with io.open(p, encoding='utf-8', errors='replace') as f:
        return f.read()

def strip_comments(s):
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    out = []
    for l in re.split(r'\r?\n', s):
        out.append('' if re.match(r'^\s*//', l) else l)
    return '\n'.join(out)

dirs = sorted(d for d in os.listdir(CF)
              if os.path.isdir(os.path.join(CF, d)) and d not in ('common',))

rows = []
for d in dirs:
    idx = os.path.join(CF, d, 'index.js')
    if not os.path.exists(idx):
        rows.append(dict(dir=d, note='无 index.js'))
        continue
    raw = read(idx)
    code = strip_comments(raw)

    # 1) 是否从 event 取 shop_id（各种形态）
    ev_forms = []
    for pat, name in [
        (r'\bevent\s*\.\s*shop_id\b', 'event.shop_id'),
        (r'\bevent\s*\.\s*shopId\b', 'event.shopId'),
        (r'\bshop_id\s*=\s*[^;]*\bevent\b', 'shop_id=…event'),
        (r'\bevent\s*\.\s*data\s*\.\s*shop_id\b', 'event.data.shop_id'),
        (r'\bparams\s*\.\s*shop_id\b', 'params.shop_id'),
        (r'\bbody\s*\.\s*shop_id\b', 'body.shop_id'),
    ]:
        if re.search(pat, code):
            ev_forms.append(name)
    # 宽松：任何出现在 event 解构里的 shop_id
    m = re.search(r'const\s*\{([^}]*)\}\s*=\s*event', code)
    if m and 'shop_id' in m.group(1):
        ev_forms.append('解构{shop_id}=event')

    # 2) 归属校验
    calls_owner = bool(re.search(r'assertShopOwner\s*\(', code))
    owner_prod = bool(re.search(r'=\s*await\s+assertShopOwner\s*\(', code))
    calls_auth = bool(re.search(r'resolveAuth\s*\(', code))
    gets_ctx = bool(re.search(r'getWXContext\s*\(', code))

    # 3) 是否触碰 shop 域集合（写/读）
    shop_cols = set(re.findall(r"collection\(\s*'([a-z_]+)'\s*\)", code))
    scoped = bool(shop_cols - {'user', 'admin_user', 'admin_token'})

    rows.append(dict(dir=d, ev=ev_forms, owner=calls_owner, owner_prod=owner_prod,
                     auth=calls_auth, ctx=gets_ctx, scoped=scoped,
                     cols=sorted(shop_cols)))

# —— 判定 ——
print('===== A) 读前端 shop_id 且**无**归属校验（高危候选）=====')
hi = [r for r in rows if r.get('ev') and not r.get('owner')]
for r in hi:
    print('  ⚠️ %-22s ev=%s  auth=%s ctx=%s cols=%s' %
          (r['dir'], ','.join(r['ev']), r.get('auth'), r.get('ctx'), ','.join(r.get('cols') or [])[:70]))
if not hi:
    print('  （无）')

print()
print('===== B) 读前端 shop_id 且**有**归属校验 =====')
mid = [r for r in rows if r.get('ev') and r.get('owner')]
print('  共 %d 个：%s' % (len(mid), ', '.join(r['dir'] for r in mid)))

print()
print('===== C) 不读 event.shop_id（身份全靠 OPENID 派生，按构造安全）=====')
lo = [r for r in rows if not r.get('ev')]
print('  共 %d 个：%s' % (len(lo), ', '.join(r['dir'] for r in lo)))

print()
print('===== D) 触碰 shop 域集合但既无 owner 也无 auth（最可疑）=====')
worst = [r for r in rows if r.get('scoped') and not r.get('owner') and not r.get('auth')]
for r in worst:
    print('  🔴 %-22s cols=%s' % (r['dir'], ','.join(r.get('cols') or [])))
if not worst:
    print('  （无）')

print()
print('===== E) 触碰 shop 域集合但无 owner（含仅 auth 的）=====')
w2 = [r for r in rows if r.get('scoped') and not r.get('owner')]
for r in w2:
    print('  %-22s owner=False auth=%s ctx=%s ev=%s' %
          (r['dir'], r.get('auth'), r.get('ctx'), ','.join(r.get('ev') or [])))

print()
print('===== 统计 =====')
print('  函数总数(排除 common):', len(rows))
print('  有 owner 校验:', sum(1 for r in rows if r.get('owner')))
print('  生产形态( = await assertShopOwner):', sum(1 for r in rows if r.get('owner_prod')))
print('  有 resolveAuth:', sum(1 for r in rows if r.get('auth')))
print('  读 event.shop_id:', sum(1 for r in rows if r.get('ev')))
