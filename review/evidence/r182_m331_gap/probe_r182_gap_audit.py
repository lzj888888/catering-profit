# -*- coding: utf-8 -*-
"""probe_r182_gap_audit.py —— R182 缺口审计探针（只读，不写仓库任何文件）

用途：把「规范承诺的守卫 vs 仓库实况」与「M3.31 per100g 是否零代码」两条结论
      变成**可复现的机器输出**，而不是靠人眼找文件名。

运行：
  python probe_r182_gap_audit.py                # 默认指向本仓根
  python probe_r182_gap_audit.py <仓库根绝对路径>

判据（每条都打印实际值，便于复核）：
  A. 规范承诺的 9 个守卫文件名，实际存在几个
  B. 服务端 SPEC_PRESETS 的 spec_key 集合
  C. 前端两份 terms.specLabel 的键集 + 两份文件是否逐字节一致（md5）
  D. 全仓 .js 里 per100g / commission_base 的命中文件清单
  E. 规范承诺的守卫「等效落点」抽查（按内容找，不按文件名找）
"""
import io
import os
import re
import sys
import glob
import hashlib

R = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
R = os.path.abspath(R)

PASS = 'OK'
def hr(t):
    print('\n' + '=' * 22 + ' ' + t + ' ' + '=' * 22)

def read(rel):
    p = os.path.join(R, rel)
    if not os.path.exists(p):
        return None
    return io.open(p, encoding='utf-8', errors='ignore').read()

def alljs():
    out = []
    for dp, dn, fn in os.walk(R):
        if '.git' in dp.split(os.sep) or 'node_modules' in dp.split(os.sep):
            continue
        for f in fn:
            if f.endswith('.js'):
                out.append(os.path.join(dp, f))
    return out

print('repo =', R)

# ---------- A ----------
hr('A · 规范承诺的守卫文件名 vs 实际存在')
WANT = [
    ('R131', 'tools/check_m3_engine_parity.js'),
    ('R132', 'tools/check_spec_derive_identity.js'),
    ('R133', 'tools/check_takeaway_commission_base.js'),
    ('R134', 'tools/check_combo_no_nest.js'),
    ('R135', 'tools/check_m3_no_m1_write.js'),
    ('R138', 'tools/check_template_no_price.js'),
    ('R140', 'tools/check_material_category_enum.js'),
    ('R141', 'tools/check_spec_per100g_identity.js'),
    ('R142', 'tools/check_takeaway_subsidy_split.js'),
    ('R143', 'tools/check_commission_mode.js'),
]
exist = miss = 0
for rid, rel in WANT:
    ok = os.path.exists(os.path.join(R, rel))
    print('  %-5s %-52s %s' % (rid, rel, '存在' if ok else '不存在'))
    exist += 1 if ok else 0
    miss += 0 if ok else 1
print('  小结：承诺 %d 个文件名，实际同名存在 %d，同名缺失 %d（缺失≠零覆盖，见 E）' % (len(WANT), exist, miss))

# ---------- B ----------
hr('B · 服务端 SPEC_PRESETS 的 spec_key 集合')
sd = read('cloudfunctions/common/specDerive.js')
if sd is None:
    print('  !! 读不到 cloudfunctions/common/specDerive.js')
else:
    keys = re.findall(r"spec_key:\s*'([A-Za-z0-9_]+)'", sd)
    print('  SPEC_PRESETS spec_key =', sorted(set(keys)))
    print('  是否含 per100g =', 'per100g' in keys)

# ---------- C ----------
hr('C · 前端 terms.specLabel 键集 + 双副本一致性')
duo = ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']
mds = {}
for rel in duo:
    t = read(rel)
    if t is None:
        print('  %-38s (文件不存在)' % rel)
        continue
    m = re.search(r'specLabel:\s*\{([^}]*)\}', t)
    print('  %-38s specLabel = { %s }' % (rel, m.group(1).strip() if m else '(未找到)'))
    b = io.open(os.path.join(R, rel), 'rb').read()
    mds[rel] = hashlib.md5(b).hexdigest()
    print('  %-38s md5 = %s  (%d B)' % ('', mds[rel], len(b)))
if len(mds) == 2:
    print('  双副本一致 =', len(set(mds.values())) == 1)

# ---------- D ----------
hr('D · 全仓 .js 里 per100g / commission_base 的命中文件')
for token in ['per100g', 'commission_base']:
    hits = []
    for p in alljs():
        t = io.open(p, encoding='utf-8', errors='ignore').read()
        if token in t:
            hits.append(os.path.relpath(p, R).replace(os.sep, '/'))
    print('  %-16s 命中 %d 个 .js 文件%s' % (token, len(hits), ('：' + ', '.join(hits[:8])) if hits else '（全仓零命中）'))

# ---------- E ----------
hr('E · 承诺守卫的「等效落点」抽查（按内容找，不按文件名找）')
PROBES = [
    ('R133 佣金基数不含打包费', 'tools/selftest_m3_takeaway.js', '基数不含打包费'),
    ('R134 套餐不得嵌套', 'tools/selftest_m3_combo.js', 'COMBO_NEST_NOT_ALLOWED'),
    ('R138 模板不得含价格', 'tools/selftest_m3_lexicon.js', '全表无价格类键'),
    ('R140 原料分类枚举（L4）', 'tools/check_dish_category_free.js', 'R140'),
    ('R142 补贴承担方 fail-closed', 'tools/selftest_m3_takeaway.js', '承担方'),
    ('R143 fixed 不叠加保底', 'tools/selftest_m3_takeaway.js', 'commission_fixed_fen'),
    ('R135 云函数层（应缺）', 'tools/', 'shop_monthly_account'),
]
for label, rel, needle in PROBES:
    p = os.path.join(R, rel)
    if os.path.isdir(p):
        found = []
        for f in os.listdir(p):
            if f.endswith('.js'):
                t = io.open(os.path.join(p, f), encoding='utf-8', errors='ignore').read()
                if needle in t:
                    found.append(f)
        print('  %-28s 在 %s 下命中：%s' % (label, rel, found if found else '（无）'))
    else:
        t = read(rel) or ''
        print('  %-28s %s 命中「%s」= %s' % (label, rel, needle, needle in t))

hr('完')
