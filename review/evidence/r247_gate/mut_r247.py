# -*- coding: utf-8 -*-
# R247 变异回灌：证明 tools/check_picker_platform.js 的判据有分辨力
# 铁律：每条独立（每条前 reset_to_base）· 锚点命中必须 == 1 · 还原用字节 · 判据点名到目标断言号
import subprocess
import re
import sys

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
RUNNER = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
GUARD = ROOT + '/tools/check_picker_platform.js'

TARGETS = {
    'page':  ROOT + '/pages/takeaway/index.js',
    'terms': ROOT + '/miniprogram/i18n/terms.js',
    'svc':   ROOT + '/cloudfunctions/importSalesBill/service.js',
    'guard': GUARD,
}
BASE = {}
EOL = {}


def read(p):
    raw = open(p, 'rb').read()
    EOL[p] = '\r\n' if b'\r\n' in raw else '\n'
    return raw.decode('utf-8').replace('\r\n', '\n')


def write(p, s):
    data = s.replace('\n', EOL.get(p, '\n')).encode('utf-8')   # 坑 2-c / 坑 15：先 encode 再 wb
    open(p, 'wb').write(data)


def backup():
    for k, p in TARGETS.items():
        BASE[k] = open(p, 'rb').read()


def reset_to_base():
    for k, p in TARGETS.items():
        open(p, 'wb').write(BASE[k])


def run():
    r = subprocess.run([RUNNER, GUARD], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    failed = [l for l in out.splitlines() if l.strip().startswith('❌')]
    crashed = (r.returncode != 0) and not re.search(r'\d+ 通过 / \d+ 失败', out)
    return failed, crashed, out


def mutate(key, old, new):
    p = TARGETS[key]
    s = read(p)
    n = s.count(old)
    if n != 1:
        raise RuntimeError('锚点命中 %d 次（须恰为 1）: %s' % (n, old[:70]))
    write(p, s.replace(old, new))


# (名字, 文件key, 原文, 变异文, 期望断言号, 期望组)
MUTATIONS = [
    ('M1 picker 加 enum 外的值 ghost', 'page',
     "['meituan', 'eleme', 'taobao', 'jd_sku', 'other']",
     "['meituan', 'eleme', 'taobao', 'jd_sku', 'other', 'ghost']", 'A-①', 'A'),
    ('M2 picker 混入堂食平台 pos', 'page',
     "['meituan', 'eleme', 'taobao', 'jd_sku', 'other']",
     "['meituan', 'eleme', 'taobao', 'jd_sku', 'other', 'pos']", 'B-①', 'A'),
    ('M3 terms 删掉 eleme 键（label 回落机器值）', 'terms',
     "eleme: '饿了么', ", "", 'A-②', 'A'),
    ('M4 云端 enum 新增 douyin（picker 与排除名单都不动）', 'svc',
     "enum: ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'pos', 'other']",
     "enum: ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'pos', 'other', 'douyin']", 'B-②', 'A'),
    ('M5 守卫排除名单删掉 jd_order（制造无归属成员）', 'guard',
     "const PICKER_EXCLUDED = ['pos', 'jd_order'];",
     "const PICKER_EXCLUDED = ['pos'];", 'B-②', 'A'),
    ('M6 守卫排除名单塞进 enum 外的 ghost', 'guard',
     "const PICKER_EXCLUDED = ['pos', 'jd_order'];",
     "const PICKER_EXCLUDED = ['pos', 'jd_order', 'ghost'];", 'B-③', 'A'),
    ('M7 守卫 S-② 下界改大（4→99）', 'guard',
     '!!picker && picker.length >= 4',
     '!!picker && picker.length >= 99', 'S-②', 'A'),
    ('B1 picker 顺序调换（等价改写，不该红）', 'page',
     "['meituan', 'eleme', 'taobao', 'jd_sku', 'other']",
     "['meituan', 'taobao', 'eleme', 'jd_sku', 'other']", 'A-①', 'B'),
    ('B2 术语显示名改写（只改值不改键，不该红）', 'terms',
     "eleme: '饿了么',",
     "eleme: '饿了么外卖',", 'A-②', 'B'),
]


def main():
    backup()
    try:
        f, c, _ = run()
        if f or c:
            print('基线不绿，先修')
            return 1
        print('基线绿（%d 断言）' % 15)
        miss = []
        for name, key, old, new, expect, group in MUTATIONS:
            reset_to_base()
            try:
                mutate(key, old, new)
            except RuntimeError as e:
                print('SKIP %-46s %s' % (name, e))
                miss.append(name)
                continue
            failed, crashed, out = run()
            hit = any(expect in l for l in failed)
            if group == 'A':
                ok = hit
                verdict = '抓到' if hit else ('漏网/红错位置' if failed else '漏网')
            else:
                ok = (not failed) and (not crashed)
                verdict = '如期保持绿' if ok else '假红'
            print('%-46s ❌=%d%s  %s' % (name, len(failed),
                                         ' (崩溃)' if crashed else '', verdict))
            if failed and group == 'A' and not hit:
                print('        实际红行:', [l.strip()[:60] for l in failed][:4])
            if not ok:
                miss.append(name)
        reset_to_base()
        af, ac, _ = run()
        print('还原后 ❌=%d / 崩溃=%s' % (len(af), ac))
        ok = (not miss) and (not af) and (not ac)
        print('回灌结论：%s（%d 条，漏网/失败 %d）' % ('全部如期' if ok else '有问题', len(MUTATIONS), len(miss)))
        if miss:
            print('未达标:', miss)
        return 0 if ok else 1
    finally:
        reset_to_base()


sys.exit(main())
