# -*- coding: utf-8 -*-
"""R213-B 变异回灌：证明 L6-②（穷尽分类）真能抓到"扫不到就恒绿"的各类缺陷。"""
import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
GUARD = 'tools/check_paywall_coverage.js'


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


CASES = []


def case(tag, desc, target):
    def deco(fn):
        CASES.append((tag, desc, target, fn))
        return fn
    return deco


@case('MB1', '删掉 m3_combo 的落点登记 ⇒ 无同名目录又未登记', 'L6-②b')
def _mb1():
    t = rd(GUARD)
    old = ("  { key: 'm3_combo', at: 'cloudfunctions/saveCostCard/index.js',\n"
           "    why: '套餐是 saveCostCard 的 card_type===3 分支（无独立云函数目录），墙接在该分支上（见 L6-① 实调用点）。' },\n")
    assert t.count(old) == 1
    wr(GUARD, t.replace(old, ''))


@case('MB2', '落点指向一个不含该能力 hasFeature 的文件（豁免表掩盖漏接）', 'L6-②c')
def _mb2():
    t = rd(GUARD)
    assert t.count("at: 'cloudfunctions/saveCostCard/index.js'") == 1
    wr(GUARD, t.replace("at: 'cloudfunctions/saveCostCard/index.js'",
                        "at: 'cloudfunctions/saveAsset/index.js'"))


@case('MB3', '登记表塞入陈旧键（能力已不在 PAID_FEATURES）', 'L6-②d')
def _mb3():
    t = rd(GUARD)
    anchor = "const WALL_ANCHORS = [\n"
    assert t.count(anchor) == 1
    wr(GUARD, t.replace(anchor, anchor + "  { key: 'm3_legacy', at: null, why: '陈旧条目，能力早已下线（变异样本）。' },\n"))


def main():
    backup = rd(GUARD)
    base = md5(GUARD)
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
            wr(GUARD, backup)

    md5ok = md5(GUARD) == base
    print('\n%-5s %-44s %-8s %-4s %-5s %s' % ('编号', '变异', '目标', 'RC', '点名', '首条红'))
    for tag, desc, target, rc, hit, reds in results:
        print('%-5s %-44s %-8s %-4s %-5s %s' % (tag, desc, target, rc, '命中' if hit else '未中',
                                                (reds[0][:58] if reds else '')))
    print('\n全条点名命中 = %s ；还原后 md5 全等 = %s' % (all(r[4] for r in results), md5ok))
    ok = all(r[3] != 0 and r[4] for r in results) and md5ok
    print('变异结论：%s' % ('✅ 3/3 有效红（且都红在目标断言上）' if ok else '❌ 有无效/未点名变异'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
