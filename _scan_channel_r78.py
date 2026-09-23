# round78 取证：收入渠道字典三处实扫（前端 terms / 云函数种子 / 原型副本）
import re, io, sys, json, os
ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'

def read(p):
    return open(os.path.join(ROOT, p), encoding='utf-8').read()

# 1) 前端 terms.js :: ledger.income
terms = read('miniprogram/i18n/terms.js')
inc_block = terms[terms.index('income: ['):terms.index('expense: [')]
front = {}
for m in re.finditer(r"category: '(\w+)',\s*label: '([^']+)',\s*items: \[([^\]]*)\]", inc_block):
    cat, label, items = m.group(1), m.group(2), m.group(3)
    front[cat] = [x.strip().strip("'").strip() for x in items.split(',') if x.strip()]

# 2) 云函数种子 collections.js :: SEED_INCOME_ITEMS
col = read('cloudfunctions/initDb/collections.js')
b = col[col.index('const SEED_INCOME_ITEMS = ['):]
b = b[:b.index('];')]
cf = {}
for m in re.finditer(r"item_key: '([^']+)',\s*item_name: '([^']+)',\s*category: '([^']+)'", b):
    cf.setdefault(m.group(3), []).append((m.group(1), m.group(2).strip()))

# 3) 原型副本 init_db.js
pro = read('specs/dev-specs/prototype/init_db.js')
b2 = pro[pro.index('const SEED_INCOME_ITEMS = ['):]
b2 = b2[:b2.index('];')]
pr = {}
for m in re.finditer(r"item_key: '([^']+)',\s*item_name: '([^']+)',\s*category: '([^']+)'", b2):
    pr.setdefault(m.group(3), []).append((m.group(1), m.group(2).strip()))

out = {'front': front, 'cloudfunction': cf, 'prototype': pr}
print(json.dumps(out, ensure_ascii=False, indent=1))
print('\n=== 堂食逐项比对 ===')
print('前端 terms 堂食 (%d):' % len(front.get('dine_in', [])), front.get('dine_in'))
print('云函数种子 堂食 (%d):' % len(cf.get('dine_in', [])), [n for _, n in cf.get('dine_in', [])])
print('原型副本   堂食 (%d):' % len(pr.get('dine_in', [])), [n for _, n in pr.get('dine_in', [])])
print('\n=== 其他业务收入比对 ===')
print('前端 (%d):' % len(front.get('other', [])), front.get('other'))
print('云函数 (%d):' % len(cf.get('other', [])), [n for _, n in cf.get('other', [])])
print('\n=== 原型副本 ≡ 云函数副本 ? ===', cf == pr)
