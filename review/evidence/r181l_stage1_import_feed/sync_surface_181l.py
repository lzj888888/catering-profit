# -*- coding: utf-8 -*-
"""批次 F 六处同步面补丁（套件数 120 → 122）。

两阶段：① 全部锚点断言「命中 == 1」，任一不符则**整体不落盘**（零损失）；
        ② 统一落盘（锚点统一用 \\n 写法，由 sub1() 自适应文件实际行尾）。
"""
import io, os, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
VA = os.path.join(ROOT, "verify_all.js")
RB = os.path.join(ROOT, "specs", "dev-specs", "★知识存储点_2026-09-10.md")
CA = os.path.join(ROOT, "tools", "check_suite_assert_counts.js")

# ── (文件, 锚点, 新文本, 标签) ──
EDITS = [
    # ① verify_all.js 头注「串联：N 个套件」
    (VA, "// 串联：120 个套件", "// 串联：122 个套件", "VA-串联"),

    # ② verify_all.js 头注守卫说明段（在 M3.21 说明之后追加两条）
    (VA,
     "//         + 套餐默认排除 + 细项名取 TERMS 单源（防改名静默失效）+ 除零/空账回 null（不许返回 0）。\n",
     "//         + 套餐默认排除 + 细项名取 TERMS 单源（防改名静默失效）+ 除零/空账回 null（不许返回 0）。\n"
     "//       + 账单导入解析守卫（tools/selftest_bill_parse.js，R181l：**平台按列名判定，不看文件名**）——\n"
     "//         纯函数 utils/billParse.js（零依赖、不落库、不碰云）：detectPlatform / guessHeader / parseBillMatrix。\n"
     "//         判据 = A 平台判定（淘宝/美团表头各自识别 + 不误判）+ B **两锚点原样复现**（淘宝 156 行 / 377965 分；\n"
     "//         美团全 97 行 → 按「交易类型=外卖订单」筛后 50 行 / 182664 分，excluded 47）+ 复合列×拆分列只取一组。\n"
     "//       + 数据可信度甲级门禁守卫（tools/selftest_grade_gate.js，R181l）——\n"
     "//         纯校验 utils/gradeGate.js（不落库、不碰云）：checkGradeA（通道连通 / Schema 校验 / 关键指标非空，三门 fail-closed）。\n"
     "//         判据 = 正常样本通过 + 每门各一反例（CHANNEL_EMPTY / SCHEMA_PLATFORM / REQUIRED_*）。\n",
     "VA-头注说明"),

    # ③ verify_all.js SUITES 末尾
    (VA,
     "  ['m3-recon', 'tools/selftest_m3_recon.js'],\n];",
     "  ['m3-recon', 'tools/selftest_m3_recon.js'],\n"
     "  // 批次 F 阶段①（账单导入 · M3 外部接数）：平台按列名判定（不看文件名）+ 两锚点原样复现 + 复合列只取一组。\n"
     "  ['bill-parse', 'tools/selftest_bill_parse.js'],\n"
     "  // 批次 F 甲级门禁（数据可信度 · v1.4 §5.2）：通道连通 / Schema 校验 / 关键指标非空，三门 fail-closed。\n"
     "  ['grade-gate', 'tools/selftest_grade_gate.js'],\n];",
     "VA-SUITES"),

    # ④ 重启键 §1.1 一键校验入口行
    (RB, "串 **120** 个套件", "串 **122** 个套件", "RB-§1.1"),

    # ⑤-a 重启键「套件数会漂」行
    (RB, "现 **120**；", "现 **122**；", "RB-漂"),

    # ⑤-b 重启键演进链尾部
    (RB,
     "M3.21 M1↔M3 率对率对账守卫 —— 覆盖率闸门 fail-closed（<60% 或缺分母 ⇒ 抑制）+ 套餐默认排除 + 细项名取 TERMS 单源 + 除零/空账回 null，16 条断言）**",
     "M3.21 M1↔M3 率对率对账守卫 —— 覆盖率闸门 fail-closed（<60% 或缺分母 ⇒ 抑制）+ 套餐默认排除 + 细项名取 TERMS 单源 + 除零/空账回 null，16 条断言）**"
     " → **121（round181l：新增 `tools/selftest_bill_parse.js`，批次 F 阶段① 账单导入解析守卫 —— 平台按列名判定（不看文件名）+ 两锚点原样复现（淘宝 156 行/377965 分；美团筛后 50 行/182664 分）+ 复合列×拆分列只取一组，15 条断言）**"
     " → **122（round181l：新增 `tools/selftest_grade_gate.js`，数据可信度甲级门禁守卫 —— 通道连通/Schema 校验/关键指标非空三门 fail-closed，11 条断言）**",
     "RB-演进链"),

    # ⑥-a 重启键断言数声明行
    (RB,
     "`selftest_m3_recon`=16（**三十六者**均 ≡ 实跑 pass 数；",
     "`selftest_m3_recon`=16 / `selftest_bill_parse`=15 / `selftest_grade_gate`=11（**三十八者**均 ≡ 实跑 pass 数；",
     "RB-断言数"),

    # ⑦ CASES
    (CA,
     "  { key: 'selftest_m3_recon', rel: 'tools/selftest_m3_recon.js' }, // 16 条（M3.21：D 锚点 + 闸门）\n",
     "  { key: 'selftest_m3_recon', rel: 'tools/selftest_m3_recon.js' }, // 16 条（M3.21：D 锚点 + 闸门）\n"
     "  { key: 'selftest_bill_parse', rel: 'tools/selftest_bill_parse.js' }, // 15 条（批次 F：平台判定 + 两锚点）\n"
     "  { key: 'selftest_grade_gate', rel: 'tools/selftest_grade_gate.js' }, // 11 条（批次 F：甲级三门）\n",
     "CA-CASES"),
]

# ── 阶段一：读文件 + 断言 ──
fails = []
cache = {}
for path, old, new, label in EDITS:
    if path not in cache:
        cache[path] = io.open(path, encoding="utf-8").read()
    txt = cache[path]
    n_lf = txt.count(old)
    n_crlf = txt.count(old.replace("\n", "\r\n"))
    if not (n_lf == 1 or (n_crlf == 1 and n_lf == 0)):
        fails.append("[%s] LF=%d CRLF=%d（期望 1）片段: %s" % (label, n_lf, n_crlf, old[:70].replace("\n", "\\n")))
    cache[path] = txt  # 保持"检查基于原始内容"，落盘在阶段二

if fails:
    print("!! 阶段一失败，**未落盘**（零损失）：")
    for f in fails:
        print("   -", f)
    sys.exit(2)
print("阶段一 OK：%d 处锚点全部命中唯一" % len(EDITS))

# ── 阶段二：落盘（自适应行尾）──
before = {p: len(t) for p, t in cache.items()}
for path, old, new, label in EDITS:
    txt = cache[path]
    if txt.count(old) == 1:
        txt = txt.replace(old, new, 1)
    else:
        txt = txt.replace(old.replace("\n", "\r\n"), new.replace("\n", "\r\n"), 1)
    cache[path] = txt

for path, txt in cache.items():
    io.open(path, "w", encoding="utf-8", newline="").write(txt)
    print("  落盘 %s：%d → %d 字符" % (os.path.basename(path), before[path], len(txt)))

# ── 回读自证 ──
print("\n回读自证：")
for path, _, _, _ in EDITS:
    pass
va = io.open(VA, encoding="utf-8").read()
rb = io.open(RB, encoding="utf-8").read()
ca = io.open(CA, encoding="utf-8").read()
print("  verify_all 串联：122 出现 %d 次 / SUITES 含 bill-parse %d / grade-gate %d"
      % (va.count("// 串联：122 个套件"), va.count("'bill-parse'"), va.count("'grade-gate'")))
print("  重启键 串**122** %d / 现**122** %d / 三十八者 %d / 演进链含 121 \\u2192 122 %d"
      % (rb.count("串 **122** 个套件"), rb.count("现 **122**；"), rb.count("三十八者"),
         rb.count("→ **121（round181l") + rb.count("→ **122（round181l")))
print("  CASES 含 selftest_bill_parse %d / selftest_grade_gate %d"
      % (ca.count("'selftest_bill_parse'"), ca.count("'selftest_grade_gate'")))
