import os, re, subprocess, io

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
GUARD_DIRS = [os.path.join(ROOT, 'tools'), os.path.join(ROOT, 'specs', 'dev-specs', 'prototype')]

# 收集守卫源码全文（排除 review/）
guard_text = []
guard_files = []
for d in GUARD_DIRS:
    for fn in sorted(os.listdir(d)):
        if fn.endswith('.js') or fn.endswith('.py'):
            p = os.path.join(d, fn)
            try:
                guard_text.append((p, open(p, encoding='utf-8', errors='ignore').read()))
                guard_files.append(p)
            except Exception:
                pass

print('守卫文件数:', len(guard_files))

# 目标文档
doc_dirs = [os.path.join(ROOT, 'specs', 'dev-specs', 'core'),
            os.path.join(ROOT, 'specs', 'dev-specs'),
            os.path.join(ROOT, 'specs', 'dev-specs', 'delivery')]
docs = []
for d in doc_dirs:
    for fn in sorted(os.listdir(d)):
        if fn.endswith('.md'):
            docs.append((fn, os.path.join(d, fn)))
docs = list(dict(docs).items()) if False else sorted(set(docs))

rows = []
for fn, p in docs:
    stem = fn[:-3]
    cnt = 0
    where = []
    for gp, gt in guard_text:
        # 引用形态：文件名（含或不含扩展名）
        for pat in (re.escape(stem + '.md'), re.escape(stem)):
            if re.search(pat, gt):
                cnt += 1
                where.append(os.path.basename(gp))
                break
    rows.append((cnt, fn, sorted(set(where))))

rows.sort()
print('\n=== 按被引用次数升序（0 = 零守卫覆盖）===')
for cnt, fn, where in rows:
    flag = '  <<< 零覆盖' if cnt == 0 else ''
    print(f'{cnt:3d}  {fn}{flag}')
    if cnt <= 2 and where:
        print('        ->', ', '.join(where))
