# -*- coding: utf-8 -*-
"""R264 变异回灌：证明 ⑫ 段（覆盖率 / 建卡预填 / 卡不够不给批量按钮）不是假绿。
铁律：每条变异独立（先 reset 到基线）、锚点命中数必须 == 1、点名到目标断言编号、
二进制读写防 CRLF 污染（本机硬坑）、纯内存备份（不落 .mutbak 磁盘临时文件）。
"""
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
GUARD = 'tools/check_dishreview_engine.js'

TARGETS = {
    'js': os.path.join(ROOT, 'pages', 'm3', 'dishreview', 'index.js'),
    'wxml': os.path.join(ROOT, 'pages', 'm3', 'dishreview', 'index.wxml'),
    'edit': os.path.join(ROOT, 'pages', 'card', 'edit.js'),
}

BASE = {}


def rd(p):
    with io.open(p, 'rb') as f:
        return f.read().decode('utf-8')


def wr(p, s):
    data = s.encode('utf-8')          # 先 encode 再写，防写入即截断
    with io.open(p, 'wb') as f:
        f.write(data)


def backup():
    for k, p in TARGETS.items():
        with io.open(p, 'rb') as f:
            BASE[k] = f.read()


def reset():
    for k, p in TARGETS.items():
        with io.open(p, 'wb') as f:
            f.write(BASE[k])


def run():
    r = subprocess.run([NODE, GUARD], capture_output=True, cwd=ROOT)
    out = (r.stdout or b'').decode('utf-8', 'replace') + (r.stderr or b'').decode('utf-8', 'replace')
    failed = [l for l in out.splitlines() if l.strip().startswith('❌')]
    crashed = (r.returncode != 0) and not re.search(r'\d+ 通过 / \d+ 失败', out)
    return failed, crashed, out


def sub1(key, pattern, repl):
    p = TARGETS[key]
    src = rd(p)
    new, n = re.subn(pattern, repl, src, count=1)
    if n != 1:
        raise RuntimeError('锚点命中 %d 次（须恰为 1）: %s' % (n, pattern[:70]))
    wr(p, new)


# (名字, [(key, pattern, repl), ...], 期望点名的断言号, 组A应红/组B应绿)
MUTATIONS = [
    ('A1 覆盖率改按行数算（0 元 SKU 稀释分母）',
     [('js', r'const coveragePct = allFen > 0 \? Math\.round\(\(rankedFen \* 100\) / allFen\) : 0;',
       'const coveragePct = coverageCount > 0 ? Math.round(((coverageCount - coverageMatched) * 100) / coverageCount) : 0;')],
     '12-③', True),
    ('A2 跳转不编码菜名（空格/加号被截断）',
     [('js', r"\?card_code=&dish_name=' \+ encodeURIComponent\(nm\)", "?card_code=&dish_name=' + nm")],
     '12-⑦', True),
    ('A3 预填覆盖编辑态（改名还以为没改）',
     [('edit', r"if \(prefillName && !\(\(q && q\.card_code\) \|\| ''\)\.length\)", 'if (prefillName)')],
     '12-⑨', True),
    ('A4 批量入口去掉卡数约束（卡不够也能批量）',
     [('wxml', r'wx:if="\{\{cardOptions\.length && shortCardGap <= 0\}\}"', 'wx:if="{{cardOptions.length}}"')],
     '12-⑪', True),
    ('A5 道数不去重（同菜按平台数重）',
     [('js', r'const coverageCount = dishNames\.size;', 'const coverageCount = dineIn.length + unmatched.length;'),
      ('js', r'const coverageMatched = dishNames\.size - new Set\(unmatched\.map\(\(x\) => x\.name\)\)\.size;',
       'const coverageMatched = dineIn.length;')],
     '12-④', True),
    ('A6 建卡页不解码（%E9%BB%84 原样进框）',
     [('edit', r"decodeURIComponent\(q\.dish_name\)", "q.dish_name")],
     '12-⑧', True),
    ('B1 等价改写：encodeURIComponent(String(nm))',
     [('js', r'encodeURIComponent\(nm\)', 'encodeURIComponent(String(nm))')],
     '12-⑦', False),
    ('B2 等价改写：new Set([]) 初始化',
     [('js', r'const dishNames = new Set\(\);', 'const dishNames = new Set([]);')],
     '12-④', False),
]


def main():
    backup()
    miss = []
    try:
        f, c, _ = run()
        if f or c:
            print('基线不绿（❌=%d crash=%s），先修基线' % (len(f), c))
            return 1
        print('基线：绿')
        for name, subs, expect, want_red in MUTATIONS:
            reset()
            try:
                for key, pat, rep in subs:
                    sub1(key, pat, rep)
            except RuntimeError as e:
                print('SKIP %s —— %s' % (name, e))
                miss.append(name)
                continue
            failed, crashed, _ = run()
            hit = any(expect in l for l in failed)
            if want_red:
                ok = hit                      # 组 A：必须点名到目标断言
            else:
                ok = (not hit) and (not failed) and (not crashed)   # 组 B：不得红
            print('%-42s ❌=%d 点名%s=%s  %s' % (
                name, len(failed), expect, hit,
                ('✅抓到' if ok else ('❌漏网' if want_red else '❌假红'))))
            if not ok:
                miss.append(name)
        reset()
        af, ac, out = run()
        tail = [l for l in out.splitlines() if '通过 /' in l]
        print('还原后 ❌=%d crash=%s | %s' % (len(af), ac, tail[-1].strip() if tail else ''))
        ok = (not miss) and (not af) and (not ac)
        print('结论：%s（变异 %d 条，异常 %d 条）' % ('全部通过' if ok else '有异常', len(MUTATIONS), len(miss)))
        return 0 if ok else 1
    finally:
        reset()


sys.exit(main())
