# -*- coding: utf-8 -*-
# M2 审计（巴迪自查）：扫「wxml/js 引用了 t.X，但页面 data.t 没有该键映射」⇒ 恒 undefined / 静默空白
# 只做扫描，不改任何文件。判据是差集，不是字面量。
import re, os, io

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'

# (js, wxml) 配对：M2 的四个页面
PAIRS = [
    ('subpkg/tools/sandbox/index.js', 'subpkg/tools/sandbox/index.wxml'),
    ('subpkg/tools/sandbox/matrix.js', 'subpkg/tools/sandbox/matrix.wxml'),
    ('subpkg/tools/sandbox/compare.js', 'subpkg/tools/sandbox/compare.wxml'),
    ('subpkg/tools/sandbox/list.js', 'subpkg/tools/sandbox/list.wxml'),
]


def strip_comments(src):
    """去掉 // 行注释（保留字符串内的 // 误伤可接受：terms 值里没有 //）"""
    out = []
    for line in src.split('\n'):
        # 简单：找第一个不在引号内的 //
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


def extract_t_block(src):
    """定位 Page({ data: { t: { ... } } }) 里 t 对象的键集合（按花括号配平）"""
    code = strip_comments(src)
    # 找缩进 4 空格的 "t: {"
    m = None
    for mm in re.finditer(r'(?m)^    t:\s*\{', code):
        m = mm
        break
    if not m:
        return None
    start = m.end() - 1  # 指向 '{'
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
    # 顶层键：缩进 6 空格的 `key:`
    keys = set(re.findall(r'(?m)^      ([A-Za-z_]\w*)\s*:', body))
    return keys, body.count('\n') + 1


def refs(path):
    with io.open(path, encoding='utf-8') as f:
        s = f.read()
    s = strip_comments(s)
    return set(re.findall(r'(?<![\w.])\bt\.([A-Za-z_]\w*)', s))


def js_T_refs(path):
    with io.open(path, encoding='utf-8') as f:
        s = f.read()
    s = strip_comments(s)
    if not re.search(r'const T\s*=\s*this\.data\.t', s):
        return set(), False
    return set(re.findall(r'(?<![\w.])\bT\.([A-Za-z_]\w*)', s)), True


print('=' * 78)
for js, wxml in PAIRS:
    jp = os.path.join(ROOT, js)
    wp = os.path.join(ROOT, wxml)
    res = extract_t_block(io.open(jp, encoding='utf-8').read())
    if not res:
        print('[SKIP] %s 未定位到 data.t 块' % js)
        continue
    mapped, lines = res
    wref = refs(wp) if os.path.exists(wp) else set()
    jref, hasT = js_T_refs(jp)
    used = wref | jref
    # 排除 wxml 里 wx:for 的 item / index 等内置（t.xxx 不会被误伤）
    missing = sorted(k for k in used if k not in mapped)
    unused = sorted(k for k in mapped if k not in used)
    print('[PAGE] %s' % js)
    print('  data.t 映射 %d 键（块 %d 行）| wxml 用 t.X %d | js 用 T.X %d（T=this.data.t: %s）'
          % (len(mapped), lines, len(wref), len(jref), hasT))
    print('  ❌ 引用了但没映射 ⇒ 恒空白：%s' % (missing if missing else '（无）'))
    print('  ⚠️ 映射了但无人引用（死键）：%s' % (unused if unused else '（无）'))
    print('-' * 78)
