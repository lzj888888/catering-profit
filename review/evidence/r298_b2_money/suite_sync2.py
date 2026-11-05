# -*- coding: utf-8 -*-
"""R298 · B2 收口（#449）：断言数声明 18 → 30 同步（四处）
纪律：两阶段（先全量校验每锚点命中==1 且替换文本尚不存在，全通过才统一落盘）；
     行尾守恒（verify_all.js/check_suite_assert_counts.js 为 LF，重启键为 CRLF）。
附带修正：上一轮 suite_sync.py 把 check_page_card_width 的注释误挂到 money_precision 行尾 ⇒ 归位。
"""
import io, os, sys

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

r = chr(0x2460)   # ①
a1 = chr(0x2461)  # ②
a2 = chr(0x2462)  # ③

CARD_NOTE = ('  // 3 条（R296c 立 / R296d 拆雷反转：A-' + r + ' 全局 app.wxss 必须零精确类名 `.card`'
             '（否则任何页面复用即继承 width:48% ⇒ 卡片半宽 ⇒ 标签逐字断行成竖排）+ A-' + a1 +
             ' 页面用了 `class="card"` 就得自己声明 width + A-' + a2 + ' 负样本互证不误伤 .card2/.card-title/.mcard）')

# ---- AC：归位卡片宽度注释 + 给 money_precision 正确注释 ----
AC_OLD_CARD = "  { key: 'check_page_card_width', rel: 'tools/check_page_card_width.js' }," + NL
AC_NEW_CARD = "  { key: 'check_page_card_width', rel: 'tools/check_page_card_width.js' }," + CARD_NOTE + NL

AC_OLD_MONEY = ("  { key: 'check_money_precision', rel: 'tools/check_money_precision.js' }," + CARD_NOTE)
AC_NEW_MONEY = NL.join([
 '  // R298 金额精度：「元 → 分」十进制安全（x.xx5 半步静默少进 1 分）+ 前后端双副本等价。',
 '  //   S 扫描面 6（S-' + chr(0x2464) + ' 三形态桶 IDENT/PAREN/LITERAL 穷尽对账 —— 防"只扫命名像分的标识符"',
 '  //   而漏 LITERAL 字面量与 PAREN 括号两种形态）+ A 行为穷举 4 + B 双副本等价 2',
 '  //   + C 登记清单 fail-closed 10（未登记/登记失效/守恒/kind 合法/money 必安全/money 下界防批量改标/',
 '  //     四类非空/理由非空/单源含 toFixed(10)/三副本同源）+ D 正负样本互证 8（D-' + chr(0x2464) + '~D-' + chr(0x2466) + ' 对账分辨力 + 断言数下界）。',
 "  { key: 'check_money_precision', rel: 'tools/check_money_precision.js' },  // 30 条",
])

# ---- VA：头注 16 处→19 处 + 判据行改为登记清单口径 ----
VA_OLD_16 = '—— 16 处各自裸写 `Math.round(元 * 100)`。'
VA_NEW_16 = '—— 19 处各自裸写 `Math.round(元 * 100)`。'

VA_OLD_JUDGE = '//         + C 形态（全仓元乘 100 必须十进制安全；三副本同源）+ D 正负样本互证 + 断言数下界）'
VA_NEW_JUDGE = NL.join([
 '//         + C **登记清单 fail-closed**（全仓 78 处 `* 100` 按 IDENT/PAREN/LITERAL 三形态桶穷尽对账，',
 '//           逐点具名登记 kind + 语义理由；未登记 / 登记失效 / 计数不符一律判红；money 必十进制安全、',
 '//           带 money 下界防"批量改标成 ratio 绕过"）+ D 正负样本互证 + 断言数下界）',
 '//         🔴 观测覆盖率（立此判据的根因）：旧判据只认**命名像"分"**的标识符 ⇒ 面内 77 处仅见 17 处',
 '//            （22.1%），`promoFen`/`packTotal` 之外的 `c.sum`、`)](`、`448 * 100` 三种书写形态全在盲区；',
 '//            升级为登记清单后 78/78 全登记 —— 覆盖面由**语义**决定而非命名习惯。',
])

# ---- RK：断言数声明 18→30 ----
RK_OLD_N = '`check_money_precision`=18（**七十七者**均 ≡ 实跑'
RK_NEW_N = '`check_money_precision`=30（**七十七者**均 ≡ 实跑'

# ---- RK：演进链 16 处→19 处 ----
RK_OLD_16 = '而全仓 16 处各自裸写、单源 '
RK_NEW_16 = '而全仓 19 处各自裸写、单源 '

JOBS = [
    (AC, [(AC_OLD_CARD, AC_NEW_CARD), (AC_OLD_MONEY, AC_NEW_MONEY)]),
    (VA, [(VA_OLD_16, VA_NEW_16), (VA_OLD_JUDGE, VA_NEW_JUDGE)]),
    (RK, [(RK_OLD_N, RK_NEW_N), (RK_OLD_16, RK_NEW_16)]),
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
        pre = s.count(new)
        good = (n == 1 and pre == 0)
        print('%-42s 命中=%-2d 目标已存在=%-2d %s  %s' % (
            rel, n, pre, ('OK' if good else 'FAIL'), old[:56].replace(NL, ' ')))
        if not good:
            ok_all = False
            continue
        s = s.replace(old, new, 1)
    out = s.encode('utf-8')
    n_lf = out.count(b'\n'); n_cr = out.count(b'\r')
    style_ok = (n_cr == n_lf) if eol == '\r\n' else (n_cr == 0)
    print('%-42s eol=%-4s 换行=%d CR=%d 风格一致=%s' % ('', repr(eol), n_lf, n_cr, style_ok))
    if not style_ok:
        ok_all = False
        continue
    plan[rel] = out
    print()

if not ok_all or len(plan) != len(JOBS):
    print('校验未全通过，一个文件都不写')
    sys.exit(1)
print('全部校验通过')

print()
print('=' * 80)
print('阶段 2：统一落盘')
print('=' * 80)
for rel, data in plan.items():
    open(os.path.join(ROOT, rel), 'wb').write(data)
    print('  已写 %-42s %d 字节' % (rel, len(data)))
