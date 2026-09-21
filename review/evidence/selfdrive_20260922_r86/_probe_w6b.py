# -*- coding: utf-8 -*-
"""W6b / W4b 定点复验：区分「变异打偏」与「真缺口」"""
import subprocess, shutil, os

SRC = 'utils/takeaway.js'
BAK = 'review/evidence/selfdrive_20260922_r86/_takeaway.bak.js'
shutil.copy2(SRC, BAK)

JS_MUT = "(s, r) => s + Number(r && r.subsidy), 0);"
JS_ORG = "(s, r) => s + (Number(r && r.subsidy) || 0), 0);"

PROBE = """
const t = require('./utils/takeaway.js');
const a = t.subsidyTotal([{subsidy:'10'},{subsidy:'20.5'},{subsidy:''},{subsidy:'5'}]);
const b = t.subsidyTotal([{subsidy:'10'},{subsidy:'abc'}]);
console.log('sampleAsInSelftest=' + a + ' ; nonNumericInput=' + b);
"""


def run(js):
    p = subprocess.run(['node', '-e', js], capture_output=True, encoding='utf-8', errors='replace')
    return (p.stdout or '') + (p.stderr or '').strip()


def patch(old, new):
    d = open(SRC, encoding='utf-8').read()
    assert d.count(old) == 1, 'anchor miss'
    open(SRC, 'w', encoding='utf-8', newline='').write(d.replace(old, new, 1))


print('== W6b：原实现 ==')
print(run(PROBE))
patch(JS_ORG, JS_MUT)
print('== W6b：去掉 ||0 兜底后 ==')
print(run(PROBE))
shutil.copy2(BAK, SRC)
print('== 已还原 ==')
print(run(PROBE))
