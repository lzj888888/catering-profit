# -*- coding: utf-8 -*-
# R194b：把 manageShop 自测挂进 SUITES（126 -> 127），并同步六处中的四处。
# 起因：R67（check_selftest_shape）/ S5（check_suite_coverage）双向差集判红 ——
#   树内每个 selftest.js 必须挂 SUITES，否则整文件静默不跑。
import os
import sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
errors = []
plan = {}


def load(rel):
    with open(os.path.join(ROOT, rel), 'rb') as f:
        return f.read().decode('utf-8')


def process(rel, ops):
    s = load(rel)
    nl = '\r\n' if '\r\n' in s else '\n'
    for op in ops:
        if op[0] == 'rep':
            _, anchor, new = op
            new = new.replace('\n', nl)
            c = s.count(anchor)
            if c != 1:
                errors.append('[%s] rep 命中 %d 次（期望 1）: %r' % (rel, c, anchor[:70]))
                return
            s = s.replace(anchor, new)
        elif op[0] == 'append_line':
            _, marker, suffix = op
            lines = s.split(nl)
            idxs = [i for i, l in enumerate(lines) if marker in l]
            if len(idxs) != 1:
                errors.append('[%s] append_line 命中 %d 行（期望 1）: %r' % (rel, len(idxs), marker[:70]))
                return
            i = idxs[0]
            lines[i] = lines[i].rstrip() + suffix
            s = nl.join(lines)
    plan[rel] = s


VA = 'verify_all.js'
process(VA, [
    ('rep', '// 串联：126 个套件', '// 串联：127 个套件'),
    ('rep', "  ['auth-guard-shape', 'tools/check_auth_guard_shape.js'],",
            "  ['auth-guard-shape', 'tools/check_auth_guard_shape.js'],\n"
            "  // R194：manageShop 云函数自测（店铺增 / 改名 / 删除三 op）—— R67（check_selftest_shape）\n"
            "  //   与 check_suite_coverage 的 S5 做「树内 selftest.js ↔ SUITES」双向差集，漏挂即判红（整文件静默不跑）。\n"
            "  ['manageShop 自测', 'cloudfunctions/manageShop/selftest.js'],"),
])

RST = 'specs/dev-specs/★知识存储点_2026-09-10.md'
process(RST, [
    ('rep', '串 **126** 个套件', '串 **127** 个套件'),
    ('append_line', '串 **127** 个套件',
     ' ⚠️ R194 再增第 127 个套件 `manageShop 自测`（`cloudfunctions/manageShop/selftest.js`）。'),
    ('rep', '（现 **126**；', '（现 **127**；'),
    ('append_line', '（现 **127**；',
     ' → **127（round194：挂入 `cloudfunctions/manageShop/selftest.js` 自测 —— R67/suite-coverage 要求树内每个 `selftest.js` 必须挂 SUITES，否则该文件整份静默不跑而其余套件仍全绿）**'),
])

if errors:
    print('FAIL 校验未通过，一个文件都没写：')
    for e in errors:
        print('  ' + e)
    sys.exit(1)

for rel, s in plan.items():
    with open(os.path.join(ROOT, rel), 'wb') as f:
        f.write(s.encode('utf-8'))
    print('OK 已写入 ' + rel)
print('DONE')
