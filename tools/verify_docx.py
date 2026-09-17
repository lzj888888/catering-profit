#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tools/verify_docx.py —— 派生件 .docx 内容自检（R12/R26 的机械化防线）

用途：仓库根的 .md 是单源，同名 .txt/.docx/.pdf 都是派生件。门禁 A–L 只扫 .md/.txt/.js，
      .docx 是二进制、门禁守不到 —— 于是"docx 里装着已被否定的旧结论"这种事只能靠人眼，
      2026-09-15 就真的发生过（新手上云操作手册.docx 里仍有「9 个 unique」+「A7 成立」+ `__probe`）。

做法：用 python-docx 结构化提取（段落 + 表格单元格，跨 run 自动合并 —— 比 grep 原始 XML 可靠，
      后者会因 docx 把文本切成 run 而漏报），再对旧串/新串做断言。

用法：
    python tools/verify_docx.py                 # 默认查三份交付文档
    python tools/verify_docx.py a.docx b.docx   # 指定文件（此时只报旧串，不校验新串）

依赖：pip install python-docx
退出码：0 = 通过；1 = 有旧串残留或缺新串；3 = 缺依赖/文件
"""
import os
import sys

# 这些串一旦出现在派生件里，就说明"派生件落后于单源"（都对应已修复的真实缺陷）
OLD_STRINGS = [
    "A7 成立",            # R1：A7 已被 2026-09-14 云端实测否定（不支持代码建索引）
    "9 个 unique",        # R1：实为 10 条 unique 索引
    "30 条索引",          # R1：早期旧值（索引计数的**当前值**以 tools/check_schema_sync.js 的 S4 为准）
    "__probe",            # R2：违规集合名（不得以 _ 开头），已改名 probe_tmp
    "判据④唯一未完项",     # R14：dev 侧已闭环，仅剩 prod
    "第 14–15 行",         # R14：env.js 真值在第 16/17 行
    "env.js:14-15",       # R16：同上
    "8 套件",              # R21：套件数的历史旧值（当前值见 verify_all.js 头部注释，已有 guardSuiteCount 自校验）
    "8 个套件",            # R21：同上
]

# 针对具体文档的"必须存在"新串（缺了说明派生件没跟上单源）
EXPECT = {
    # ⚠️ Runbook 里的「39 条索引」是 2026-09-14 实测的**历史快照**（描述当日 initDb 全部报
    #    `createIndex is not a function` 的那一次），**不是**对当前计数的声明 ⇒ 此处保留原文。
    #    当前计数（40 条 / 其中 10 条 unique）由 `tools/check_schema_sync.js` 的 S4 机械守着
    #    —— 该文件的 EXPECT 不再是对计数的唯一守卫，计数漂移别只改这里。
    "SMOKETEST_RUNBOOK": ["39 条索引", "probe_tmp", "派生件"],
    "新手上云操作手册": ["40 条索引", "probe_tmp", "派生件"],
    "下一步工序清单": ["40 条索引", "派生件"],
}

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


def main(argv):
    args = argv[1:]
    explicit = bool(args)
    bases = []
    if explicit:
        paths = args
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

        for s in OLD_STRINGS:
            n = txt.count(s)
            if n:
                bad += n
                print("   ❌ 旧串残留 [%d] %s" % (n, s))
        if not explicit:
            for s in EXPECT.get(base, []):
                if s not in txt:
                    bad += 1
                    print("   ❌ 缺新串 %s" % s)
        print("   （旧串检查完毕）" if not bad else "")

    print("")
    if bad:
        print("❌ 派生件检查失败：%d 处 —— 说明 .docx 落后于同名 .md，请重生成："
              "python tools/md2docx_portrait.py <in.md> <out.docx> <标题>" % bad)
    else:
        print("✅ 派生件 .docx 无旧串残留、必备新串齐全（%d 份）" % len(paths))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
