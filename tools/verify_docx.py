#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tools/verify_docx.py —— 派生件 .docx 内容自检（R12/R26 的机械化防线）

用途：仓库根的 .md 是单源，同名 .txt/.docx/.pdf 都是派生件。门禁 A–L 只扫 .md/.txt/.js，
      .docx 是二进制、门禁守不到 —— 于是"docx 里装着已被否定的旧结论"这种事只能靠人眼，
      2026-09-15 就真的发生过（新手上云操作手册.docx 里仍有「9 个 unique」+「A7 成立」+ `__probe`）。

做法：用 python-docx 结构化提取（段落 + 表格单元格，跨 run 自动合并 —— 比 grep 原始 XML 可靠，
      后者会因 docx 把文本切成 run 而漏报），再对旧串/新串做断言。

⚠️ R75（2026-09-17）：**计数类期望值一律从「同名 .md」派生，本文件里不写死任何计数。**
   原因：写死的期望值本身就是**第三份漂移副本** —— 它既不在门禁扫描面内，也不在
   `tools/check_schema_sync.js` 的 S4 扫描面内（R74 落地时只做到"改注释提醒"，而**提醒 ≠ 机械**）。
   现在链条闭合：`collections.js` ==(check_schema_sync S4)== `.md` ==(本脚本)== `.docx`
   ⇒ 计数只活在 `collections.js` 一处。实现见 COUNT_RES + derived_counts()。

   ⚠️ 新增计数类断言时**不要再写数字**：
     · 能派生的 → 往 COUNT_RES 里加一行模式（本文件自动双向比对）；
     · 不能派生的 → 登记进 S4 的扫描面（`tools/check_schema_sync.js`）。
   后者由 S4 的一条断言机械守着：「本文件内不得出现写死的计数期望值」（出现即判红）。

用法：
    python tools/verify_docx.py                 # 默认查三份交付文档
    python tools/verify_docx.py a.docx b.docx   # 指定文件（此时只报旧串，不校验新串/不派生）

依赖：pip install python-docx
退出码：0 = 通过；1 = 有旧串残留、缺新串、或计数与同名 .md 不一致；3 = 缺依赖/文件
"""
import os
import re
import sys

# 这些串一旦出现在派生件里，就说明"派生件落后于单源"（都对应已修复的真实缺陷）。
# ⚠️ 这里**只放非计数类**的具体旧串 —— 计数类改由下面「docx 的计数集合必须 ≡ 同名 .md 的计数集合」
#    统一守（覆盖**任意**陈旧计数，比逐个列举具体旧值更强）。故 R1 记的那条「早期旧值」
#    已移除：该规则对"docx 停在任何旧值"都判红，不再依赖人去补列表（R75）。
#    ⚠️ 本文件（含注释）**不得出现任何写死的计数**，由 `tools/check_schema_sync.js` 的 S4 断言机械守着。
OLD_STRINGS = [
    "A7 成立",            # R1：A7 已被 2026-09-14 云端实测否定（不支持代码建索引）
    "9 个 unique",        # R1：实为 10 条 unique 索引
    "__probe",            # R2：违规集合名（不得以 _ 开头），已改名 probe_tmp
    "判据④唯一未完项",     # R14：dev 侧已闭环，仅剩 prod
    "第 14–15 行",         # R14：env.js 真值在第 16/17 行
    "env.js:14-15",       # R16：同上
    "8 套件",              # R21：套件数的历史旧值（当前值见 verify_all.js 头部注释，已有 guardSuiteCount 自校验）
    "8 个套件",            # R21：同上
]

# 针对具体文档的"必须存在"的**非计数类**新串（缺了说明派生件没跟上单源）
# ⚠️ 计数类新串（如索引总数、unique 条数）**不在这里** —— 见 COUNT_RES 的派生比对。
#    特例说明：`SMOKETEST_RUNBOOK.md` 里的索引计数是 2026-09-14 实测的**历史快照**，
#    按本机制它只需与其**同名 .md 自身**一致（两侧同为快照值）⇒ 无需任何特例豁免。
EXPECT = {
    "SMOKETEST_RUNBOOK": ["probe_tmp", "派生件"],
    "新手上云操作手册": ["probe_tmp", "派生件"],
    "下一步工序清单": ["派生件"],
}

# 计数类期望值的**提取模式**（R75）：从同名 .md 取"期望"、从 .docx 取"实测"，两侧集合必须**相等**。
#   集合相等 = 双向断言：
#     · md 有而 docx 无 ⇒ 派生件没跟上单源（红）
#     · docx 有而 md 无 ⇒ 残留旧计数（红）
COUNT_RES = [
    re.compile(r"(\d+)\s*条索引"),         # 索引总数
    re.compile(r"(\d+)\s*条是\s*unique"),  # unique（唯一）索引条数
]

DEFAULT_DOCS = ["SMOKETEST_RUNBOOK", "新手上云操作手册", "下一步工序清单"]

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def extract(path):
    """结构化提取 docx 文本：段落 + 表格单元格（含嵌套表）"""
    try:
        from docx import Document
    except Exception as e:  # pragma: no cover
        print("缺少依赖 python-docx：%s" % e)
        print("请先执行：python -m pip install python-docx")
        sys.exit(3)
    doc = Document(path)
    parts = [p.text for p in doc.paragraphs]

    def walk_tables(tables):
        for t in tables:
            for row in t.rows:
                for cell in row.cells:
                    parts.append(cell.text)
                    walk_tables(cell.tables)

    walk_tables(doc.tables)
    return "\n".join(parts)


def counts_of(text):
    """按 COUNT_RES 提取文本里的全部计数（字符串集合，便于直接比对/打印）"""
    out = set()
    for rx in COUNT_RES:
        out.update(rx.findall(text))
    return out


def derived_counts(md_path):
    """从同名 .md（该 .docx 的直接单源）派生计数期望；文件不存在 ⇒ None（调用方判红，fail-closed）"""
    if not os.path.exists(md_path):
        return None
    with open(md_path, encoding="utf-8") as fh:
        return counts_of(fh.read())


def main(argv):
    args = argv[1:]
    explicit = bool(args)
    bases = []
    if explicit:
        paths = args
        root = os.getcwd()
    else:
        # 默认从"脚本所在仓库根"找三份文档；找不到再退到当前工作目录
        # （便于在本机任意位置直接跑，也便于换机器时用 cwd 指定）
        root = REPO
        if not all(os.path.exists(os.path.join(root, b + ".docx")) for b in DEFAULT_DOCS):
            if all(os.path.exists(os.path.join(os.getcwd(), b + ".docx")) for b in DEFAULT_DOCS):
                root = os.getcwd()
        print("仓库根 = %s" % root)
        paths = [os.path.join(root, b + ".docx") for b in DEFAULT_DOCS]
        bases = DEFAULT_DOCS

    bad = 0
    for i, path in enumerate(paths):
        if not os.path.exists(path):
            print("❌ 缺文件：%s" % path)
            bad += 1
            continue
        name = os.path.basename(path)
        base = os.path.splitext(name)[0]
        txt = extract(path)
        print("===== %s（提取 %d 字符）=====" % (name, len(txt)))

        doc_bad = 0
        for s in OLD_STRINGS:
            n = txt.count(s)
            if n:
                doc_bad += n
                print("   ❌ 旧串残留 [%d] %s" % (n, s))
        if not explicit:
            for s in EXPECT.get(base, []):
                if s not in txt:
                    doc_bad += 1
                    print("   ❌ 缺新串 %s" % s)

            # ---- R75：计数类期望值从同名 .md 派生，双向比对 ----
            md_path = os.path.join(root, base + ".md")
            exp = derived_counts(md_path)
            if exp is None:
                doc_bad += 1
                print("   ❌ 缺同名 .md，无法派生计数期望：%s" % os.path.basename(md_path))
            else:
                got = counts_of(txt)
                print("   计数比对（派生）：md=%s  docx=%s" % (sorted(exp), sorted(got)))
                missing = sorted(exp - got)
                stale = sorted(got - exp)
                if missing:
                    doc_bad += len(missing)
                    print("   ❌ 计数缺失（.md 有、docx 无 ⇒ 派生件没跟上）：%s" % ", ".join(missing))
                if stale:
                    doc_bad += len(stale)
                    print("   ❌ 陈旧计数（docx 有、.md 无 ⇒ 停在旧值）：%s" % ", ".join(stale))
        bad += doc_bad
        print("   %s" % ("✅ 无旧串残留、必备新串与计数均一致" if doc_bad == 0 else ""))

    print("")
    if bad:
        print("❌ 派生件检查失败：%d 处 —— 说明 .docx 落后于同名 .md，请重生成："
              "python tools/md2docx_portrait.py <in.md> <out.docx> <标题>" % bad)
    else:
        print("✅ 派生件 .docx 无旧串残留、必备新串齐全、计数与同名 .md 一致（%d 份）" % len(paths))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
