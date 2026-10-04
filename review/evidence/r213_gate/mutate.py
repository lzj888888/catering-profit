# -*- coding: utf-8 -*-
"""R213 变异回灌：证明 A8 接线判据真能抓到错（逐条、独立、还原后 md5 全等）。

期望：每条变异都让 tools/check_rate_limit_params.js 转红，且**红在目标断言**上。
"""
import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
GUARD = 'tools/check_rate_limit_params.js'
SAVE = 'cloudfunctions/saveCostCard/index.js'
SYNC = 'cloudfunctions/syncCostCard/index.js'
CALC = 'cloudfunctions/calcBom/index.js'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), 'r', encoding='utf-8', newline='') as f:
        return f.read()


def wr(rel, text):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def md5(rel):
    with io.open(os.path.join(ROOT, rel), 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def run_guard():
    p = subprocess.run(['node', GUARD], cwd=ROOT, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=120)
    return p.returncode, p.stdout.decode('utf-8', 'replace')


def sub1(rel, old, new):
    t = rd(rel)
    n = t.count(old)
    if n != 1:
        raise SystemExit('anchor hit %d (expect 1) in %s' % (n, rel))
    wr(rel, t.replace(old, new))


# —— 变异定义：(编号, 说明, 目标断言, 施加函数)
CASES = []


def case(tag, desc, target):
    def deco(fn):
        CASES.append((tag, desc, target, fn))
        return fn
    return deco


@case('M1', '删掉 saveCostCard 的限流调用点（保留 limiter 定义）', 'A8-②')
def _m1():
    sub1(SAVE,
         "  const rl = await rateLimitCheck(userId);\n  if (rl.limited) return fail(rl.code);\n\n",
         "")


@case('M2', '把 limiter 挪进 main 体内建（=每次调用新桶，最隐蔽的假接线）', 'A8-③')
def _m2():
    sub1(SAVE,
         "const RATE_STORE = new Map();\nconst rateLimitCheck = common.rateLimit.makeRateLimiter(RATE_STORE);\n",
         "")
    sub1(SAVE,
         "  const shopId = event && event.shop_id;\n",
         "  const RATE_STORE = new Map();\n  const rateLimitCheck = common.rateLimit.makeRateLimiter(RATE_STORE);\n  const shopId = event && event.shop_id;\n")


@case('M3', 'syncCostCard 的拒绝分支失效（limited 后不 return fail）', 'A8-②')
def _m3():
    sub1(SYNC,
         "    if (rl.limited) return fail(rl.code);",
         "    if (rl.limited) return ok({ skipped: true });")


@case('M4', '给 calcBom 私自接限流却不登记（防漏记 / EXEMPT 滥用）', 'A8-④')
def _m4():
    sub1(CALC,
         "const { validateInput } = require('./validate');\n",
         "const { validateInput } = require('./validate');\nconst _rl = common.rateLimit.makeRateLimiter(new Map());\n")


def main():
    files = [SAVE, SYNC, CALC]
    backup = {f: rd(f) for f in files}     # 内存备份（字节级，含行尾符）
    base = {f: md5(f) for f in files}
    # 首跑基线（应全绿）
    rc0, out0 = run_guard()
    print('基线：rc=%d  %s' % (rc0, re.search(r'结果：(\d+ 通过 / \d+ 失败)', out0).group(1)))
    if rc0 != 0:
        print('基线非绿，中止'); return 1

    results = []
    for tag, desc, target, fn in CASES:
        fn()
        try:
            rc, out = run_guard()
            red_lines = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
            hit = ('❌ ' + target) in out
            results.append((tag, desc, target, rc, hit, red_lines[:3]))
        finally:
            for f in files:            # ⚠️ 内存备份写回，绝不用 git checkout（会连未提交的接线改动一起还原）
                wr(f, backup[f])

    md5ok = all(md5(f) == base[f] for f in files)
    print('\n%-4s %-46s %-6s %-4s %-6s %s' % ('编号', '变异', '目标', 'RC', '点名', '首条红'))
    for tag, desc, target, rc, hit, reds in results:
        print('%-4s %-46s %-6s %-4s %-6s %s' % (tag, desc, target, rc, '命中' if hit else '未中',
                                                (reds[0][:60] if reds else '')))
    print('\n全条点名命中 = %s ；还原后 md5 全等 = %s'
          % (all(r[4] for r in results), md5ok))
    ok = all(r[3] != 0 and r[4] for r in results) and md5ok
    print('变异结论：%s' % ('✅ 4/4 有效红（且都红在目标断言上）' if ok else '❌ 有无效/未点名变异'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
