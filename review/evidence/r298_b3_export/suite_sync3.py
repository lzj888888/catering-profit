# -*- coding: utf-8 -*-
"""R298·B3 声明面同步（两阶段写入：先全量校验，再统一落盘；纯 LF）。

同步四处：
  ① verify_all.js 头注「串联：174 个套件」→ 175
  ② verify_all.js SUITES 尾追加 export-roundtrip（注释内**不得含方括号**）
  ③ 重启键 §1.1 入口行「串 174 个套件」→ 175 + 补新守卫说明
  ④ 重启键「套件数会漂」行「现 174」→ 175
  ⑤ 重启键演进链尾追加 175 条目
  ⑥ 重启键「套件断言数口径」行加 check_export_roundtrip=46 并改「七十七者」→「七十八者」
  ⑦ tools/check_suite_assert_counts.js CASES 加本守卫条目
"""
import io
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/'
VA = ROOT + 'verify_all.js'
RK = ROOT + 'specs/dev-specs/★知识存储点_2026-09-10.md'
AC = ROOT + 'tools/check_suite_assert_counts.js'


def load(p):
    return io.open(p, encoding='utf-8').read()


def save(p, s):
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)


# 每项 = (文件, 锚点, 替换文本, 说明)
EDITS = []

# ---------- ① verify_all.js 头注 ----------
EDITS.append((VA,
    '// 串联：174 个套件 = ',
    '// 串联：175 个套件 = ',
    'verify_all 头注串连数 174 → 175'))

# ---------- ② verify_all.js SUITES 追加 ----------
A2_OLD = ("  ['money-precision', 'tools/check_money_precision.js'],\n];")
A2_NEW = (
    "  ['money-precision', 'tools/check_money_precision.js'],\n"
    "  // ===== R298·B3 导出件「真能读回 + 内容保真」守卫 =====\n"
    "  //   见头部注释同名条目。根因：check_export_delivery 只判**源码形态**（bookType / base64 / 依赖声明 / 文案），\n"
    "  //   从没有任何测试真解码过 base64 ⇒ 导出件「行数对不对、金额是不是数字（会计能不能 SUM）、值有没有变」\n"
    "  //   这一整面环上零判据（同族病：判据只覆盖写法、不覆盖产出物）。\n"
    "  //   判据 = S 扫描面与依赖三级 fail-closed + A 真写→真读回结构守恒 + B 单元格类型\n"
    "  //        + C 分↔元往返逐点等值 + D 多 scope 覆盖 + E 边界行为登记 + F 判据分辨力 + W 已知缺口登记。\n"
    "  ['export-roundtrip', 'tools/check_export_roundtrip.js'],\n];"
)
EDITS.append((VA, A2_OLD, A2_NEW, 'verify_all SUITES 追加 export-roundtrip'))

# ---------- ③ 重启键 §1.1 入口行 ----------
EDITS.append((RK,
    '串 **174** 个套件（R298 新增「金额精度」',
    '串 **175** 个套件（R298 新增「导出件可回读」`tools/check_export_roundtrip.js`：'
    'SheetJS **真写 → 真读回**（4 张表名与顺序 / 逐表行数含空行 / 逐格守恒、金额列必须是 openpyxl 也认的数字型、'
    '分↔元逐点回算等值、多 scope 覆盖、SheetJS 空表与重名边界行为登记），依赖三级 fail-closed 不设 stub，'
    '另附**独立实现** openpyxl 交叉验证 13/13；R298 新增「金额精度」',
    '重启键 §1.1 入口行 174 → 175 + 新守卫说明'))

# ---------- ④ 重启键「套件数会漂」行（行内替换，避免整行锚点过长） ----------
# 用「行内首个 174 → 175」策略，在脚本里另行处理（见下方 SPECIAL）

# ---------- ⑤ 重启键演进链追加 ----------
EDITS.append((RK,
    '600 万组合错 3528 处）**',
    '600 万组合错 3528 处）** → **175（R298·B3：新增 `export-roundtrip` 套件 '
    '`tools/check_export_roundtrip.js` —— `check_export_delivery` 只判源码形态、**从无测试解码 base64**；'
    '本守卫真写→真读回（工作表名与顺序 / 逐表行数含空行 / 逐格守恒、金额列必须数字型、分↔元逐点回算等值、'
    '多 scope 覆盖、SheetJS 空表与重名边界行为登记），依赖三级 fail-closed **不设 stub**，'
    '并用 openpyxl 3.1.5 独立实现交叉验证 13/13）**',
    '重启键演进链追加 175 条目'))

# ---------- ⑥ 重启键断言数声明行 ----------
EDITS.append((RK,
    '/ `check_money_precision`=30（**七十七者**均 ≡ 实跑 pass 数',
    '/ `check_money_precision`=30 / `check_export_roundtrip`=46（**七十八者**均 ≡ 实跑 pass 数',
    '重启键断言数行 + 七十七者 → 七十八者'))

# ---------- ⑦ CASES ----------
C1_OLD = ("  { key: 'check_money_precision', rel: 'tools/check_money_precision.js' },  // 30 条\n];")
C1_NEW = ("  { key: 'check_money_precision', rel: 'tools/check_money_precision.js' },  // 30 条\n"
          "  // R298·B3 导出件可回读：真写→真读回 + 内容保真（详见 tools/check_export_roundtrip.js 头注）\n"
          "  { key: 'check_export_roundtrip', rel: 'tools/check_export_roundtrip.js' },  // 46 条\n];")
EDITS.append((AC, C1_OLD, C1_NEW, 'CASES 追加 check_export_roundtrip'))

# ================= 阶段一：全量校验 =================
srcs = {}
for p in (VA, RK, AC):
    srcs[p] = load(p)

plan = []
problems = []
for p, old, new, desc in EDITS:
    c = srcs[p].count(old)
    if c != 1:
        problems.append('[锚点] %s —— 命中 %d 次（须为 1）：%r' % (desc, c, old[:60]))
    if srcs[p].count(new) > 0:
        problems.append('[重复] %s —— 替换文本已存在：%r' % (desc, new[:60]))
    plan.append((p, old, new, desc))

# ④ 特例：重启键「套件数会漂」行的 现 **174** → 现 **175**
#   ⚠️ 不能用 '件数会漂' 定位 —— 文档里历史回执也写着「『套件数会漂』行 + 演进链」，
#      首次命中会落到回执文本上（上一版就栽在这里，fail-closed 拦住了）。用唯一串锚定。
D4_ANCHOR = '（现 **174**；2026-09-17 由 41'
i = srcs[RK].find(D4_ANCHOR)
c4 = srcs[RK].count(D4_ANCHOR)
if i < 0 or c4 != 1:
    problems.append('[锚点] 重启键「套件数会漂」行（现 174）命中 %d 次：%r' % (c4, D4_ANCHOR))
else:
    j = srcs[RK].find('\n', i)
    line = srcs[RK][i - 40:j]
    if '**174**' not in line:
        problems.append('[锚点] 「套件数会漂」行内未见 **174**：%r' % line[:120])
    else:
        newline = line.replace('**174**', '**175**', 1)
        plan.append((RK, line, newline, '重启键「套件数会漂」行 174 → 175'))

if problems:
    print('❌ 阶段一校验未通过，**未落盘**：')
    for x in problems:
        print('   ' + x)
    sys.exit(1)

print('✅ 阶段一校验通过（%d 条编辑，锚点全部唯一命中、替换文本均不存在）' % len(plan))

# ================= 阶段二：统一落盘 =================
out = dict(srcs)
for p, old, new, desc in plan:
    out[p] = out[p].replace(old, new, 1)
    print('   · ' + desc)

for p, s in out.items():
    save(p, s)
print('✅ 阶段二落盘完成（纯 LF）')

# ================= 回读复核 =================
print('\n--- 回读复核 ---')
for p, old, new, desc in plan:
    cur = load(p)
    print(('  OK  ' if new in cur and old not in cur else '  BAD ') + desc)
