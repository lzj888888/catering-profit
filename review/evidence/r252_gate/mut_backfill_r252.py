# -*- coding: utf-8 -*-
"""mut_backfill_r252.py —— R252 变异回灌（证明 check_salesbills 不是假绿）

纪律（mutation-backfill 技能）：
  · 先确认基线绿；每条变异独立（每条前 reset_to_base）；还原后复跑必须回绿；
  · 判据 = 点名到**目标断言号**（不是"有 ❌ 行"）；崩溃红（RC≠0 且无汇总行）单列；
  · 备份/还原走**字节**（坑 2-b/2-c/15：不落磁盘临时文件、写入前先 encode、恢复用 write_bytes）；
  · 锚点必须唯一命中（subn count==1，否则 fail-closed）；
  · 组 A（该红）+ 组 B（等价改写，该绿）。
"""
import os
import re
import subprocess
import sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
SUITE = r"tools/check_salesbills.js"

TARGETS = {
    "sid":    "cloudfunctions/common/salesBillId.js",
    "clear":  "cloudfunctions/clearSalesBills/service.js",
    "getidx": "cloudfunctions/getSalesBills/index.js",
    "clridx": "cloudfunctions/clearSalesBills/index.js",
    "clrval": "cloudfunctions/clearSalesBills/validate.js",
}

BASE = {}


def abspath(rel):
    return os.path.join(REPO, rel.replace("/", os.sep))


def read(p):
    with open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write(p, s):
    data = s.encode("utf-8")          # 🔴 坑 2-c：先 encode 再 open('wb')
    with open(p, "wb") as f:
        f.write(data)


def backup():
    for k, rel in TARGETS.items():
        BASE[k] = open(abspath(rel), "rb").read()


def reset_to_base():
    for k, rel in TARGETS.items():
        with open(abspath(rel), "wb") as f:
            f.write(BASE[k])


def run():
    r = subprocess.run([NODE, SUITE], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    failed = [l.strip() for l in out.splitlines() if l.strip().startswith("❌")]
    crashed = (r.returncode != 0) and not re.search(r"\d+ 通过 / \d+ 失败", out)
    return failed, crashed


def sub1(key, pattern, repl):
    """单次替换 + 强制锚点唯一（铁律 6）。"""
    p = abspath(TARGETS[key])
    src = read(p)
    new, n = re.subn(pattern, repl, src, count=1)
    if n != 1:
        raise RuntimeError("锚点命中 %d 次（须恰为 1）" % n)
    write(p, new)


# ---- 变异清单： (名, 目标, 正则, 替换, 期望命中的断言号 或 None=组B须不红) ----
MUTATIONS = [
    # ========== 组 A：该红 ==========
    ("A1 退回 BUG-A：平台改 rightmost-'_' 盲切", "sid",
     r"  for \(const p of PLATFORM_BY_LEN\) \{\n    if \(head === p \|\| head\.endsWith\('_' \+ p\)\) return p;\n  \}\n  return '';",
     "  return head.slice(head.lastIndexOf('_') + 1);",
     "2-③"),

    ("A2 退回 BUG-B：kind 缺省不展开（want 键缺形态）", "clear",
     r"const kinds = t\.kind \? \[t\.kind\] : \['bill', 'dish'\];",
     "const kinds = [t.kind || ''];",
     "4-①"),

    ("A3 软删缺 delete_at（三件套残）", "clridx",
     r"data: \{ is_deleted: true, delete_at: now, delete_by: userId \},",
     "data: { is_deleted: true, delete_by: userId },",
     "5-②"),

    ("A4 幂等预检挪到业务写之后", "clridx",
     r"( *)const prior = await common\.idempotency\.findPriorResult\(db, shopId, clientRequestId\);",
     r"\1const prior = null;  // MOVED-LATER: prior 预检被挪走",
     "5-④"),

    ("A5 疑似物理删除：加一行 .remove(", "clridx",
     r"( *)const MAX_CLEAR_ROWS = 5000;",
     r"\1await db.collection('external_sales_daily').where({}).remove();\n\1const MAX_CLEAR_ROWS = 5000;",
     "5-③"),

    ("A6 清理上限护栏改大（下界失效）", "clridx",
     r"const MAX_CLEAR_ROWS = 5000;",
     "const MAX_CLEAR_ROWS = 999999999;",
     "5-⑥-b"),

    ("A7 getSalesBills 变成可写（加物理删）", "getidx",
     r"( *)(return ok\(\{)",
     r"\1await db.collection('external_sales_daily').doc('x').remove();\n\1\2",
     "5-①"),

    ("A8 validate 去掉 targets/all 二选一判据", "clrval",
     r"if \(!all && rawTargets\.length === 0\) return err\('请指定要清除的账单（targets）或选择全部清除（all）'\);",
     "// REMOVED: 二选一判据",
     "6-②"),

    ("A9 unknown 形态被静默吞掉（当命中处理）", "clear",
     r"if \(meta\.kind === 'unknown'\) return;      // 形态认不出 ⇒ \*\*不误删\*\*（fail-closed）",
     "// no-op",
     "7-③"),

    # ========== 组 B：等价改写，须保持绿 ==========
    ("B1 等价：pickPlatform 用 some 改写", "sid",
     r"  for \(const p of PLATFORM_BY_LEN\) \{\n    if \(head === p \|\| head\.endsWith\('_' \+ p\)\) return p;\n  \}\n  return '';",
     "  const hit = PLATFORM_BY_LEN.filter((p) => head === p || head.endsWith('_' + p));\n  return hit.length ? hit[0] : '';",
     None),

    ("B2 等价：`all || want.has(...)` → 三元", "clear",
     r"const hit = all \|\| want\.has\(meta\.kind \+ '\|' \+ meta\.platform \+ '\|' \+ meta\.bizDate\);",
     "const hit = all ? true : want.has(meta.kind + '|' + meta.platform + '|' + meta.bizDate);",
     None),

    ("B3 等价：kinds 展开用 concat", "clear",
     r"const kinds = t\.kind \? \[t\.kind\] : \['bill', 'dish'\];",
     "const kinds = [].concat(t.kind ? [t.kind] : ['bill', 'dish']);",
     None),
]


def main():
    backup()
    try:
        f, c = run()
        if f or c:
            print("基线不绿，先修。❌=%d" % len(f))
            for x in f[:8]:
                print("   ", x)
            return 1
        print("基线绿 ✅\n")

        miss, caught = [], 0
        for name, key, pat, rep, expect in MUTATIONS:
            reset_to_base()
            try:
                sub1(key, pat, rep)
            except RuntimeError as e:
                print("SKIP  %-46s %s" % (name, e))
                miss.append(name)
                continue
            failed, crashed = run()
            hit = any(("❌ " + expect) in x or expect in x for x in failed) if expect else None
            if expect:                       # 组 A：点名必须命中
                ok = bool(hit)
                print("%-46s ❌=%d %s expect=%s -> %s" %
                      (name, len(failed), "(崩溃)" if crashed else "", expect, "✅抓到" if ok else "❌漏网"))
                if ok:
                    caught += 1
                else:
                    miss.append(name)
                    for x in failed[:4]:
                        print("      ", x)
            else:                            # 组 B：目标断言不得出现
                noise = [x for x in failed if expect]
                ok = (len(failed) == 0 and not crashed)
                print("%-46s ❌=%d %s -> %s" %
                      (name, len(failed), "(崩溃)" if crashed else "", "✅未假红" if ok else "❌假红"))
                if not ok:
                    miss.append(name)
                    for x in failed[:4]:
                        print("      ", x)

        reset_to_base()
        af, ac = run()
        print("\n还原后 ❌=%d crash=%s -> %s" % (len(af), ac, "✅回绿" if (not af and not ac) else "❌未回绿"))
        print("统计：抓到 %d / 漏网 %d / 期望 %d" % (caught, len(miss), sum(1 for m in MUTATIONS if m[4])))
        if miss:
            print("漏网清单：", miss)
        return 0 if (not miss and not af and not ac) else 1
    finally:
        reset_to_base()


sys.exit(main())
