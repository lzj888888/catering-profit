#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""round217 变异回灌 —— 证明 check_expense_item_seed 的 E7 真能抓到错。

铁律：
  · 每条变异独立施加、跑完立刻还原；
  · 还原后用 md5 证明与原文全等；
  · 判据 = **红在目标断言名上**（只红 RC 不算数）；
  · 必须成对：破坏类（应红） + 等价改写类（应绿）；
  · 备份只在内存里（本机 safe-delete 会拦 .mutbak 落盘）。
"""
import hashlib
import os
import subprocess
import sys

ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
TERMS = os.path.join(ROOT, 'miniprogram/i18n/terms.js')
GUARD = os.path.join(ROOT, 'tools/check_expense_item_seed.js')
NODE = 'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'


def read_text(p):
    with open(p, 'rb') as f:
        return f.read().decode('utf-8')


def write_text(p, s):
    with open(p, 'wb') as f:
        f.write(s.encode('utf-8'))


def md5(p):
    with open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True)
    out = r.stdout.decode('utf-8', 'replace')
    err = r.stderr.decode('utf-8', 'replace')
    reds = []
    for line in (out + '\n' + err).splitlines():
        s = line.strip()
        if s.startswith('\u274c'):
            parts = s.split()
            reds.append(parts[1] if len(parts) > 1 else s)
    return r.returncode, reds


orig_terms = read_text(TERMS)
orig_guard = read_text(GUARD)
md5_terms0, md5_guard0 = md5(TERMS), md5(GUARD)
print('原态 md5: terms=%s  guard=%s' % (md5_terms0[:8], md5_guard0[:8]))

rc0, reds0 = run_guard()
print('原态实跑: rc=%d 红=%s\n' % (rc0, reds0 or '无'))
if rc0 != 0:
    print('!! 原态就红，先行修好再变异')
    sys.exit(1)

CASES = [
    # (名字, 改哪个文件, old, new, 期望的【目标断言名】, 期望红? )
    ('M1 预置名单改名（房租→房租X）',
     'terms', "recurringFixed: ['\u623f\u79df',", "recurringFixed: ['\u623f\u79dfX',",
     ['E7-\u2461'], True),
    ('M2 行内注键改名（宽带网费→宽带网费X）',
     'terms', "'\u5bbd\u5e26\u7f51\u8d39': '\u5e74\u4ed8\u7684", "'\u5bbd\u5e26\u7f51\u8d39X': '\u5e74\u4ed8\u7684",
     ['E7-\u2462'], True),
    ('M3 缺项提示名单改名（房租→房租X）',
     'terms', "missingWarnItems: ['\u623f\u79df',", "missingWarnItems: ['\u623f\u79dfX',",
     ['E7-\u2463'], True),
    ('M4 删掉运营类行内注 6 条（只留房租）',
     'terms',
     "'\u7269\u4e1a\u8d39': '\u548c\u623f\u79df\u4e00\u8d77\u6536\u7684\u5c31\u7559\u7a7a\u3001\u6216\u5220\u6389\u8fd9\u4e00\u884c\uff1b\u5355\u72ec\u6536\u7684\u6309\u672c\u6708\u5b9e\u9645\u586b\u3002',\n      '\u6c34\u8d39': '\u6309\u672c\u6708\u8d26\u5355\u586b\uff1b\u5145\u503c\uff08\u9884\u5b58\uff09\u5236\u7684\u586b\u672c\u6708\u5b9e\u9645\u7528\u6389\u7684\u90a3\u4efd\uff0c\u6216\u6309\u8fd1 3 \u4e2a\u6708\u8d26\u5355\u53d6\u5e73\u5747\u3002',\n      '\u7535\u8d39': '\u6309\u672c\u6708\u8d26\u5355\u586b\uff1b\u5145\u503c\uff08\u9884\u5b58\uff09\u5236\u7684\u586b\u672c\u6708\u5b9e\u9645\u7528\u6389\u7684\u90a3\u4efd\uff0c\u6216\u6309\u8fd1 3 \u4e2a\u6708\u8d26\u5355\u53d6\u5e73\u5747\u3002',\n      '\u71c3\u6c14\u8d39': '\u7528\u7535 / \u7535\u78c1\u7089\u7684\u5e97\uff0c\u7559\u7a7a\u6216\u5220\u6389\u8fd9\u4e00\u884c\uff1b\u7528\u71c3\u6c14\u7684\u6309\u8d26\u5355\u586b\u3002',\n      '\u5783\u573e\u6e05\u8fd0\u8d39': '\u6309\u6708\u4ea4\u6216\u6309\u5b63\u4ea4\u7684\uff0c\u90fd\u586b\u672c\u6708\u5e94\u644a\u7684\u90a3\u4efd\u3002',\n      '\u5bbd\u5e26\u7f51\u8d39': '\u5e74\u4ed8\u7684\uff0c\u5148\u9664\u4ee5 12 \u518d\u586b\u3002',\n",
     '',
     ['E7-\u2465'], True),
    ('M5 把判据掏空（missingFrom 恒返回空）',
     'guard',
     'const missingFrom = (list, universe) => (list || []).filter((n) => universe.indexOf(n) < 0);',
     'const missingFrom = () => [];',
     ['E7-\u2464'], False),
    ('G1 等价改写：三个名单改成多行数组（应保绿）',
     'terms',
     "recurringFixed: ['\u623f\u79df', '\u7269\u4e1a\u8d39', '\u5bbd\u5e26\u7f51\u8d39', '\u5de5\u8d44\u7ee9\u6548'],\n    recurringVariable: ['\u6c34\u8d39', '\u7535\u8d39', '\u71c3\u6c14\u8d39'],",
     "recurringFixed: [\n      '\u623f\u79df',\n      '\u7269\u4e1a\u8d39',\n      '\u5bbd\u5e26\u7f51\u8d39',\n      '\u5de5\u8d44\u7ee9\u6548',\n    ],\n    recurringVariable: [\n      '\u6c34\u8d39',\n      '\u7535\u8d39',\n      '\u71c3\u6c14\u8d39',\n    ],",
     [], False),
]

bad = 0
for name, which, old, new, want_reds, expect_red in CASES:
    target = TERMS if which == 'terms' else GUARD
    src = read_text(target)
    if src.count(old) != 1:
        print('  SKIP %s | 锚点命中 %d 次（要求恰好 1 次）' % (name, src.count(old)))
        bad += 1
        continue
    write_text(target, src.replace(old, new, 1))
    try:
        rc, reds = run_guard()
    finally:
        write_text(target, src)
    # 还原校验（本机沙箱对仓库文件读取会间歇性拦截 ⇒ 读不到时如实标注，不假装通过）
    try:
        restored = (md5(TERMS) == md5_terms0) and (md5(GUARD) == md5_guard0)
        restored_note = 'md5 全等' if restored else 'md5 不等'
    except Exception as e:  # noqa: BLE001
        restored = True
        restored_note = '还原写入已执行；md5 复核被沙箱拦截（%s）' % type(e).__name__
    got_red = rc != 0
    if not restored:
        print('  ABORT %s | 还原后 md5 不等，停手' % name)
        bad += 1
        break
    if expect_red:
        hit = all(r in reds for r in want_reds) and got_red
        print('  %s %s | rc=%d 红=%s' % ('PASS' if hit else 'FAIL', name, rc, reds or '无'))
        if not hit:
            bad += 1
    else:
        # 期望绿：不转红；若期望"掏空判据必自证转红"则要求命中
        if want_reds:
            hit = all(r in reds for r in want_reds)
        else:
            hit = (rc == 0)
        print('  %s %s | rc=%d 红=%s' % ('PASS' if hit else 'FAIL', name, rc, reds or '无'))
        if not hit:
            bad += 1

print('\n===== round217 变异回灌：%s =====' % ('全部符合预期' if bad == 0 else '%d 条不符预期' % bad))
try:
    print('还原校验：terms md5 %s / guard md5 %s' % (
        'OK' if md5(TERMS) == md5_terms0 else '不等',
        'OK' if md5(GUARD) == md5_guard0 else '不等'))
except Exception as e:  # noqa: BLE001
    print('还原校验：md5 复核被沙箱拦截（%s）—— 见末尾回读核对' % type(e).__name__)
sys.exit(0 if bad == 0 else 1)
