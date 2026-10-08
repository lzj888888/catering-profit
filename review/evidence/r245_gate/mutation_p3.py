# -*- coding: utf-8 -*-
"""R245 · P7/P8 变异回灌（改生产源码，逐条独立、跑完必还原、md5 校验）。

判据：**必须红在目标断言名上**（崩溃红 ≠ 有效红）。

M6  删掉「商品名」别名            ⇒ 美团真表判不出形态 C（5-② / R-C5-③）
M7  normalizeDate 去掉紧凑 8 位分支 ⇒ 20260910 归不了月（R-C6-① / R-C5-⑤）
M8  「销售额」别名接错列（订单交易额前置）⇒ Σ 变整单口径（R-C5-④）
M9  前端 gradeGate 枚举去 jd_*      ⇒ 三副本漂移复现（selftest_bill_parse「逐值同序」+ A-②）
M10 别名归一误伤形态 A/B（has 也走归一）⇒ 形态 A 判不出（1-⑤）
"""
import hashlib
import os
import subprocess

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
SVC = os.path.join(REPO, 'cloudfunctions', 'importSalesBill', 'service.js')
GG = os.path.join(REPO, 'utils', 'gradeGate.js')

SUITES = {
    'shape': 'tools/check_formc_shape.js',
    'parse': 'tools/check_formc_parse.js',
    'bill': 'tools/selftest_bill_parse.js',
    'dual': 'tools/check_grade_gate_dual.js',
}

files = {p: open(p, encoding='utf-8').read() for p in (SVC, GG)}
md5o = {p: hashlib.md5(v.encode('utf-8')).hexdigest() for p, v in files.items()}


def run(rel):
    r = subprocess.run([NODE, rel], cwd=REPO, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    fails = [ln.strip() for ln in (r.stdout or '').splitlines() if '❌' in ln]
    return r.returncode, fails


# (name, file, old, new, suite_key, 目标断言名片段)
MUTS = [
    ('M6 删掉「商品名」别名', SVC,
     "  商品名称: ['商品名称', '商品名', '菜品名称'],",
     "  商品名称: ['商品名称', '菜品名称'],", 'shape', '5-②'),
    ('M6b 删掉「商品名」别名（解析侧）', SVC,
     "  商品名称: ['商品名称', '商品名', '菜品名称'],",
     "  商品名称: ['商品名称', '菜品名称'],", 'parse', 'R-C5-③'),
    ('M7 normalizeDate 去掉紧凑 8 位', SVC,
     "  if (!m) m = s.match(/^(\\d{4})(\\d{2})(\\d{2})(?:\\D|$)/);   // 紧凑 8 位（后跟非数字或直接结束 ⇒ 7 位/9 位不认）\n",
     "", 'parse', 'R-C6-①'),
    ('M8 「销售额」别名接错列（订单交易额前置）', SVC,
     "  销售额: ['销售额', '商品销售额'],",
     "  销售额: ['订单交易额', '销售额', '商品销售额'],", 'parse', 'R-C5-④'),
    ('M9 前端 gradeGate 枚举去 jd_*', GG,
     "enum: ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'pos', 'other'] },",
     "enum: ['taobao', 'meituan', 'eleme', 'pos', 'other'] },", 'bill', '逐值同序'),
    ('M9b 前端 gradeGate 枚举去 jd_*（双副本侧）', GG,
     "enum: ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'pos', 'other'] },",
     "enum: ['taobao', 'meituan', 'eleme', 'pos', 'other'] },", 'dual', 'A-②'),
    ('M10 别名归一误伤形态 A/B（has 也走归一）', SVC,
     "  const has = (c) => hdr.indexOf(c) >= 0;      // A/B 判据：原样列名",
     "  const has = (c) => hdrC.indexOf(c) >= 0;     // 🔴 变异：A/B 判据也走归一（菜品名称→商品名称 ⇒ A 判不出）",
     'shape', '1-⑤'),
]

try:
    for k, rel in SUITES.items():
        rc, f = run(rel)
        print('[基线 %s] rc=%s FAIL=%d' % (k, rc, len(f)))
    for name, path, old, new, skey, expect in MUTS:
        cur = files[path]
        mut = cur.replace(old, new)
        if mut == cur:
            print('[%s] ⚠️ 变异点未命中，跳过' % name)
            continue
        open(path, 'w', encoding='utf-8').write(mut)
        rc, f = run(SUITES[skey])
        hit = any(expect in x for x in f)
        print('[%s] rc=%s FAIL=%d → 红在「%s」? %s' % (name, rc, len(f), expect, hit))
        for x in f[:4]:
            print('      ', x)
        open(path, 'w', encoding='utf-8').write(cur)
finally:
    for p in (SVC, GG):
        open(p, 'w', encoding='utf-8').write(files[p])
    ok = all(md5o[p] == hashlib.md5(open(p, encoding='utf-8').read().encode('utf-8')).hexdigest()
             for p in (SVC, GG))
    print('[还原] md5 全部一致? %s' % ok)
    for k, rel in SUITES.items():
        rc, f = run(rel)
        print('[还原后 %s] rc=%s FAIL=%d' % (k, rc, len(f)))
