# -*- coding: utf-8 -*-
"""M3.20 变异回灌（第二轮）：修正 M1/M3 锚点，并加测「简写导出」形式的漏判风险。
判据 = 硬：rc!=0 且红在目标断言名上（崩溃红 ≠ 有效红）。
"""
import io, os, subprocess, hashlib, re

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
LEX = os.path.join(ROOT, 'utils', 'materialLexicon.js')
NODE = 'node'


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


base = rd(LEX)
base_md5 = md5(LEX)


def run():
    r = subprocess.run([NODE, 'tools/selftest_m3_lexicon.js'], cwd=ROOT,
                       capture_output=True, text=True, errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


rc0, out0 = run()
print('基线 rc=%d | %s\n' % (rc0, out0.strip().splitlines()[-1]))


def mut(name, old, new, expect_ids, note=''):
    src = rd(LEX)
    if src.count(old) != 1:
        print('[SKIP] %s: 锚点命中 %d 次（期望 1）' % (name, src.count(old)))
        return None
    wr(LEX, src.replace(old, new))
    rc, out = run()
    fails = re.findall(r'❌\s+([A-Za-z0-9\-\.①②③④⑤⑥⑦]+)', out)
    hit = [f for f in fails if any(f.startswith(e) for e in expect_ids)]
    crashed = (rc != 0) and (not fails)
    verdict = (rc != 0) and bool(hit)
    print('[%s] rc=%d' % (name, rc))
    if crashed:
        tail = (out.strip().splitlines() or [''])[-1][:150]
        print('    ⚠️ 崩溃红（无 ❌ 行），末行 =', tail)
    print('   红断言 =', fails, '| 命中目标 =', hit)
    print('   判定   =', '✅ 有效红' if verdict else ('⚠️ 崩溃红（变异本身让源码崩了）' if crashed else '❌ 漏判'))
    if note:
        print('   备注   =', note)
    wr(LEX, src)
    assert md5(LEX) == base_md5, '还原失败'
    print('   还原 md5 ✅\n')
    return 'PASS' if verdict else ('CRASH' if crashed else 'MISS')


res = {}

# M1-bis：词库条目混入价格键（锚点用真实行，3 个别名）
res['M1 词库条目混价格键'] = mut(
    'M1', "  { std_key: 'potato', std_name: '土豆', aliases: ['马铃薯', '洋芋', '山药蛋'], default_unit: '斤' },",
    "  { std_key: 'potato', std_name: '土豆', aliases: ['马铃薯', '洋芋', '山药蛋'], default_unit: '斤', price: 3 },",
    ['L-a'])

# M3-bis：导出带冒号的自动替换函数（不崩溃）
res['M3 导出 autoReplace(带冒号)'] = mut(
    'M3', 'module.exports = { LEXICON, suggestByName, getByKey };',
    'module.exports = { LEXICON, suggestByName, getByKey, autoReplace: suggestByName };',
    ['L-d'])

# M5：导出用**简写**形式（先定义函数再简写）⇒ 检验 L-d 是否漏判
res['M5 导出 autoReplace(简写)'] = mut(
    'M5', 'module.exports = { LEXICON, suggestByName, getByKey };',
    'function autoReplace() { return null; }\nmodule.exports = { LEXICON, suggestByName, getByKey, autoReplace };',
    ['L-d'], note='简写属性不带冒号，L-d 正则要求 [:] —— 预期可能漏判')

# M6：源码里塞 setData ⇒ 应红 L-d 第三条
res['M6 源码塞 setData'] = mut(
    'M6', 'module.exports = { LEXICON, suggestByName, getByKey };',
    '// this.setData({})\nmodule.exports = { LEXICON, suggestByName, getByKey };',
    ['L-d'])

print('===== 汇总 =====')
for k, v in res.items():
    print('  %-26s %s' % (k, {'PASS': '✅ 有效红', 'MISS': '❌ 漏判', 'CRASH': '⚠️ 崩溃红'}.get(v, 'SKIP')))
print('\n最终 md5 一致 =', md5(LEX) == base_md5)  # noqa
rc9, out9 = run()
print('还原后实跑 rc=%d | %s' % (rc9, out9.strip().splitlines()[-1]))
