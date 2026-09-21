# 反向扫描：代码侧「阈值型常量」是否被 specs/ 声明、是否被 tools/ 守卫引用
import os, re
ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'

# 收集 specs 全树文本
specs_blob = ''
for dp, dn, fns in os.walk(os.path.join(ROOT, 'specs')):
    for f in fns:
        if f.endswith(('.md', '.txt')):
            specs_blob += open(os.path.join(dp, f), encoding='utf-8', errors='replace').read()
tools_blob = ''
for d in [os.path.join(ROOT, 'tools'), os.path.join(ROOT, 'specs', 'dev-specs', 'prototype')]:
    for fn in os.listdir(d):
        if fn.endswith(('.js', '.py')):
            tools_blob += open(os.path.join(d, fn), encoding='utf-8', errors='replace').read()
tools_blob += open(os.path.join(ROOT, 'verify_all.js'), encoding='utf-8', errors='replace').read()

pat = re.compile(r'(?m)^\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]{3,})\s*=\s*([0-9][0-9._]*)\s*[;,)]')
seen = {}
for base in ['cloudfunctions', 'miniprogram']:
    for dp, dn, fns in os.walk(os.path.join(ROOT, base)):
        if 'node_modules' in dp or 'miniprogram_npm' in dp:
            continue
        for f in fns:
            if not f.endswith('.js'):
                continue
            p = os.path.join(dp, f)
            try:
                src = open(p, encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            for m in pat.finditer(src):
                name, val = m.group(1), m.group(2)
                key = (name, val)
                if key in seen:
                    seen[key][1] += 1
                    continue
                in_specs = name in specs_blob
                in_tools = name in tools_blob
                seen[key] = [os.path.relpath(p, ROOT).replace('\\', '/'), 1, in_specs, in_tools]

rows = [(k, v) for k, v in seen.items()]
# 关注：数字 >= 3 且既未在 specs 声明 或 未被 tools 引用
print('CONST_TOTAL', len(rows))
print('--- 既无 specs 声明 也无 tools 引用（盲区候选）---')
n = 0
for (name, val), (fp, cnt, sp, tl) in sorted(rows):
    if sp or tl:
        continue
    if float(val.replace('_', '')) < 3:
        continue
    n += 1
    print(f'  {name} = {val}   {fp}')
print('CANDIDATES', n)
