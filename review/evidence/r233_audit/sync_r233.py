# -*- coding: utf-8 -*-
"""R233 · 六处同步面（143 → 144）两阶段写入
铁律：先在内存改完 + 每个锚点断言「命中数 == 1」，全通过才统一落盘；任一不符 ⇒ 一个文件都不写。
🔴 全程按字节读/写（不翻译行尾），插入文本用各文件自身的 eol。
"""
import io, os, re, sys

R = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
P_VERIFY = os.path.join(R, "verify_all.js")
P_KEY = os.path.join(R, "specs", "dev-specs", "\u2605\u77e5\u8bc6\u5b58\u50a8\u70b9_2026-09-10.md")
P_CASES = os.path.join(R, "tools", "check_suite_assert_counts.js")

files = {}
for p in (P_VERIFY, P_KEY, P_CASES):
    files[p] = io.open(p, "rb").read().decode("utf-8")
EOL = {}
for p, s in files.items():
    EOL[p] = "\r\n" if "\r\n" in s else "\n"

edits = []          # (path, old, new, 说明)


def sub(path, old, new, why):
    edits.append((path, old, new, why))


def nl(path, lines):
    return EOL[path].join(lines)


# ============ ① verify_all.js SUITES 末尾追加 ============
src = files[P_VERIFY]
m = re.search(r"^( *\[)('[^']+',)( +)('tools/check_grade_gate_dual\.js'\],)$", src, re.M)
assert m, "① SUITES 尾行锚点未命中"
indent, name, pad, tail = m.groups()
width = len(name) + len(pad)
newname = "'fn-deps',"
assert len(newname) <= width, "① 名字过长，对齐算不出来"
newline = indent + newname + " " * (width - len(newname)) + "'tools/check_fn_deps.js'],"
sub(P_VERIFY, m.group(0), m.group(0) + nl(P_VERIFY, ["", newline]), "① SUITES 末尾追加 fn-deps")

# ============ ② 头注串联数 ============
sub(P_VERIFY, "// \u4e32\u8054\uff1a143 \u4e2a\u5957\u4ef6",
    "// \u4e32\u8054\uff1a144 \u4e2a\u5957\u4ef6", "② 头注串联 143→144")

# ============ ③ 头注守卫说明段追加一条 ============
A3 = "\u884c\u4e3a\u9762\u300c\u4e00\u4fa7\u52a0 pos \u53e6\u4e00\u4fa7\u6ca1\u52a0\u300d\u21d2 \u5fc5\u987b\u62a5\u5dee\u5f02\uff0c\u4e14\u5dee\u5f02**\u53ea\u843d\u5728 platform \u5224\u522b**\u4e0a\uff09\u300212 \u6761\u65ad\u8a00\uff09"
NEW3 = nl(P_VERIFY, [
    "//       + \u4e91\u51fd\u6570\u5916\u90e8\u4f9d\u8d56\u58f0\u660e\u5b88\u536b\uff08tools/check_fn_deps.js\uff0cR233\uff1a**\u4e91\u7aef\u53ea\u88c5 package.json \u91cc\u58f0\u660e\u7684\u5305** \u21d2",
    "//         \u6f0f\u58f0\u660e\u4e0d\u662f\u62a5\u9519\u800c\u662f**\u5bb9\u5668\u8d77\u4e0d\u6765**\uff08\u524d\u7aef\u53ea\u770b\u5230\u300c\u7f51\u7edc\u4e0d\u53ef\u7528\u300d\u2014\u2014 \u672c\u4ed3 utils/api.js \u91cc\u6bb5 2026-09-20 \u8bca\u65ad\u6ce8\u91ca",
    "//         \u8bb0\u7684\u6b63\u662f\u8fd9\u6b21\u771f\u673a\u4e8b\u6545\uff09\u3002`xlsx`\uff08R181l \u5f15\u5165\u4e8e importSalesBill\uff09\u662f\u5168\u4ed3**\u552f\u4e00**\u975e\u539f\u751f\u4f9d\u8d56 \u21d2 \u8fd9\u4e00\u7c7b\u98ce\u9669\u521a\u53d8\u6d3b\u3002",
    "//         \u5224\u636e = S \u626b\u63cf\u9762\uff08\u542b**\u951a\u70b9** importSalesBill:xlsx\uff0c\u626b\u63cf\u9762\u88ab\u5199\u7a84\u5373\u7ea2\uff09+ A require \u2286 deps\uff08\u6b63\u5411\uff0c\u7f3a\u58f0\u660e\u70b9\u540d\uff09",
    "//         + B deps \u2286 require\uff08\u53cd\u5411\uff0c\u9632\u50f5\u5c38\u4f9d\u8d56\uff09+ C \u5408\u6210\u6837\u672c\u81ea\u8bc1 + \u65ad\u8a00\u6570\u4e0b\u754c\u300212 \u6761\u65ad\u8a00\uff09",
])
sub(P_VERIFY, A3, A3 + EOL[P_VERIFY] + NEW3, "③ 头注补 R233 守卫说明")

# ============ ④ 重启键 §1.1 入口行 ============
sub(P_KEY, "\u4e32 **143** \u4e2a\u5957\u4ef6", "\u4e32 **144** \u4e2a\u5957\u4ef6", "④ 入口行 143→144")

# ============ ⑤ 重启键「套件数会漂」行 ============
sub(P_KEY, "\uff08\u73b0 **143**\uff1b", "\uff08\u73b0 **144**\uff1b", "⑤ 会漂行 143→144")
TAIL5 = "\uff08\u7ed3\u6784\u9762\u4e0e\u884c\u4e3a\u9762\uff0c\u5dee\u5f02\u987b**\u53ea\u843d\u5728 platform \u5224\u522b**\uff09\uff1b12 \u65ad\u8a00\uff09**"
ADD5 = (" \u2192 **144\uff08R233\uff1a\u65b0\u589e `tools/check_fn_deps.js`\uff0c\u4e91\u51fd\u6570\u5916\u90e8\u4f9d\u8d56\u58f0\u660e\u5b88\u536b \u2014\u2014 "
        "\u4e91\u7aef\u53ea\u88c5 package.json \u91cc\u58f0\u660e\u7684\u5305\uff0c\u6f0f\u58f0\u660e\u4e0d\u662f\u62a5\u9519\u800c\u662f\u5bb9\u5668\u8d77\u4e0d\u6765\uff08\u524d\u7aef\u53ea\u663e\u300c\u7f51\u7edc\u4e0d\u53ef\u7528\u300d\uff09\uff1b"
        "\u5224\u636e\uff1dS \u626b\u63cf\u9762\u542b\u951a\u70b9 `importSalesBill:xlsx` / A require \u2286 deps / B deps \u2286 require / C \u5408\u6210\u6837\u672c\u81ea\u8bc1\uff1b12 \u65ad\u8a00\uff09**")
sub(P_KEY, TAIL5, TAIL5 + ADD5, "⑤ 演进链尾追加 144")

# ============ ⑥ 断言数声明行 ============
sub(P_KEY, "`check_grade_gate_dual`=12\uff08**\u4e94\u5341\u56db\u8005**",
    "`check_grade_gate_dual`=12 / `check_fn_deps`=12\uff08**\u4e94\u5341\u4e94\u8005**", "⑥ 声明行加 key + 计数+1")

# ============ ⑦ CASES ============
A7 = "  { key: 'check_grade_gate_dual', rel: 'tools/check_grade_gate_dual.js' }, // 12 \u6761\uff08S1~3 + A1~3 + B1~2 + C1~4\uff09"
NEW7 = "  { key: 'check_fn_deps', rel: 'tools/check_fn_deps.js' }, // 12 \u6761\uff08S1~3 + A1~4 + B1 + C1~4\uff09"
sub(P_CASES, A7, A7 + nl(P_CASES, ["", NEW7]), "⑦ CASES 加 check_fn_deps")

# ============ 两阶段：先全校验，再统一落盘 ============
new_content = dict(files)
report = []
ok = True
for path, old, new, why in edits:
    s = new_content[path]
    cnt = s.count(old)
    report.append((why, cnt))
    if cnt != 1:
        ok = False
    else:
        new_content[path] = s.replace(old, new, 1)

print("=== 锚点命中校验 ===")
for why, cnt in report:
    print("  %-34s 命中 %d %s" % (why, cnt, "OK" if cnt == 1 else "<== \u5f02\u5e38\uff0c\u6574\u4f53\u505c\u624b"))
if not ok:
    print("\n\u274c \u6709\u951a\u70b9\u672a\u552f\u4e00\u547d\u4e2d \u21d2 **\u4e00\u4e2a\u6587\u4ef6\u90fd\u672a\u5199**")
    sys.exit(2)

for path, s in new_content.items():
    io.open(path, "wb").write(s.encode("utf-8"))
    print("\u2705 \u5df2\u5199 %s" % os.path.relpath(path, R))
print("\n\u5168\u90e8\u843d\u76d8\u5b8c\u6210")
