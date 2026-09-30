# -*- coding: utf-8 -*-
"""M3.20 变异回灌：证明 selftest_m3_lexicon 不是假绿。
判据 = 硬：不但要 rc!=0，还必须红在「目标断言名」上（崩溃红 ≠ 有效红）。
每条变异独立、可还原；还原后 md5 必须与基线逐字节相等。
"""
import io, os, subprocess, hashlib, re, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
LEX = os.path.join(ROOT, 'utils', 'materialLexicon.js')
TPL = os.path.join(ROOT, 'utils', 'dishTemplates.js')
BAK = os.path.join(ROOT, 'review', 'evidence', 'r181g_m320_accept', '_bak')
NODE = 'node'
os.makedirs(BAK, exist_ok=True)


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


base = {LEX: rd(LEX), TPL: rd(TPL)}
base_md5 = {p: md5(p) for p in base}
for p in base:
    wr(os.path.join(BAK, os.path.basename(p)), base[p])
print('基线 md5:')
for p in base:
    print('  ', os.path.basename(p), base_md5[p])


def run():
    r = subprocess.run([NODE, 'tools/selftest_m3_lexicon.js'], cwd=ROOT,
                       capture_output=True, text=True, errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    return r.returncode, out


rc0, out0 = run()
print('\n基线实跑: rc=%d | %s' % (rc0, (out0.strip().splitlines() or [''])[-1]))
assert rc0 == 0, '基线必须是绿的，否则变异无意义'


def mut(name, path, old, new, expect_ids):
    """做一次变异，跑守卫，判据 = 红在 expect_ids 上。"""
    src = rd(path)
    if src.count(old) != 1:
        print('\n[SKIP] %s: 锚点命中 %d 次（期望 1）' % (name, src.count(old)))
        return None
    wr(path, src.replace(old, new))
    rc, out = run()
    fails = re.findall(r'❌\s+([A-Za-z0-9\-\.①②③④⑤⑥⑦]+)', out)
    hit = [f for f in fails if any(f.startswith(e) for e in expect_ids)]
    verdict = (rc != 0) and bool(hit)
    print('\n[%s] rc=%d' % (name, rc))
    print('   全部红断言 =', fails)
    print('   命中目标   =', hit)
    print('   判定       =', '✅ 有效红（红在目标断言上）' if verdict else '❌ 无效（崩溃红 / 没红在目标）')
    wr(path, src)          # 还原
    assert md5(path) == base_md5[path], '还原后 md5 不一致！'
    return verdict


results = {}

# M1：词库条目混入价格键 ⇒ 应红 L-a「每条键集合恰好 4 键」
results['M1 词库混价格键'] = mut(
    'M1', LEX,
    "  { std_key: 'potato', std_name: '土豆', aliases: ['马铃薯', '洋芋'], default_unit: '斤' },",
    "  { std_key: 'potato', std_name: '土豆', aliases: ['马铃薯', '洋芋'], default_unit: '斤', price: 3 },",
    ['L-a'])

# M2：模板行混入价格键 ⇒ 应红 L-f「全表无价格类键」
m2_old = None
tpl = rd(TPL)
mm = re.search(r"(\{\s*line_name:\s*'[^']+',\s*qty:\s*[\d.]+,\s*unit:\s*'[^']+'\s*\})", tpl)
if mm:
    m2_old = mm.group(1)
    m2_new = m2_old[:-1] + ", price: 0 }"
    results['M2 模板行混价格键'] = mut('M2', TPL, m2_old, m2_new, ['L-f'])
else:
    print('\n[SKIP] M2: 未匹配到模板行样本')

# M3：词库导出自动替换函数 ⇒ 应红 L-d「导出名无 auto/replace 前缀」
results['M3 导出自动替换'] = mut(
    'M3', LEX,
    'module.exports = { LEXICON, suggestByName, getByKey };',
    'module.exports = { LEXICON, suggestByName, getByKey, autoReplaceName };',
    ['L-d'])

# M4：词库规模缩到 3 条 ⇒ 应红 L-a 规模下界 + L-b 必含 8 条
lex = rd(LEX)
m = re.search(r'const LEXICON = \[(.*?)\n\];', lex, re.S)
if m:
    body = m.group(1)
    lines = [l for l in body.split('\n') if l.strip().startswith('{')]
    if len(lines) >= 5:
        keep = lines[:3]
        newbody = '\n'.join(keep)
        results['M4 词库缩到3条'] = mut(
            'M4', LEX, 'const LEXICON = [' + body + '\n];',
            'const LEXICON = [' + newbody + '\n];', ['L-a', 'L-b'])
    else:
        print('\n[SKIP] M4: 条目行不足')
else:
    print('\n[SKIP] M4: 未匹配 LEXICON 数组')

# ---------- 最终还原校验 ----------
print('\n===== 最终还原校验 =====')
allok = True
for p in base:
    cur = md5(p)
    same = (cur == base_md5[p])
    allok &= same
    print('  %s  md5 %s  %s' % (os.path.basename(p), cur, '✅ 与基线一致' if same else '❌ 漂移'))
rc9, out9 = run()
print('  还原后实跑 rc=%d | %s' % (rc9, (out9.strip().splitlines() or [''])[-1]))
allok &= (rc9 == 0)

print('\n===== 变异回灌汇总 =====')
for k, v in results.items():
    print('  %-22s %s' % (k, '✅' if v else ('❌' if v is False else 'SKIP')))
print('\nALL_RESTORED =', allok, '| 有效红 =', sum(1 for v in results.values() if v), '/', len(results))
