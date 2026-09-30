# -*- coding: utf-8 -*-
"""R181j 批次 E 变异回灌（mutation backfill）。

目的：证明两个新守卫（selftest_m3_impact / selftest_m3_recon）**真的能抓到错**，不是假绿。
硬判据（R181i 立的规矩）：
  - 只红 RC **不算数**；必须红在**目标断言名**上（即输出里出现 `❌ <含关键词的断言名>`）。
  - 崩溃红（SyntaxError 等）不算有效红；变异自身写错会崩。
  - 每条变异**独立**：改前备份、改后立刻还原、逐条校验 md5 与原文件一致。
"""
import io, os, sys, json, hashlib, subprocess

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
RECON = ROOT + 'utils/reconDerive.js'
SYNC = ROOT + 'cloudfunctions/syncCostCard/index.js'
SUITE_RECON = ROOT + 'tools/selftest_m3_recon.js'
SUITE_IMPACT = ROOT + 'tools/selftest_m3_impact.js'


def load(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def save(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def md5(p):
    with io.open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def run(suite):
    env = dict(os.environ)
    env['PATH'] = 'C:/Windows/System32;C:/Windows;' + os.path.dirname(NODE)
    r = subprocess.run([NODE, suite], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    return (r.returncode, (r.stdout or '') + (r.stderr or ''))


# (id, 文件, old, new, 目标套件, 期望红的断言关键词, 说明)
MUTS = [
    ('M1', RECON, u"  if (priceFen === 0) return { pct: null, reason: 'no_price' };   // 🔴 不许除零、不许返回 0",
     u"  if (priceFen === 0) return { pct: 0, reason: '' };",
     SUITE_RECON, ['price_fen 全 0', '空卡数组'], u'无价改成返回 0（破「不许返回 0」口径）'),

    ('M2', RECON, u"    if (!includeCombo && c.card_type === 3) return false;   // 套餐默认排除",
     u"    if (!includeCombo && c.card_type === 99) return false;",
     SUITE_RECON, ['套餐默认排除'], u'不再排除套餐（同菜被计两次）'),

    ('M3', RECON, u"  else if (Number(coverage) < 0.6) reason = 'coverage_low';",
     u"  else if (Number(coverage) < 0.1) reason = 'coverage_low';",
     SUITE_RECON, ['覆盖率 3/12', '抑制生效'], u'覆盖率闸门阈值 0.6 → 0.1（闸门失效）'),

    # ⚠️ 技能 §10-6：把它写成**同值**（'商品总价'）是「变异太弱」—— 语义仍满足单源断言 ⇒ 不会红，
    #    必须用**不等值**变体才能真正检验「断言单源」这条判据。
    ('M4', RECON, u"const GOODS_FIELD = (TERMS.ledger && TERMS.ledger.takeawayMode && TERMS.ledger.takeawayMode.goodsField) || '商品总价';",
     u"const GOODS_FIELD = '商品总价X';",
     SUITE_RECON, ['细项名取自单源', '菜品口径收入'], u'细项名脱离单源（写死不等值字面量）'),

    ('M5', RECON, u"        if ((si && si.sub_item) === GOODS_FIELD) takeawayGoodsFen += Number(si && si.amount_fen) || 0;",
     u"        takeawayGoodsFen += Number(si && si.amount_fen) || 0;",
     SUITE_RECON, ['菜品口径收入'], u'sub_items 不按细项名过滤（打包费被计入商品总价）'),

    ('M6', SYNC, u"        below_band: !noPrice && newResult.gross_margin_pct < bandFloor,",
     u"        below_band: newResult.gross_margin_pct < bandFloor,",
     SUITE_IMPACT, ['below_band 形如'], u'回退成裸比较（未定价卡会误报跌破参考带）'),

    ('M7', SYNC, u"        new_gross_margin_pct: noPrice ? null : newResult.gross_margin_pct,",
     u"        new_gross_margin_pct: noPrice ? 0 : newResult.gross_margin_pct,",
     SUITE_IMPACT, ['new_gross_margin_pct 形如'], u'无价回 0 而不是 null（与 reconDerive 口径不一致）'),

    ('M8', SYNC, u"    const allRes = await da.listAll('shop_cost_card', { shop_id: shopId });",
     u"    await da.insert('shop_cost_card', { shop_id: shopId, dry_run_probe: true });\n"
     u"    const allRes = await da.listAll('shop_cost_card', { shop_id: shopId });",
     SUITE_IMPACT, ['零写库'], u'dry-run 分支里塞一个写库（破「只读预览」红线）'),
]


def red_on(text, keys):
    for line in text.split('\n'):
        if line.startswith(u'\u274c'):
            if any(k in line for k in keys):
                return line.strip()
    return None


print(u'== 基线 md5 ==')
base = {RECON: md5(RECON), SYNC: md5(SYNC)}
for p, v in base.items():
    print(u'  %-46s %s' % (p.split('/')[-1], v))

results = []
all_ok = True
for mid, path, old, new, suite, keys, desc in MUTS:
    print(u'\n== %s · %s ==' % (mid, desc))
    src = load(path)
    n = src.count(old)
    if n != 1:
        print(u'  !! 变异自身写错：锚点命中 %d 次（应 1）—— 该条作废' % n)
        results.append({'id': mid, 'valid_red': False, 'note': u'锚点未命中 1 次（%d）' % n})
        all_ok = False
        continue
    save(path, src.replace(old, new))
    try:
        rc, out = run(suite)
        hit = red_on(out, keys)
        crash = ('SyntaxError' in out) or ('ReferenceError' in out) or ('TypeError' in out and rc not in (0, 1))
        valid = (rc != 0) and (hit is not None) and (not crash)
        print(u'  rc=%d  crash=%s  红在目标断言=%s' % (rc, crash, (u'是' if hit else u'否')))
        if hit:
            print(u'    -> %s' % hit[:110])
        else:
            fails = [l.strip() for l in out.split('\n') if l.startswith(u'\u274c')][:3]
            print(u'    非目标红行：%s' % (u' | '.join(fails)[:160] if fails else u'（无 ❌ 行）'))
        results.append({'id': mid, 'rc': rc, 'valid_red': bool(valid), 'hit': hit or '', 'crash': bool(crash)})
        if not valid:
            all_ok = False
    finally:
        save(path, src)
    m = md5(path)
    okb = (m == base[path])
    print(u'  还原 md5 %s %s' % (u'✅' if okb else u'❌', m))
    if not okb:
        all_ok = False

print(u'\n== 汇总 ==')
n_valid = sum(1 for r in results if r.get('valid_red'))
print(u'  有效红 %d / %d' % (n_valid, len(MUTS)))
for r in results:
    print(u'  %-4s %s%s' % (r['id'], u'✅ 有效红' if r.get('valid_red') else u'❌ 无效',
                            (u'  · ' + r['hit'][:70]) if r.get('hit') else ''))
final = {RECON: md5(RECON), SYNC: md5(SYNC)}
print(u'\n== 终态 md5（必须与基线全等）==')
for p, v in final.items():
    print(u'  %-46s %s %s' % (p.split('/')[-1], v, u'✅' if v == base[p] else u'❌'))

with io.open(ROOT + 'review/evidence/r181j_m319_m321_feed/mut_181j_result.json', 'w', encoding='utf-8') as f:
    json.dump({'results': results, 'n_valid': n_valid, 'total': len(MUTS),
               'base_md5': base, 'final_md5': final, 'restored': final == base},
              f, ensure_ascii=False, indent=2)
print(u'\nDONE  全部有效=%s  工作树已还原=%s' % (all_ok, final == base))
sys.exit(0 if all_ok else 1)
