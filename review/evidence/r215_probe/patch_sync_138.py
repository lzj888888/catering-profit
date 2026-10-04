# -*- coding: utf-8 -*-
# R215b 六处同步（新增第 138 个套件 check_paid_quota_unlock）
#
# 同步面（记忆红线：六处必改）：
#   ① verify_all.js SUITES 末尾  ② verify_all.js 头注「串联：N 个套件」
#   ③ verify_all.js 头注守卫说明段  ④ 重启键 §1.1 入口行  ⑤ 重启键「套件数会漂」行（＋两处演进链尾部）
#   ⑥ check_suite_assert_counts.js::CASES ＋ 重启键断言数声明行
# 🔴 先 encode 再 open('wb')；锚点命中数校验（不唯一即 ABORT 零写入）。
import io, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/"
VER = "verify_all.js"
KEY = "specs/dev-specs/★知识存储点_2026-09-10.md"
CNT = "tools/check_suite_assert_counts.js"

EVOL = (" → **138（R215b：新增 `tools/check_paid_quota_unlock.js`，付费档「账套/卡数不限」解锁守卫"
        " —— 实测发现四处配额判定（manageShop/getShopList/checkQuota/saveCostCard）全只读"
        " `plan_free.limits`、从不读 `expire_at` ⇒ 付费用户付了钱仍被锁 1 家店 / 20 张卡，"
        "与 `01_架构总览:167`（付费=账套不限·硬上限 200）、`04_核对清单:118` 冲突；"
        "同轮把 paid 接进三处 Service 判定与四处 Controller；8 断言，变异回灌 8/8 全部点名）**")

NEW_SUITE = "  ['paid-quota-unlock',    'tools/check_paid_quota_unlock.js'],"
NEW_NOTE = ("//       + 付费档「账套/卡数不限」解锁守卫（tools/check_paid_quota_unlock.js，R215b："
            "**付费判定必须真的接进配额链路** —— 实测付费用户仍被锁 1 家店；含反向判据「付费不得豁免硬上限」"
            " + 剥注释后再判（JSDoc 同行会把 hit_hard_limit 与 is_paid 写在一起））")
NEW_CASE = ("  { key: 'check_paid_quota_unlock', rel: 'tools/check_paid_quota_unlock.js' }, "
            "// 8 条（R215b：S 扫描面 2 / A 免费额度须被 paid 短路 1 / B 硬上限不得被 paid 豁免 1 / C 注入与单源 2 / D 解析器正负样本 2）")


def load(rel):
    with io.open(ROOT + rel, encoding="utf-8", newline="") as f:
        return f.read()


def save(rel, txt):
    data = txt.encode("utf-8")
    with open(ROOT + rel, "wb") as f:
        f.write(data)
    print("  写入 %-46s %d bytes" % (rel, len(data)))


def rep1(txt, old, new, tag):
    n = txt.count(old)
    if n != 1:
        print("ABORT [%s] 锚点命中 %d 次（须恰为 1）: %s" % (tag, n, old[:60].replace("\n", "\\n")))
        sys.exit(1)
    return txt.replace(old, new, 1)


def repn(txt, old, new, k, tag):
    n = txt.count(old)
    if n != k:
        print("ABORT [%s] 锚点命中 %d 次（须为 %d）: %s" % (tag, n, k, old[:60].replace("\n", "\\n")))
        sys.exit(1)
    return txt.replace(old, new)


# ---------- 阶段 1：全部校验 ----------
v = load(VER); k = load(KEY); c = load(CNT)
checks = [
    (v, "// 串联：137 个套件", "verify 头注套件数"),
    (v, "  ['fn-public-surface',    'tools/check_fn_public_surface.js'],", "verify SUITES 尾"),
    (v, "check_fn_public_surface.js，R215：", "verify 头注说明段锚点"),
    (k, "串 **137** 个套件", "重启键 §1.1 入口行"),
    (k, "（现 **137**；", "重启键 套件数会漂"),
    (k, "）；17 断言）**", "重启键 两处演进链尾"),
    (k, "check_fn_public_surface`=17（**五十者**", "重启键 断言数声明行"),
    (c, "{ key: 'check_fn_public_surface', rel: 'tools/check_fn_public_surface.js' },", "CASES 尾"),
]
for txt, old, tag in checks:
    n = txt.count(old)
    if tag == "重启键 两处演进链尾":
        if n != 2:
            print("ABORT [%s] 命中 %d 次（须为 2）" % (tag, n)); sys.exit(1)
    elif n != 1:
        print("ABORT [%s] 命中 %d 次（须为 1）" % (tag, n)); sys.exit(1)
print("阶段1：8 处锚点全部命中数正确 OK")

# ---------- 阶段 2：写入 ----------
# ① verify_all.js 头注套件数
v = rep1(v, "// 串联：137 个套件", "// 串联：138 个套件", "verify 头注套件数")
# ② SUITES 末尾追加
v = rep1(v, "  ['fn-public-surface',    'tools/check_fn_public_surface.js'],",
         "  ['fn-public-surface',    'tools/check_fn_public_surface.js'],\n" + NEW_SUITE, "SUITES 尾")
# ③ 头注守卫说明段：在 R215 说明行后插 R215b 行
lines = v.split("\n")
for i, ln in enumerate(lines):
    if "check_fn_public_surface.js，R215：" in ln:
        lines.insert(i + 1, NEW_NOTE)
        break
v = "\n".join(lines)
save(VER, v)

# ④ 重启键 §1.1 入口行
k = rep1(k, "串 **137** 个套件", "串 **138** 个套件", "重启键 §1.1")
# ⑤ 重启键「套件数会漂」
k = rep1(k, "（现 **137**；", "（现 **138**；", "重启键 套件数会漂")
# ⑤+ 两处演进链尾部
k = repn(k, "）；17 断言）**", "）；17 断言）**" + EVOL, 2, "重启键 演进链尾")
# ⑥-1 重启键断言数声明行
k = rep1(k, "check_fn_public_surface`=17（**五十者**",
         "check_fn_public_surface`=17 / `check_paid_quota_unlock`=8（**五十一者**", "重启键 断言数")
save(KEY, k)

# ⑥-2 CASES
c = rep1(c, "{ key: 'check_fn_public_surface', rel: 'tools/check_fn_public_surface.js' },",
         "{ key: 'check_fn_public_surface', rel: 'tools/check_fn_public_surface.js' },\n" + NEW_CASE, "CASES")
save(CNT, c)
print("阶段2：六处同步写入完成")
