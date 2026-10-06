# -*- coding: utf-8 -*-
"""
mutate_r230.py —— R230 变异回灌：证明 tools/check_biz_preset.js（13 断言）不是假绿。

铁律落实：
  · 纯内存备份（不落 .mutbak 磁盘临时文件 ⇒ 不触本机 safe-delete-bulk-guard）
  · 每条变异独立（reset 后注入）· 末尾整文件还原 + 字节比对
  · 判据 = 「有 ❌ 行」或「崩溃(无汇总行)」**且**点名到目标断言号（坑 6/11/13）
  · 组 A（该红 6 条）+ 组 B（等价改写，期望绿 2 条）+ 探边界（1 条）
运行：python mutate_r230.py
"""
import subprocess, re, sys, os

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
GUARD = 'tools/check_biz_preset.js'

TARGETS = {
    'bp':   os.path.join(ROOT, 'utils', 'bizPreset.js'),
    'wxml': os.path.join(ROOT, 'pages', 'sandbox', 'index.wxml'),
    'page': os.path.join(ROOT, 'pages', 'sandbox', 'list.js'),
}
BASE = {}


def read(p):
    with open(p, 'rb') as f:
        return f.read().decode('utf-8')


def write(p, s):
    data = s.encode('utf-8')          # 坑 2-c：先 encode 再写
    with open(p, 'wb') as f:
        f.write(data)


def backup():
    for k, p in TARGETS.items():
        BASE[k] = open(p, 'rb').read()


def reset():
    for k, p in TARGETS.items():
        with open(p, 'wb') as f:
            f.write(BASE[k])


def run():
    r = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith('\u274c')]
    crashed = (r.returncode != 0) and not re.search(r'\d+ \u901a\u8fc7 / \d+ \u5931\u8d25', out)
    return fails, crashed, out


def sub1(key, pattern, repl):
    src = read(TARGETS[key])
    new, n = re.subn(pattern, repl, src, count=1)
    if n != 1:
        raise RuntimeError('anchor hit %d (need exactly 1): %s' % (n, pattern[:70]))
    write(TARGETS[key], new)


# (名字, 目标, 原正则, 变异文本, 期望点名断言号, 组别)
MUTATIONS = [
    ('M1 bizKey 越界第5类', 'bp', r"bizKey: 'dining'", "bizKey: 'foobar'", 'A-\u2461', 'A'),
    ('M2 fixed 项缺 defaultYuan', 'bp',
     r"\{ itemKey: 'labor', form: 'fixed', defaultYuan: 25000, src: 'P' \}",
     "{ itemKey: 'labor', form: 'fixed', src: 'P' }", 'C-\u2461', 'A'),
    ('M3 L1/L2 区插坪效输入框', 'wxml',
     r'id="l1l2"', 'id="l1l2"\n<input value="{{pixelEffYuan}}" />\n', 'D-\u2460', 'A'),
    ('M4 pages 里复算 cash 算式', 'page',
     r'\A', 'const _mutCash = build_total_fen / (target_profit_fen + build_amort_monthly_fen);\n',
     'E-\u2462', 'A'),
    ('M5 CITY_COEF 丢 labor 键', 'bp',
     r'tier1:  \{ rent: 1\.20, labor: 1\.15 \},', 'tier1:  { rent: 1.20 },', 'S-\u2463', 'A'),
    ('M6 预设引用别的预设', 'bp',
     r"params: \{ grossMarginPct: \{ v: 55, src: 'P' \}, laborUnitYuan: \{ v: 4500, src: 'S' \},",
     "inheritFrom: 'dining_sichuan', params: { grossMarginPct: { v: 55, src: 'P' }, laborUnitYuan: { v: 4500, src: 'S' },",
     'B-\u2460', 'A'),
    ('M7 paybackCash 加号改减号', 'bp',
     r'const denom = Number\(targetProfitFen\) \+ \(Number\(buildAmortMonthlyFen\) \|\| 0\);',
     'const denom = Number(targetProfitFen) - (Number(buildAmortMonthlyFen) || 0);',
     'E-\u2461', 'A'),
    ('M8(B) src P→D1 等价', 'bp',
     r"avgPriceYuan: \{ v: 12, src: 'P' \}", "avgPriceYuan: { v: 12, src: 'D1' }", None, 'B'),
    ('M9(B) !=null 等价改写', 'bp',
     r'\} else if \(m\.defaultYuan != null\) \{',
     '} else if (m.defaultYuan !== null && m.defaultYuan !== undefined) {', None, 'B'),
    ('M10(探) CITY_COEF 数值与生产源不符', 'bp',
     r'tier1:  \{ rent: 1\.20, labor: 1\.15 \},', 'tier1:  { rent: 1.25, labor: 1.15 },', None, 'P'),
]


def main():
    backup()
    try:
        f, c, _ = run()
        if f or c:
            print('基线不绿，先修：', f[:5], 'crashed=', c)
            return 1
        print('基线绿（0 失败）=> 开始回灌\n')
        missed, results = [], []
        for name, key, pat, repl, expect, grp in MUTATIONS:
            reset()
            try:
                sub1(key, pat, repl)
            except RuntimeError as e:
                print('SKIP  %-38s %s' % (name, e))
                missed.append(name)
                continue
            fails, crashed, out = run()
            hitname = any(expect in l for l in fails) if expect else None
            if grp == 'A':
                ok = (bool(fails) or crashed) and hitname
                verdict = '\u2705\u6293\u5230' if ok else ('\u274c\u6f0f\u7f51' if not hitname else '\u274c\u65e0\u7ea2')
            elif grp == 'B':
                ok = (not fails) and (not crashed)
                verdict = '\u2705\u4fdd\u7eff' if ok else '\u274c\u5047\u7ea2'
            else:
                ok = True
                verdict = ('\u6709\u5b88\u536b\uff08\u7ea2\uff09' if (fails or crashed) else '\U0001f50d\u65e0\u5b88\u536b\uff08\u63a2\u5230\u7f3a\u53e3\uff09')
            print('%-40s \u274c=%d%s  %s%s' % (name, len(fails),
                  ' (\u5d29\u6e83)' if crashed else '', verdict,
                  ('  [\u547d\u4e2d ' + expect + ']' if hitname else '')))
            if grp == 'A' and not ok:
                missed.append(name)
            results.append((name, grp, len(fails), crashed, hitname, verdict))
        reset()
        af, ac, _ = run()
        same = all(open(p, 'rb').read() == BASE[k] for k, p in TARGETS.items())
        print('\n\u8fd8\u539f\u540e \u274c=%d crash=%s \u5b57\u8282\u4e00\u81f4=%s' % (len(af), ac, same))
        print('\u6f0f\u7f51=\u7ec4A %d \u6761 / \u5171 %d \u6761\u53d8\u5f02' % (len(missed), len(MUTATIONS)))
        if missed:
            print('\u6f0f\u7f51\u6e05\u5355\uff1a', missed)
        return 0 if (not missed and not af and not ac and same) else 1
    finally:
        reset()


sys.exit(main())
