# -*- coding: utf-8 -*-
# R215 探针：按「生产形态鉴权」分类 cloudfunctions/*/index.js
# 目的：取得「免鉴权函数」实测清单，供 tools/check_fn_public_surface.js 的 PUBLIC_FNS 登记表取实数
import os, re, io

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
CF = os.path.join(ROOT, 'cloudfunctions')

USER_AUTH = re.compile(r'resolveAuth\s*\(|=\s*await\s+assertShopOwner\s*\(')
ADMIN_AUTH = re.compile(r'requireAuth\s*\(|requireRole\s*\(')
CTX_OPENID = re.compile(r'getWXContext\s*\([\s\S]{0,400}?OPENID|OPENID\s*\)')

def strip_comments(s):
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return '\n'.join('' if l.strip().startswith('//') else l for l in s.split('\n'))

funcs = []
for name in sorted(os.listdir(CF)):
    d = os.path.join(CF, name)
    idx = os.path.join(d, 'index.js')
    if not os.path.isdir(d) or not os.path.exists(idx):
        continue
    funcs.append(name)

A, B, C = [], [], []
for name in funcs:
    src = strip_comments(open(os.path.join(CF, name, 'index.js'), encoding='utf-8').read())
    if USER_AUTH.search(src):
        A.append(name)
    elif ADMIN_AUTH.search(src):
        B.append(name)
    else:
        has_ctx = 'getWXContext' in src
        has_openid = 'OPENID' in src
        C.append((name, has_ctx, has_openid))

print('函数目录共 %d 个（含 common / _adminCore 等非函数目录）' % len(funcs))
print('A 用户鉴权（resolveAuth / = await assertShopOwner）：%d 个' % len(A))
print('B admin 鉴权（requireAuth / requireRole）：%d 个' % len(B))
print('C 免鉴权：%d 个' % len(C))
print('')
print('--- C 类明细（name / 有 getWXContext / 有 OPENID）---')
for n, c, o in C:
    print('  %-26s ctx=%-5s openid=%-5s' % (n, c, o))
print('')
print('--- A 类清单 ---')
print('  ' + ', '.join(A))
print('--- B 类清单 ---')
print('  ' + ', '.join(B))
