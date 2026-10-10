# -*- coding: utf-8 -*-
"""R263 同步面：六处必改（verify_all.js ×3 + 重启键 ×3）。
🔴 两阶段：先在内存里改完并断言每个锚点命中数 == 1；全部通过才统一落盘。
🔴 行尾按文件实测（不硬写 \\n）。"""
import io, sys, os

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
VA = os.path.join(REPO, 'verify_all.js')
RB = os.path.join(REPO, 'specs/dev-specs/★知识存储点_2026-09-10.md')


def load(p):
    b = io.open(p, 'rb').read()
    eol = '\r\n' if b.count(b'\r\n') > 0 else '\n'
    return b.decode('utf-8'), eol


def save(p, s):
    io.open(p, 'wb').write(s.encode('utf-8'))


va, vaEol = load(VA)
rb, rbEol = load(RB)
print('verify_all.js EOL=%r  重启键 EOL=%r' % (vaEol, rbEol))

CHANGES = []

# ---- 处1：verify_all.js 头注「串联：163」→ 164 ----
CHANGES.append((VA, 'A1 头注串联数', va, '// 串联：163 个套件', '// 串联：164 个套件'))

# ---- 处2：verify_all.js 头注插新条目（锚在最后一条守卫的断言数行之后）----
A2_OLD = ('//         `da.get()` 也不在读侧集合内（它的判据是 `doc.is_deleted` 真值，undefined 为 falsy ⇒ 本缺陷免疫）。' + vaEol
          + '//         39 断言。')
A2_NEW = A2_OLD + vaEol + (
    '//       + M3 枢纽页引导守卫（tools/check_hub_guide.js，R263：「三步走 + 分层 + 空状态」——'
    '李老师 2026-10-10 真机反馈「进来一脸懵：不知道这个模块能做什么、怎么做、结果去哪里看」；'
    '根因＝5 张分区卡**平级**摆着、零先后线索。判据＝三步走块真渲染 + 空状态必须**严格** `cardCount === 0`'
    '（写成 `<= 0` 会把"没读到(-1)"误判成空状态）+ 位置不变式（引导块必须在第一张卡之前）+ 卡名 ≡ 页面标题'
    '（`hub.takeawayTitle` ≡ `ledger.takeaway.title`）。17 断言 + 3 道自失效护栏）')
CHANGES.append((VA, 'A2 头注新条目', va, A2_OLD, A2_NEW))

# ---- 处3：verify_all.js SUITES 末尾追加 ----
A3_OLD = "  ['bill-import-gate', 'tools/check_bill_import_gate.js']," + vaEol + "];"
A3_NEW = ("  ['bill-import-gate', 'tools/check_bill_import_gate.js']," + vaEol
          + "  // R263：M3 枢纽页「三步走 + 分层 + 空状态」（真机反馈「进来一脸懵」）。" + vaEol
          + "  //   这一类引导块的失效方式**全是静默的**：判据放宽成 `<= 0` 会在网络抖动时误报" + vaEol
          + "  //   「你还没有卡」；引导块挪到卡片后面 ⇒ 问题原样复现；`flowSteps` 数组漏登记 ⇒ 只剩空标题。" + vaEol
          + "  ['hub-guide', 'tools/check_hub_guide.js']," + vaEol
          + "];")
CHANGES.append((VA, 'A3 SUITES 追加', va, A3_OLD, A3_NEW))

# ---- 处4：重启键 §1.1 入口行 ----
A4_OLD = '串 **163** 个套件'
A4_NEW = '串 **164** 个套件'
CHANGES.append((RB, 'B1 入口行套件数', rb, A4_OLD, A4_NEW))

A4B_OLD = ('**R259 账单导入开关守卫 `tools/check_bill_import_gate.js`（28 断言：'
           '开关两处取值同源 + 暂停条件必须与「是不是账单」绑判 + 云函数兜底早于首个写库 + '
           '「暂停 ≠ 删代码」四条在场检查；B 段真跑三种形态验「账单被关、形态 A/C 照常」）**')
A4B_NEW = A4B_OLD + (' + **R263 M3 枢纽页引导守卫 `tools/check_hub_guide.js`（17 断言：'
                     '三步走块真渲染（`t.flowSteps` 是 ≥3 项数组）/ 空状态判据必须**严格** `cardCount === 0` '
                     '（`<= 0` 会把"没读到(-1)"误判成空状态；另判 data 初值 -1 且失败路径不写 cardCount）/ '
                     '位置不变式（三步走块与空状态块下标都必须 < 第一张卡下标）/ 卡名 ≡ 页面标题 / '
                     'i18n 双副本 md5 全等 / 页面 `t:{}` 七个新键登记齐；S 段三道自失效护栏）**')
CHANGES.append((RB, 'B4 入口行守卫说明', rb, A4B_OLD, A4B_NEW))

# ---- 处5：重启键 断言数声明行 ----
A5_OLD = ' / `check_bill_import_gate`=28（**七十三者**均 ≡ 实跑 pass 数'
A5_NEW = ' / `check_bill_import_gate`=28 / `check_hub_guide`=17（**七十四者**均 ≡ 实跑 pass 数'
CHANGES.append((RB, 'B2 断言数声明行', rb, A5_OLD, A5_NEW))

# ---- 处6：重启键「套件数会漂」行 ----
A6_OLD = '（现 **163**；'
A6_NEW = '（现 **164**；'
CHANGES.append((RB, 'B3 会漂行套件数', rb, A6_OLD, A6_NEW))

A6B_OLD = ('→ **163（R259：新增 `bill-import-gate` 套件 —— 外卖账单导入暂停展示；'
           '既有 162 条无一条盯「产品开关是不是真的只关了该关的那一块」，'
           '而那个 tab 是统一导入器、关错方向会静默砍掉复盘输入）**')
A6B_NEW = A6B_OLD + (' → **164（R263：新增 `hub-guide` 套件 —— M3 枢纽页「三步走 + 分层 + 空状态」；'
                     '既有 163 条无一条盯「枢纽页进来会不会懵」，而这类引导块的失效方式全是静默的：'
                     '判据放宽成 `<= 0` 会把"没读到(-1)"误判成空状态、引导块挪到卡片后面则问题原样复现、'
                     '`flowSteps` 数组漏登记只留静默空白）**')
CHANGES.append((RB, 'B5 会漂行演进链', rb, A6B_OLD, A6B_NEW))

# ================= 阶段一：全部校验（命中数必须 == 1）=================
cur = {VA: va, RB: rb}
plan = []
ok = True
for path, label, base, old, new in CHANGES:
    n = cur[path].count(old)
    print('%-22s 命中=%d %s' % (label, n, 'OK' if n == 1 else '❌'))
    if n != 1:
        ok = False
    plan.append((path, label, old, new))

if not ok:
    print('\n🔴 锚点校验失败 ⇒ 一个文件都不写（两阶段纪律）')
    sys.exit(1)

# ================= 阶段二：统一落盘 =================
for path, label, old, new in plan:
    cur[path] = cur[path].replace(old, new, 1)

save(VA, cur[VA])
save(RB, cur[RB])
print('\n✅ 六处全部落盘')

# ---- 落盘后反向自查 ----
va2, _ = load(VA)
rb2, _ = load(RB)
print('串联数 :', '// 串联：164 个套件' in va2)
print('SUITES :', "'hub-guide', 'tools/check_hub_guide.js'" in va2)
print('入口行 :', '串 **164** 个套件' in rb2)
print('声明行 :', '`check_hub_guide`=17（**七十四者**' in rb2)
print('会漂行 :', '（现 **164**；' in rb2 and '164（R263：新增 `hub-guide`' in rb2)
print('旧值残留(应为 0):', rb2.count('串 **163** 个套件'), rb2.count('（现 **163**；'), rb2.count('**七十三者**'))
