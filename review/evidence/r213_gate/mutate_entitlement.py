# -*- coding: utf-8 -*-
"""R213-C 变异回灌：证明权益链路守卫的四类判据都有分辨力。"""
import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
GUARD = 'tools/check_entitlement_flow.js'
ADMIN = 'cloudfunctions/adminQueryUser/index.js'
SCC = 'cloudfunctions/saveCostCard/index.js'
QSVC = 'cloudfunctions/checkQuota/service.js'
ENT = 'cloudfunctions/common/entitlement.js'


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
        raise SystemExit('anchor hit %d (expect 1) in %s :: %r' % (n, rel, old[:50]))
    wr(rel, t.replace(old, new))


CASES = []


def case(tag, desc, target):
    def deco(fn):
        CASES.append((tag, desc, target, fn))
        return fn
    return deco


@case('MC1', '把 adminQueryUser 的 tier 判定改回手写比较（第二源复现）', 'E-C③b')
def _mc1():
    sub1(ADMIN,
         "      tier: isPaid(expireAt) ? 'paid' : 'free',",
         "      tier: expireAt > Date.now() ? 'paid' : 'free',")


@case('MC2', 'saveCostCard 删掉免费额度写侧拦截（只靠前端拦）', 'E-C②')
def _mc2():
    sub1(SCC,
         "      return fail(ERROR_CODES.FREE_LIMIT_EXCEEDED); // 文案由前端 msgOf(code) 映射（禁硬编码中文）",
         "      return ok({ bypassed: true });")


@case('MC3', '放宽免费额度阈值（used > freeLimit + 1 ⇒ 免费用户多拿一张）', 'E-B③')
def _mc3():
    sub1(QSVC,
         "    hit_free_limit: used >= freeLimit,",
         "    hit_free_limit: used > freeLimit + 1,")


@case('MC4', 'isPaid 边界由严格大于改成大于等于（到期时刻仍算付费）', 'E-A⑨')
def _mc4():
    sub1(ENT,
         "  return Number(expireAt || 0) > (now == null ? nowUtc() : now);",
         "  return Number(expireAt || 0) >= (now == null ? nowUtc() : now);")


def main():
    files = [ADMIN, SCC, QSVC, ENT]
    backup = {f: rd(f) for f in files}
    base = {f: md5(f) for f in files}
    rc0, out0 = run_guard()
    m = re.search(r'结果：(\d+ 通过 / \d+ 失败)', out0)
    print('基线：rc=%d  %s' % (rc0, m.group(1) if m else '?'))
    if rc0 != 0:
        print('基线非绿，中止'); return 1

    results = []
    for tag, desc, target, fn in CASES:
        fn()
        try:
            rc, out = run_guard()
            reds = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
            hit = ('❌ ' + target) in out
            results.append((tag, desc, target, rc, hit, reds[:2]))
        finally:
            for f in files:
                wr(f, backup[f])

    md5ok = all(md5(f) == base[f] for f in files)
    print('\n%-5s %-46s %-7s %-4s %-5s %s' % ('编号', '变异', '目标', 'RC', '点名', '首条红'))
    for tag, desc, target, rc, hit, reds in results:
        print('%-5s %-46s %-7s %-4s %-5s %s' % (tag, desc, target, rc, '命中' if hit else '未中',
                                                (reds[0][:56] if reds else '')))
    print('\n全条点名命中 = %s ；还原后 md5 全等 = %s' % (all(r[4] for r in results), md5ok))
    ok = all(r[3] != 0 and r[4] for r in results) and md5ok
    print('变异结论：%s' % ('✅ 4/4 有效红（且都红在目标断言上）' if ok else '❌ 有无效/未点名变异'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
