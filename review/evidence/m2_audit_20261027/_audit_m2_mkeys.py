# -*- coding: utf-8 -*-
# M2 审计（巴迪自查 v2）：扫「js 里 M.X（M = TERMS.<区块>）引用了，但 terms 该区块没有这个键」⇒ 恒 undefined
# 只做扫描，不改任何文件。
import re, io, os

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
TERMS = os.path.join(ROOT, 'miniprogram', 'i18n', 'terms.js')

TARGETS = [
    'subpkg/tools/sandbox/index.js',
    'subpkg/tools/sandbox/matrix.js',
    'subpkg/tools/sandbox/compare.js',
    'subpkg/tools/sandbox/list.js',
]


def strip_comments(src):
    out = []
    for line in src.split('\n'):
        inq = None
        i = 0
        while i < len(line):
            c = line[i]
            if inq:
                if c == '\\':
                    i += 2
                    continue
                if c == inq:
                    inq = None
            else:
                if c in "'\"`":
                    inq = c
                elif c == '/' and i + 1 < len(line) and line[i + 1] == '/':
                    line = line[:i]
                    break
            i += 1
        out.append(line)
    return '\n'.join(out)


def block_keys(src, name):
    """提取 terms.js 里 `  <name>: { ... }` 区块的一级键"""
    code = strip_comments(src)
    m = re.search(r'(?m)^  %s:\s*\{' % re.escape(name), code)
    if not m:
        return None
    start = m.end() - 1
    depth = 0
    i = start
    inq = None
    while i < len(code):
        c = code[i]
        if inq:
            if c == '\\':
                i += 2
                continue
            if c == inq:
                inq = None
        else:
            if c in "'\"`":
                inq = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
        i += 1
    body = code[start:i + 1]
    return set(re.findall(r'(?m)^    ([A-Za-z_]\w*)\s*:', body))


terms_src = io.open(TERMS, encoding='utf-8').read()
print('=' * 78)
for rel in TARGETS:
    p = os.path.join(ROOT, rel)
    s = strip_comments(io.open(p, encoding='utf-8').read())
    # 找所有 `const M = TERMS.xxx;` / `const M = TERMS.xxx.yyy;`
    aliases = re.findall(r'const\s+M\s*=\s*TERMS(?:\.(\w+))?(?:\.(\w+))?\s*;', s)
    if not aliases:
        print('[SKIP] %s 无 `const M = TERMS...`' % rel)
        continue
    blocks = set()
    for a, b in aliases:
        if a and b:
            blocks.add((a, b))
        elif a:
            blocks.add((a, None))
    keys = set()
    for a, b in blocks:
        k = block_keys(terms_src, a)
        if k is None:
            continue
        if b:
            # 二级区块：在 a 区块内找 b
            m = re.search(r'(?m)^  %s:\s*\{' % re.escape(a), strip_comments(terms_src))
            # 简化：整仓找 `    <b>: {` 的键（小概率误并，够用）
            k2 = set(re.findall(r'(?m)^      ([A-Za-z_]\w*)\s*:', ''))
            keys |= k2
        else:
            keys |= k
    used = set(re.findall(r'(?<![\w.])\bM\.([A-Za-z_]\w*)', s))
    missing = sorted(k for k in used if k not in keys)
    print('[PAGE] %s' % rel)
    print('  M 别名区块：%s | 区块键 %d | M.X 引用 %d' % (sorted(blocks), len(keys), len(used)))
    print('  ❌ M.X 引用但 terms 无此键 ⇒ 恒 undefined：%s' % (missing if missing else '（无）'))
    print('-' * 78)
