"""round88 反向扫描：代码侧配置常量 -> 有无 specs 声明 + 有无 tools 守卫引用。
比 round82 扩网：除 `const X = <数字|表达式>` 外，还收对象字面量里的数值字段、默认参数阈值。
"""
import os, re, subprocess, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SKIP_DIRS = {'.git', 'node_modules', 'miniprogram_npm', 'review', '.workbuddy'}

# 扫描面：云函数 + 小程序（排除 _adminCore 扁平副本？不排除，但标注）
CODE_DIRS = ['cloudfunctions', 'miniprogram', 'tools', 'specs/dev-specs/prototype']

NUM = r'(?:\d+(?:\s*[*+/-]\s*\d+)*)'
PAT_SCALAR = re.compile(r'\bconst\s+([A-Z][A-Z0-9_]{3,})\s*[:=]\s*(' + NUM + r')\b')
PAT_OBJ = re.compile(r'\b(?:const|let|var)\s+([A-Z][A-Z0-9_]{3,})\s*[:=]\s*\{([^{}]*)\}', re.S)
PAT_FIELD = re.compile(r'([A-Za-z_][A-Za-z0-9_]{2,})\s*:\s*(' + NUM + r')\s*[,}]')

found = {}  # name -> (file, line, kind)

def walk(base):
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith(('.js', '.json')):
                yield os.path.join(dp, fn)

def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')

is_cf_copy = lambda p: p.endswith('.js') and '/cx_' in p or os.path.basename(p).startswith('cx_')

for d in CODE_DIRS:
    base = os.path.join(ROOT, d.replace('/', os.sep))
    if not os.path.isdir(base):
        continue
    for p in walk(base):
        rp = rel(p)
        if rp.startswith('cloudfunctions/') and ('/cx_' in rp or '/node_modules/' in rp):
            continue  # 扁平副本噪音
        try:
            txt = open(p, encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        for m in PAT_SCALAR.finditer(txt):
            n = m.group(1)
            if n not in found:
                found[n] = (rp, txt[:m.start()].count('\n') + 1, 'scalar', m.group(2))
        for m in PAT_OBJ.finditer(txt):
            n = m.group(1)
            for fm in PAT_FIELD.finditer(m.group(2)):
                key = '%s.%s' % (n, fm.group(1))
                if key not in found:
                    found[key] = (rp, txt[:m.start()].count('\n') + 1, 'obj', fm.group(2))

# 文档侧：specs 全树 .md
doc_files = []
for base in [os.path.join(ROOT, 'specs')]:
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith('.md'):
                doc_files.append(os.path.join(dp, fn))
doc_blob = {}
for f in doc_files:
    doc_blob[f] = open(f, encoding='utf-8', errors='ignore').read()

tool_files = []
for base in [os.path.join(ROOT, 'tools'), os.path.join(ROOT, 'specs', 'dev-specs', 'prototype')]:
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith('.js'):
                tool_files.append(os.path.join(dp, fn))
tool_blob = {}
for f in tool_files:
    tool_blob[f] = open(f, encoding='utf-8', errors='ignore').read()

rows = []
for name, (rp, ln, kind, val) in sorted(found.items()):
    short = name.split('.')[-1] if kind == 'obj' else name
    doc_hits = [rel(f) for f, t in doc_blob.items() if short in t]
    tool_hits = [rel(f) for f, t in tool_blob.items() if short in t]
    rows.append((name, rp, ln, kind, val, doc_hits, tool_hits))

# 关注：文档有声明 或 看起来像"口径"的（限额/限流/超时/期限/阈值）
KEYWORD = re.compile(r'(LIMIT|LIMITS|QUOTA|MAX|MIN|THRESH|TTL|TIMEOUT|EXPIRE|DURATION|WINDOW|FREE|HARD|'
                     r'RETRY|SIZE|COUNT|DAYS|DAYS_|MONTH|PRICE|FEE|RATE|AMOUNT|CAP|BOUND|FLOOR|CEIL|'
                     r'LOCK|FAIL|ATTEMPT|PAGE|PAGE_SIZE|BATCH|DELAY|INTERVAL|KEEP|RETENTION)')
print('TOTAL_CONST =', len(rows))
print()
print('=== A 组：文档零提及 且 tools 零引用（完全无守卫）===')
cnt = 0
for name, rp, ln, kind, val, docs, tools_ in rows:
    if not docs and not tools_:
        cnt += 1
        print('  %-42s %-52s :%s  %s=%s' % (name, rp, ln, kind, val))
print('A_TOTAL =', cnt)
print()
print('=== B 组：名字像"口径"常量（可能进对外契约）===')
for name, rp, ln, kind, val, docs, tools_ in rows:
    if KEYWORD.search(name.upper()):
        print('  %-42s %-46s :%-5s %s=%-10s doc=%d tool=%d' %
              (name, rp, ln, kind, val, len(docs), len(tools_)))
