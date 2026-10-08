# -*- coding: utf-8 -*-
# review/evidence/r240_module_review/scan_platform_coupling.py
# R240 —— 扫「账单/销量表的平台耦合面」：加一家新平台（如京东）到底要动几处？
#
# 判据不是「命中多少行」，而是「**必须改的文件**有几处」——同名/注释不算。
import io, os, re, json

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SCAN_DIRS = ['cloudfunctions', 'utils', 'pages', 'tools', 'miniprogram']
EXTS = ('.js',)

# 与「平台身份」强耦合的符号（不是平台名本身，而是"分派逻辑"）
SIGS = {
    'COL 列映射表':            re.compile(r"^const COL\s*=", re.M),
    'SHEET 表名映射':          re.compile(r"^const SHEET\s*=|sheetNameByPlatform\s*=", re.M),
    'detectPlatform 实现':     re.compile(r"function detectPlatform\s*\(", re.M),
    'detectDishShape 守卫':    re.compile(r"function detectDishShape\s*\(", re.M),
    'DISH_C_COLS 白名单':      re.compile(r"^const DISH_C_COLS\s*=", re.M),
    '平台枚举(gradeGate)':     re.compile(r"enum:\s*\[[^\]]*'taobao'[^\]]*\]"),
    '前端平台选项':            re.compile(r"^const IMPORT_PLATFORM_OPTIONS\s*=", re.M),
    '按平台分支(if platform)': re.compile(r"if\s*\(\s*platform\s*===\s*'(taobao|meituan)'"),
}

def walk(root, dirs):
    for d in dirs:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dp, dn, fn in os.walk(base):
            dn[:] = [x for x in dn if x not in ('node_modules', '.git')]
            for f in fn:
                if f.endswith(EXTS):
                    yield os.path.join(dp, f)

def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')

rows = []
for p in walk(ROOT, SCAN_DIRS):
    try:
        src = io.open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    hit = []
    for name, rx in SIGS.items():
        if rx.search(src):
            hit.append(name)
    if hit:
        rows.append((rel(p), hit, 'cx_' in os.path.basename(p) or '/cx_' in rel(p)))

print('=== A 平台耦合点（只列真含分派逻辑的文件）===')
noncopy = [r for r in rows if not r[2]]
copies = [r for r in rows if r[2]]
for f, hit, _ in sorted(noncopy):
    print('  ' + f)
    for h in hit:
        print('      · ' + h)
print('  ── 派生副本（sync_common 自动生成，改源后必跑同步）: %d 处' % len(copies))
for f, hit, _ in sorted(copies)[:8]:
    print('      · ' + f)
if len(copies) > 8:
    print('      · ... 其余 %d 处' % (len(copies) - 8))

print('\n=== B 平台名枚举出现处 ===')
NAMES = re.compile(r"'(taobao|meituan|eleme|pos|other)'")
for p in walk(ROOT, SCAN_DIRS):
    r = rel(p)
    if 'cx_' in os.path.basename(p):
        continue
    try:
        src = io.open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    found = set(NAMES.findall(src))
    if found:
        print('  %-62s %s' % (r, ','.join(sorted(found))))

print('\n=== C 结论计数 ===')
print('  必须改动的非副本文件数: %d' % len(noncopy))
print('  自动派生副本数（跑 sync_common 即可）: %d' % len(copies))
