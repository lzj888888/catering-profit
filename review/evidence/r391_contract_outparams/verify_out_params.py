# -*- coding: utf-8 -*-
"""R391 · 出参契约「双面判据」校验（代码真回了 且 文档真声明了）。

为什么要有这一步：
  R389 的扫描是「代码有、文档没有」的单面扫描 —— 它只能发现漂移，不能阻止
  「为了让守卫变绿而在文档里凭空补一个代码根本没回过的键」（反向漂移）。
  所以这里对每一组标记做两件事：
    ① 在 cloudfunctions/<fn>/index.js 的 ok({...}) 顶层键里**实扫**得到它（证明代码真回）；
    ② 在契约文档该行的出参列里找得到它（证明文档真声明）。
  两面都过才算过。任一面缺失即 exit 1（fail-closed）。

用法：python review/evidence/r390_contract_outparams/verify_out_params.py
不放 tools/：这是**一次性取证**，不是常驻门禁（R389 NOTE §5 已论证
「出参键 ⊆ 文档列」的全量守卫误报 24/30，不值得进 SUITES）。
"""
import os
import sys
import json

def _find_repo(start):
    """从脚本所在目录往上找仓根（判据 = verify_all.js 存在），避免硬编码层级。"""
    d = start
    for _ in range(8):
        if os.path.exists(os.path.join(d, "verify_all.js")):
            return d
        nd = os.path.dirname(d)
        if nd == d:
            break
        d = nd
    return start


REPO = _find_repo(os.path.dirname(os.path.abspath(__file__)))
DOC_REL = "specs/dev-specs/core/10_云函数清单与接口契约.md"
# 反恒真用：允许指向一份临时改坏的文档副本（R391_DOC 只在取证时用，不设进仓默认值）
DOC_OVERRIDE = os.environ.get("R391_DOC", "")

# 本轮 7 组「fail-soft / 覆盖度 / 截断」标记 + R389 已修的 1 组 + 复核 2 组
GROUPS = {
    "getDishReview": ["truncated", "coverageA", "coverageC", "unmatched"],
    "getSalesBills": ["truncated", "summary"],
    "getShopContext": ["no_shop"],
    "manageShop": ["replayed"],
    "importSalesBill": ["platform_missing", "dup"],
    "exportData": ["format", "encoding", "content"],
    "saveCostCard": ["deleted"],
    "saveMaterial": ["deleted"],
    "getCostCard": ["truncated"],
}
NON_IDENT = {"true", "false", "null", "undefined", "return"}


def strip_comments(src):
    """剥 // 与 /* */ 注释（保留字符串字面量），注释不剥会让判据被注释喂成恒真。"""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            if j < 0:
                break
            i = j + 2
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            if j < 0:
                break
            i = j
            continue
        if c in "\"'`":
            q = c
            out.append(c)
            i += 1
            while i < n:
                if src[i] == "\\":
                    out.append(src[i:i + 2])
                    i += 2
                    continue
                out.append(src[i])
                if src[i] == q:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _skip_string(s, i):
    """i 指向引号，返回字符串结束后的下标。"""
    q = s[i]
    i += 1
    n = len(s)
    while i < n:
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == q:
            return i + 1
        i += 1
    return n


def top_keys(s, start):
    """s[start] 必须是 '{'，返回该对象字面量的顶层键集合（含简写键，不含展开）。"""
    keys = set()
    depth = 0
    i = start
    n = len(s)
    while i < n:
        c = s[i]
        if c in "\"'`":
            i = _skip_string(s, i)
            continue
        if c == "{":
            depth += 1
            i += 1
            continue
        if c == "}":
            depth -= 1
            i += 1
            if depth == 0:
                return keys
            continue
        if c == "(":
            d = 1
            i += 1
            while i < n and d > 0:
                ch = s[i]
                if ch in "\"'`":
                    i = _skip_string(s, i)
                    continue
                if ch == "(":
                    d += 1
                elif ch == ")":
                    d -= 1
                i += 1
            continue
        if depth == 1 and (c.isalpha() or c in "_$"):
            j = i
            while j < n and (s[j].isalnum() or s[j] in "_$"):
                j += 1
            ident = s[i:j]
            k = j
            while k < n and s[k] in " \t\r\n":
                k += 1
            is_key = False
            if k < n and s[k] == ":":
                # ':' 也可能是三元分支（x: a ? true : false）⇒ 排除关键字与纯数字
                is_key = ident not in NON_IDENT
                # 再排一层：前一个非空字符是 '?' 或 ':' ⇒ 是三元的分支值，不是键
                p = i - 1
                while p >= 0 and s[p] in " \t\r\n":
                    p -= 1
                if p >= 0 and s[p] in "?:":
                    is_key = False
            elif k < n and s[k] in ",}":
                is_key = ident not in NON_IDENT
                p = i - 1
                while p >= 0 and s[p] in " \t\r\n":
                    p -= 1
                if p >= 0 and s[p] == ".":  # 展开 ...x ⇒ 值不是键
                    is_key = False
            if is_key:
                keys.add(ident)
            i = j
            continue
        i += 1
    return keys


def emitted_keys(fn):
    p = os.path.join(REPO, "cloudfunctions", fn, "index.js")
    if not os.path.exists(p):
        return None
    s = strip_comments(open(p, encoding="utf-8").read())
    keys = set()
    start = 0
    while True:
        k = s.find("ok(", start)
        if k < 0:
            break
        start = k + 3
        # ok( 必须是调用而不是别的标识符尾巴
        if k > 0 and (s[k - 1].isalnum() or s[k - 1] in "_$."):
            continue
        j = k + 3
        while j < len(s) and s[j] in " \t\r\n":
            j += 1
        if j < len(s) and s[j] == "{":
            keys |= top_keys(s, j)
    return keys


def _split_row(line):
    """按**未转义**的 '|' 切表格行。

    为什么不能直接 split('|')：契约表里出参列会用 `\\|` 转义竖线
    （如 `takeaway{...}\\|null`），朴素 split 会把一行拆成 7 段 ⇒ 取错列
    ⇒ 首版判据把 getDishReview/getSalesBills 误判成「文档没声明」（假红）。
    """
    cols = []
    buf = []
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        if c == "\\" and i + 1 < n and line[i + 1] == "|":
            buf.append("|")
            i += 2
            continue
        if c == "|":
            cols.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    cols.append("".join(buf))
    return cols


def doc_brace_keys(col):
    """取出出参列里**声明位**上出现过的标识符：花括号内的键 + 紧贴 `{` 前的名字。

    为什么要管"紧贴 `{` 前的名字"：契约里子对象写成 `coverageA{pct}` / `summary{...}`
    —— `coverageA`/`summary` 本身就在括号**外**。首版只取括号内 ⇒ 把这两个真声明
    误判成"没声明"（假红）。

    为什么必须限定在声明位：出参列同时含解释散文，而散文里会为了讲清后果
    再次提到键名（如"`no_shop` 恒存在"）。若按整列子串判，删掉声明、留下散文
    仍会判过 ⇒ 判据被自己的解释喂成恒真（本仓踩过的第三种恒真形态）。
    """
    keys = set()
    depth = 0
    buf = []
    n = len(col)
    for idx, ch in enumerate(col):
        if ch == "{":
            # 回到 { 前面取紧贴的名字
            j = idx - 1
            while j >= 0 and col[j] in " \t":
                j -= 1
            k = j
            while k >= 0 and (col[k].isalnum() or col[k] in "_$"):
                k -= 1
            name = col[k + 1:j + 1]
            if name:
                keys.add(name)
            depth += 1
            continue
        if ch == "}":
            if buf:
                keys.add("".join(buf))
                buf = []
            depth = max(0, depth - 1)
            continue
        if depth > 0:
            if ch.isalnum() or ch in "_$":
                buf.append(ch)
            elif buf:
                keys.add("".join(buf))
                buf = []
    if buf:
        keys.add("".join(buf))
    return keys


def doc_out_col(fn):
    path = DOC_OVERRIDE or os.path.join(REPO, DOC_REL)
    doc = open(path, encoding="utf-8").read()
    needle = "| `" + fn + "`"
    for line in doc.splitlines():
        if line.startswith(needle):
            cols = _split_row(line)
            # cols[0]=='' , cols[1]==' `fn` ', cols[2]=用途, cols[3]=入参, cols[4]=出参
            if len(cols) >= 5:
                return cols[4]
            return ""
    return None


def main():
    rows = []
    ok_all = True
    for fn in GROUPS:
        em = emitted_keys(fn)
        col = doc_out_col(fn)
        if em is None:
            print("[MISS] cloudfunctions/%s/index.js 不存在" % fn)
            ok_all = False
            continue
        if col is None:
            print("[MISS] 契约文档缺 %s 行" % fn)
            ok_all = False
            continue
        doc_keys = doc_brace_keys(col)
        if not doc_keys:
            print("[MISS] %s 行的出参列里没有任何花括号键清单 ⇒ 判据无法成立" % fn)
            ok_all = False
            continue
        for key in GROUPS[fn]:
            in_code = key in em
            in_doc = key in doc_keys
            good = in_code and in_doc
            if not good:
                ok_all = False
            rows.append({
                "fn": fn, "key": key, "code_emits": in_code, "doc_declares": in_doc, "pass": good,
            })
            print("  %-16s %-16s code=%-5s doc=%-5s %s"
                  % (fn, key, "Y" if in_code else "N", "Y" if in_doc else "N",
                     "OK" if good else "FAIL"))
    outdir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(outdir, "result.json"), "w", encoding="utf-8") as f:
        json.dump({"pass": ok_all, "rows": rows}, f, ensure_ascii=False, indent=2)
    total = len(rows)
    passed = sum(1 for r in rows if r["pass"])
    print("-" * 60)
    # 自失效护栏：一行都没检查到（文件被改名/表格被重排）不得判绿
    if total == 0:
        print("自失效护栏：本次 0 行可判 ⇒ FAIL（空跑不得绿）")
        return 2
    print("双面判据：%d/%d 通过  ⇒ %s" % (passed, total, "PASS" if ok_all else "FAIL"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
