# -*- coding: utf-8 -*-
"""R298 · B2 套件登记同步（六处 + CASES 第 7 处）
纪律：两阶段（先全量校验每锚点命中==1，全通过才统一落盘）；
     行尾守恒：write 时按原文件风格还原（verify_all.js/api.js 是 LF，重启键是 CRLF）。
"""
import io, os, sys, subprocess

def find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        p = os.path.dirname(d)
        if p == d:
            raise RuntimeError('未找到仓根')
        d = p

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)

VA = 'verify_all.js'
RK = 'specs/dev-specs/★知识存储点_2026-09-10.md'
AC = 'tools/check_suite_assert_counts.js'

# ============ 1) verify_all.js ============
# 1-a 头注套件数
va_anchor_count = '// 串联：173 个套件'
va_new_count = '// 串联：174 个套件'

# 1-b 头注清单追加 R298 条目（插在「⚠️ 另有两处在重启键」之前）
va_anchor_head = '// ⚠️ 另有两处在重启键 specs/dev-specs/★知识存储点_2026-09-10.md'
va_head_add = NL.join([
 '//       + 金额精度守卫（tools/check_money_precision.js，R298：「元 → 分」是**唯一必须做浮点乘法的边界**',
 '//         （× 100），而单源 `common/money.js::yuanToFen` 写了、sync 进 51 个云函数包，**业务代码一处都没用**',
 '//         —— 16 处各自裸写 `Math.round(元 * 100)`。裸写在 IEEE754 下半步（真值恰为 x.xx5）会**静默少进 1 分**：',
 '//         三位小数全域 18 万点错 1147 点、成本引擎 qty×(净料万分之元) 600 万组合错 3528 处，方向恒为偏小。',
 '//         ⚠️ 免责面：两位小数（老板日常输入形态）穷举 100 万点原本就 0 错 —— 不是"金额体系全错"。',
 '//         判据 = S 扫描面 + A 行为穷举 + B 前后端双副本等价（合法域逐点 / 差异精确落在非法域）',
 '//         + C 形态（全仓元乘 100 必须十进制安全；三副本同源）+ D 正负样本互证 + 断言数下界）',
]) + NL

# 1-c SUITES 末尾追加
va_anchor_suites = "  ['m2-entry-parity', 'tools/check_m2_entry_parity.js'],"
va_suites_add = NL.join([
 '',
 '  // ===== R298 金额精度守卫（「元 → 分」十进制安全）=====',
 '  //   见头部注释同名条目。根因：`Math.round(元 * 100)` 在 IEEE754 下半步会静默少进 1 分。',
 '  //   判据 = S 扫描面 + A 行为穷举 + B 前后端双副本等价 + C 形态 + D 正负样本互证。',
 "  ['money-precision', 'tools/check_money_precision.js'],",
])

# ============ 2) 重启键 ============
rk_anchor_11 = '（仓库根；串 **173** 个套件（R297 新增「建店年限默认值」'
rk_new_11 = ('（仓库根；串 **174** 个套件（R298 新增「金额精度」`tools/check_money_precision.js`：'
             '「元 → 分」十进制安全 + 前后端双副本等价；R297 新增「建店年限默认值」')

rk_anchor_drift = '（现 **173**；'
rk_new_drift = '（现 **174**；'

rk_anchor_tail = '→ **169（R296：新增 `check-page-card-width` 套件 `tools/check_page_card_width.js`'
# 演进链尾部追加（在「套件数会漂」行的**行末**追加，故另取该行 id 锚点）
rk_evolve_add = (' → **174（R298：新增 `money-precision` 套件 `tools/check_money_precision.js` —— '
                 '「元 → 分」是唯一必须做浮点乘法的边界，而全仓 16 处各自裸写、单源 `common/money.js::yuanToFen` '
                 '**零消费者**；x.xx5 半步静默少进 1 分，三位小数全域 18 万点错 1147 点、'
                 '成本引擎路径 600 万组合错 3528 处）**')

# 断言数声明行（第 6 处）
rk_anchor_assert = '`check_page_card_width`=3（**七十六者**均 ≡ 实跑'
rk_new_assert = '`check_page_card_width`=3 / `check_money_precision`=18（**七十七者**均 ≡ 实跑'

# ============ 3) check_suite_assert_counts.js ============
ac_anchor = "  { key: 'check_page_card_width', rel: 'tools/check_page_card_width.js' },"
ac_new = ac_anchor + NL + "  { key: 'check_money_precision', rel: 'tools/check_money_precision.js' },"

JOBS = [
    (VA, [(va_anchor_count, va_new_count),
          (va_anchor_head, va_head_add + va_anchor_head),
          (va_anchor_suites, va_anchor_suites + va_suites_add)]),
    (RK, [(rk_anchor_11, rk_new_11),
          (rk_anchor_drift, rk_new_drift),
          (rk_anchor_assert, rk_new_assert)]),
    (AC, [(ac_anchor, ac_new)]),
]

print('=' * 80)
print('阶段 1：全量校验')
print('=' * 80)
plan = {}
ok_all = True
for rel, subs in JOBS:
    raw = open(os.path.join(ROOT, rel), 'rb').read()
    crlf = raw.count(b'\r\n')
    eol = '\r\n' if crlf > 0 else '\n'
    s = raw.decode('utf-8')
    for old, new in subs:
        n = s.count(old)
        print('%-46s 锚点命中=%-3d  %s' % (rel, n, ('OK' if n == 1 else 'FAIL') + '  ' + old[:64]))
        if n != 1:
            ok_all = False
            continue
        s = s.replace(old, new, 1)
    # 行尾守恒
    out = s.encode('utf-8')
    n_lf = out.count(b'\n')
    n_cr = out.count(b'\r')
    style_ok = (n_cr == n_lf) if eol == '\r\n' else (n_cr == 0)
    print('%-46s eol=%-4s 换行=%d CR=%d 风格一致=%s' % ('', repr(eol), n_lf, n_cr, style_ok))
    if not style_ok:
        ok_all = False
        continue
    plan[rel] = out
    print()

if not ok_all or len(plan) != len(JOBS):
    print('校验未全通过，一个文件都不写')
    sys.exit(1)
print('全部校验通过')

# 演进链追加（在「套件数会漂」行行末）—— 单独处理
rk_path = os.path.join(ROOT, RK)
s = plan[RK].decode('utf-8')
i = s.find('（现 **174**；')
assert i > 0, '找不到会漂行'
b = s.find('\r\n', i)
assert b > 0, '找不到行尾'
s = s[:b] + rk_evolve_add + s[b:]
plan[RK] = s.encode('utf-8')
print('已在「套件数会漂」行末追加演进链')

print()
print('=' * 80)
print('阶段 2：统一落盘')
print('=' * 80)
for rel, data in plan.items():
    open(os.path.join(ROOT, rel), 'wb').write(data)
    print('  已写 %-46s %d 字节' % (rel, len(data)))
