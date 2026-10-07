#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""H-1 形态 C 变异回灌：逐条把正确实现改回错误写法，看 tools/check_formc_parse.js 是否转红，
且必须红在「目标断言名」上（崩溃红 / 只红 RC 不算有效红）。

用法：python review/evidence/rh1_formc_parse/mut_formc_parse.py
（每次变异后还原 service.js，并用 git diff 自证零残留。）
"""
import subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SVC = os.path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js')
GUARD = os.path.join(ROOT, 'tools', 'check_formc_parse.js')

# (name, target_assertion, [(old, new), ...])
MUTATIONS = [
    # 1. 误用「订单交易额」作 amount（整单口径 ⇒ 重复计钱）→ Σ 变 2974.91
    ("改用订单交易额", "R-C1-③", [
        ("['日期', '门店编号', '商品名称', '销量', '销售额']",
         "['日期', '门店编号', '商品名称', '销量', '订单交易额']"),
        ("const sales = toNum(get(r, '销售额'));",
         "const sales = toNum(get(r, '订单交易额'));"),
    ]),
    # 2. 补零行（把缺的 (名,日) 网格补 0）→ 行数 354 → 357
    ("补零", "R-C1-①", [
        ("  // 按 bizDate 分组（一表多天 ⇒ N 组，v1.7 C-7）。🔴 禁止补零行（无行 = 无销售，v1.7 C-6 / R232-2）。",
         "  const allNames = [...new Set(out.map(x => x.name))];\n"
         "  const allDates = [...new Set(out.map(x => x.bizDate))];\n"
         "  for (const n of allNames) for (const d of allDates) {\n"
         "    if (!out.some(x => x.name === n && x.bizDate === d)) out.push({ bizDate: d, name: n, dishKey: n, qty: 0, amountFen: 0 });\n"
         "  }\n"
         "  // 按 bizDate 分组（一表多天 ⇒ N 组，v1.7 C-7）。🔴 禁止补零行（无行 = 无销售，v1.7 C-6 / R232-2）。"),
    ]),
    # 3. 销量列不做 toNum（直接 Number.isFinite 判文本 ⇒ "43" 被误杀）→ Σqty 118 → 0
    ("不转数", "R-C1-②", [
        ("const rawQty = toNum(get(r, '销量'));",
         "const rawQty = Number.isFinite(get(r, '销量')) ? get(r, '销量') : null;"),
    ]),
    # 4. biz_date 取 R2（形态 C 无参数行，R2 是数据行）→ 全天塌成 1 组
    ("biz_date 取 R2", "R-C1-④", [
        ("const bizDate = normalizeDate(get(r, '日期'));",
         "const bizDate = normalizeDate((rows[1] || [])[0]);"),
    ]),
    # 5. 收起白名单（去掉「销售额」列）→ amount 全 0
    ("收起白名单", "R-C1-③", [
        ("['日期', '门店编号', '商品名称', '销量', '销售额']",
         "['日期', '门店编号', '商品名称', '销量']"),
    ]),
]


def run_guard():
    p = subprocess.run(["node", GUARD], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, p.stdout


def main():
    src = open(SVC, encoding='utf-8').read()
    results = []
    for name, target, edits in MUTATIONS:
        # 应用变异
        mutated = src
        for old, new in edits:
            if old not in mutated:
                print(f"[SKIP] {name}: 找不到锚点 {old[:40]!r}")
                results.append((name, "ANCHOR_MISS", None))
                mutated = None
                break
            mutated = mutated.replace(old, new, 1)
        if mutated is None:
            continue
        open(SVC, 'w', encoding='utf-8').write(mutated)
        rc, out = run_guard()
        # 还原
        open(SVC, 'w', encoding='utf-8').write(src)

        red = (rc != 0)
        hit_target = (f"❌ {target}" in out)
        # 有效红 = 守卫转红 且 红在目标断言名（不是崩溃/别的断言）
        ok = red and hit_target
        results.append((name, "OK" if ok else ("RED_NOT_TARGET" if red else "STILL_GREEN"), target))
        print(f"{'PASS' if ok else 'FAIL'} {name}: rc={rc} target={target} hit={hit_target}")
        if not ok:
            # 打印守卫尾部以便定位
            for line in out.splitlines()[-15:]:
                print("    | " + line)

    # 确认零残留：最终文件内容 ≡ 变异前备份（逐字节，不依赖 git HEAD —— 本批还有未提交改动）
    current = open(SVC, encoding='utf-8').read()
    clean = (current == src)
    print(f"\n还原零残留（文件 ≡ 变异前备份，逐字节）: {clean}")
    all_ok = all(r[1] == "OK" for r in results) and clean
    print(f"\n变异回灌：{sum(1 for r in results if r[1]=='OK')}/{len(results)} 有效红")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
