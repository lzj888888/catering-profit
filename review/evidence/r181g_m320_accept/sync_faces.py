# -*- coding: utf-8 -*-
"""M3.20 验收：同步面补齐（重启键 3 处 + CASES 1 处），带前后校验。"""
import io, os, sys, hashlib

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
KEY = os.path.join(ROOT, 'specs', 'dev-specs', '★知识存储点_2026-09-10.md')
CNT = os.path.join(ROOT, 'tools', 'check_suite_assert_counts.js')


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def rep(text, old, new, label):
    n = text.count(old)
    if n != 1:
        print('  ✗ %s: 命中 %d 次（期望 1）' % (label, n))
        return text, False
    print('  ✓ %s: 命中 1 次，已替换' % label)
    return text.replace(old, new), True


ok_all = True

# ---------- 1. 重启键 §1.1 套件数 116 → 117 ----------
t = rd(KEY)
old1 = '- **一键校验入口（改完必跑）**：`node verify_all.js`（仓库根；串 **116** 个套件'
new1 = '- **一键校验入口（改完必跑）**：`node verify_all.js`（仓库根；串 **117** 个套件'
t, ok1 = rep(t, old1, new1, '重启键 §1.1 套件数')
ok_all &= ok1

# ---------- 2. 重启键「套件数会漂」段 ----------
old2 = '（现 **116**；2026-09-17 由 41 → 45'
new2 = '（现 **117**；2026-09-17 由 41 → 45'
t, ok2 = rep(t, old2, new2, '重启键 套件数会漂 现N')
ok_all &= ok2

# ---------- 3. 断言数唯一声明处：加 selftest_m3_lexicon=21 + 三十二者→三十三者 ----------
old3 = '`selftest_m3_combo`=17（**三十二者**均 ≡ 实跑 pass 数'
new3 = '`selftest_m3_combo`=17 / `selftest_m3_lexicon`=21（**三十三者**均 ≡ 实跑 pass 数'
t, ok3 = rep(t, old3, new3, '断言数唯一声明处')
ok_all &= ok3

if ok_all:
    wr(KEY, t)
    print('  重启键已落盘')
else:
    print('  ✗ 重启键未写入（有替换失败）')

# ---------- 4. CASES 纳入 selftest_m3_lexicon ----------
c = rd(CNT)
old4 = "  { key: 'selftest_m3_combo', rel: 'tools/selftest_m3_combo.js' },\n];"
new4 = (
    "  { key: 'selftest_m3_combo', rel: 'tools/selftest_m3_combo.js' },\n"
    "  // round181g 扩面：M3.20 词库/模板（批次 B 收尾）守卫同批纳入 —— 与 m3-combo 同族理由：\n"
    "  //   L-a~L-g 七组锚点（规模 67 / 必含 8 条 / 别名命中 / 绝不自动替换 / 单位池 ∈ PURCHASE_UNITS /\n"
    "  //   模板 20 道无价格 / applyTemplate 只返回行名·用量·单位）是「非恒真」凭据；而 21 条删一批仍 > 0\n"
    "  //   ⇒ A0-② 的「通过数为 0」下界抓不到，只有 A2「声明 ≡ 实跑」能发现。\n"
    "  { key: 'selftest_m3_lexicon', rel: 'tools/selftest_m3_lexicon.js' }, // 21 条（M3.20：L-a~L-g）\n"
    "];"
)
c2, ok4 = rep(c, old4, new4, 'CASES 纳入 m3-lexicon')
if ok4:
    wr(CNT, c2)
    print('  CASES 已落盘')
else:
    print('  ✗ CASES 未写入')
ok_all &= ok4

# ---------- 回读校验 ----------
print('\n===== 回读校验 =====')
k2 = rd(KEY)
print('  重启键含 117 次数 =', k2.count('117'))
print('  重启键仍含 **116** =', '**116**' in k2)
print('  声明处含 m3_lexicon=21 =', '`selftest_m3_lexicon`=21' in k2)
print('  声明处含 三十三者 =', '**三十三者**' in k2)
c3 = rd(CNT)
print('  CASES 含 selftest_m3_lexicon =', "key: 'selftest_m3_lexicon'" in c3)
print('\nALL_OK =', ok_all)
