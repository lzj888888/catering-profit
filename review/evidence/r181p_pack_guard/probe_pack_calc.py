# -*- coding: utf-8 -*-
"""R181p 打包体积核算（含 prefix 规则；镜像即将落库的 tools/check_pack_size.js 匹配器）。
用途：为守卫的常量取实测值，不做任何写入/删除。"""
import json
import os

R = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
cfg = json.load(open(os.path.join(R, 'project.config.json'), encoding='utf-8'))
IGN = cfg['packOptions']['ignore']
FOLDERS = {x['value'].lower() for x in IGN if x['type'] == 'folder'}
FILES = {x['value'].lower() for x in IGN if x['type'] == 'file'}
SUFFIX = {x['value'].lower() for x in IGN if x['type'] == 'suffix'}
PREFIX = {x['value'].lower() for x in IGN if x['type'] == 'prefix'}


def is_ignored(rel):
    """rel: 以 / 分隔的仓库内相对路径。镜像 devtools 语义（value 以小程序根为根、大小写不敏感）。"""
    low = rel.lower()
    seg = low.split('/')
    name = seg[-1]
    # folder：任一祖先目录的相对路径 == value，或自身（目录）== value
    for i in range(1, len(seg) + 1):
        if '/'.join(seg[:i]) in FOLDERS:
            return True
    if low in FILES:
        return True
    for s in SUFFIX:
        if low.endswith(s):
            return True
    for p in PREFIX:
        if low.startswith(p) or name.startswith(p):
            return True
    return False


total = 0
kept = []
tops = {}
n_all = 0
for dp, dn, fn in os.walk(R):
    parts = os.path.relpath(dp, R).split(os.sep)
    if '.git' in parts:
        continue
    for f in fn:
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, R).replace('\\', '/')
        n_all += 1
        try:
            s = os.path.getsize(p)
        except OSError:
            continue
        if is_ignored(rel):
            continue
        total += s
        kept.append((s, rel))
        tops[rel.split('/')[0]] = tops.get(rel.split('/')[0], 0) + s

print('ignore types =', sorted({x['type'] for x in IGN}), '| 规则条数 =', len(IGN))
print('全盘文件数 =', n_all, '| 未忽略(入包)文件数 =', len(kept))
print('== 入包总量 = %.4f MB (%d 字节)；微信硬上限 2 MB ==' % (total / 1048576, total))
print('--- 未忽略的顶层条目（全量）---')
for k, v in sorted(tops.items(), key=lambda x: -x[1]):
    print('   %10.4f MB  %s' % (v / 1048576, k))
print('--- 入包中最大的 12 个文件 ---')
for s, r in sorted(kept, reverse=True)[:12]:
    print('   %10.4f MB  %s' % (s / 1048576, r))
