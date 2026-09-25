# -*- coding: utf-8 -*-
"""从单源 dump 生成 do_indexes3.py 的任务 JSON（避免手抄出错）。
用法: python gen_tasks.py <out.json> [coll1,coll2,...]
"""
import json, sys
D = json.load(open(r'C:/Users/lzj/AppData/Local/Temp/_idx_dump.json', encoding='utf-8'))
sel = sys.argv[2].split(',') if len(sys.argv) > 2 else None
tasks = []
n = 0
for e in D['byCollection']:
    if sel and e['coll'] not in sel:
        continue
    items = []
    for ix in e['indexes']:
        items.append([ix['name'], [[k['name'], k['direction']] for k in ix['keys']], bool(ix.get('unique'))])
        n += 1
    if items:
        tasks.append({'coll': e['coll'], 'items': items})
json.dump(tasks, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('生成 %s：%d 个集合 / %d 条索引' % (sys.argv[1], len(tasks), n))
for t in tasks:
    print('  %-26s %d' % (t['coll'], len(t['items'])))
