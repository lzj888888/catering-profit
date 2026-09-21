# 扫 terms.js 的清单型 key（对象字面量），列出每个清单的项数与是否被 tools/ 引用
import os, re
ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
TERMS = os.path.join(ROOT, 'miniprogram', 'i18n', 'terms.js')
src = open(TERMS, encoding='utf-8').read()
print('TERMS_BYTES', len(src), 'CRLF', src.count('\r\n'), 'LF', src.count('\n'))

# 找 `xxx: {` 开头的顶层/二级块
blocks = []
for m in re.finditer(r'(?m)^(\s{2})(\w+):\s*\{', src):
    name, start = m.group(2), m.end()
    # 用大括号配平找到块结束
    depth, i = 1, start
    while i < len(src) and depth > 0:
        if src[i] == '{': depth += 1
        elif src[i] == '}': depth -= 1
        i += 1
    blocks.append((name, src[start:i-1]))

tools_blob = ''
tools_dir = os.path.join(ROOT, 'tools')
for fn in os.listdir(tools_dir):
    if fn.endswith(('.js', '.py')):
        tools_blob += open(os.path.join(tools_dir, fn), encoding='utf-8', errors='replace').read()
proto = os.path.join(ROOT, 'specs', 'dev-specs', 'prototype')
for fn in os.listdir(proto):
    if fn.endswith('.js'):
        tools_blob += open(os.path.join(proto, fn), encoding='utf-8', errors='replace').read()

print('BLOCKS', len(blocks))
for name, body in blocks:
    leaf = len(re.findall(r'(?m)^\s{4,}\w+:', body))
    if leaf < 3:
        continue
    ref = len(re.findall(r'\b' + name + r'\b', tools_blob))
    print(f'  {name:28s} leaves={leaf:3d}  tools_ref={ref}')
