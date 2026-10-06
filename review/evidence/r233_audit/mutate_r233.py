# -*- coding: utf-8 -*-
"""R233 · 变异回灌：证明 tools/check_fn_deps.js 不是假绿
铁律：每条独立 / 锚点命中须 == 1 / 该红者必须**点名到目标断言** / 该绿者必须整体为绿 /
      纯内存字节备份（不落临时文件，避本机批量删除守卫）/ 末尾字节级还原并复跑。
"""
import subprocess, os, re, sys

R = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
NODE = r"C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
GUARD = os.path.join(R, "tools", "check_fn_deps.js")

A = os.path.join(R, "cloudfunctions", "importSalesBill", "service.js")
B = os.path.join(R, "cloudfunctions", "importSalesBill", "package.json")
C = os.path.join(R, "cloudfunctions", "calcBom", "package.json")
D = os.path.join(R, "cloudfunctions", "calcBom", "service.js")
E = GUARD

TARGETS = {"A": A, "B": B, "C": C, "D": D, "E": E}
BASE = {}
for k, p in TARGETS.items():
    BASE[k] = open(p, "rb").read()


def read(k):
    return BASE[k].decode("utf-8")


def write_text(k, s):
    data = s.encode("utf-8")            # 先 encode 再开 wb（防报错时文件停在 0 字节）
    with open(TARGETS[k], "wb") as f:
        f.write(data)


def reset():
    for k, p in TARGETS.items():
        with open(p, "wb") as f:
            f.write(BASE[k])


def run():
    r = subprocess.run([NODE, GUARD], capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    failed = [l for l in out.splitlines() if l.strip().startswith("\u274c")]
    has_sum = re.search(r"\d+ \u901a\u8fc7 / \d+ \u5931\u8d25", out) is not None
    crashed = (r.returncode != 0) and not has_sum
    return failed, crashed, r.returncode


def sub1(k, old, new):
    """字面替换 + 强制锚点唯一命中（命中 != 1 即 fail-closed，整条不写）。"""
    s = BASE[k].decode("utf-8")
    n = s.count(old)
    if n != 1:
        raise RuntimeError("\u951a\u70b9\u547d\u4e2d %d \u6b21\uff08\u987b\u6070\u4e3a 1\uff09: %s" % (n, old[:60]))
    write_text(k, s.replace(old, new, 1))


TXT_XLSX_REQ = "const XLSX = require('xlsx');"
TXT_XLSX_DEP = '    "wx-server-sdk": "~2.6.3",\n    "xlsx": "^0.18.5"\n'
TXT_XLSX_DEP_NEW = '    "wx-server-sdk": "~2.6.3"\n'
TXT_CB_DEPS = '  "dependencies": {\n    "wx-server-sdk": "~2.6.3"\n  }'
TXT_CB_DEPS_EMPTY = '  "dependencies": {}'
TXT_CB_DEPS_EXTRA = '  "dependencies": {\n    "wx-server-sdk": "~2.6.3",\n    "lodash": "^4.17.21"\n  }'
TXT_CB_DEPS_VER = TXT_CB_DEPS.replace("~2.6.3", "2.6.3")
TXT_CB_L1 = "// cloudfunctions/calcBom/service.js \u2014\u2014 \u6279\u6b21 3 \u00b7 POC2 BOM \u4e24\u5c42 + \u5feb\u7167\u6210\u672c\uff08Service \u5c42\u7eaf\u5f15\u64ce\uff0c\u672c\u6279\u6838\u5fc3\u951a\u70b9\uff09"
TXT_MIN_FN = "const MIN_FN = 40;"

MUTATIONS = [
    # ---- 组 A：该红（且必须点名到目标断言）----
    ("MA1 \u5220 importSalesBill \u7684 xlsx require\uff08\u951a\u70b9\u6d88\u5931\uff09", "A", TXT_XLSX_REQ, "// xlsx require \u5df2\u5220\uff08\u53d8\u5f02\uff09", "S-\u2462"),
    ("MA2 \u4ece importSalesBill \u4f9d\u8d56\u91cc\u5220 xlsx\uff08\u672a\u58f0\u660e\uff09", "B", TXT_XLSX_DEP, TXT_XLSX_DEP_NEW, "A-\u2462"),
    ("MA3 calcBom \u4f9d\u8d56\u6e05\u7a7a\uff08wx-server-sdk \u4e5f\u6ca1\u4e86\uff09", "C", TXT_CB_DEPS, TXT_CB_DEPS_EMPTY, "A-\u2462"),
    ("MA4 calcBom \u591a\u58f0\u660e lodash\uff08\u50f5\u5c38\u4f9d\u8d56\uff09", "C", TXT_CB_DEPS, TXT_CB_DEPS_EXTRA, "B-\u2460"),
    ("MA5 calcBom \u65b0\u589e require('left-pad')\uff08\u672a\u58f0\u660e\uff09", "D", TXT_CB_L1, "const LP = require('left-pad');\n" + TXT_CB_L1, "A-\u2462"),
    ("MA6 \u4e0b\u754c\u6539\u5927 MIN_FN 40\u21929999\uff08\u8bc1\u4e0b\u754c\u975e\u6052\u771f\uff09", "E", TXT_MIN_FN, "const MIN_FN = 9999;", "S-\u2460"),
    # ---- 组 B：该绿（等价改写 / 无害改动）----
    ("MB1 \u7248\u672c\u53f7\u683c\u5f0f\u7b49\u4ef7\u6539\u5199 ~2.6.3\u21922.6.3", "C", TXT_CB_DEPS, TXT_CB_DEPS_VER, None),
    ("MB2 \u6ce8\u91ca\u91cc\u5199 require('ghost-pkg')\uff08\u5e94\u88ab\u5265\u6389\uff09", "D", TXT_CB_L1, "// \u53cd\u4f8b\uff1a\u6ce8\u91ca\u91cc\u7684 require('ghost-pkg') \u4e0d\u5f97\u7b97\u6570\n" + TXT_CB_L1, None),
]


def main():
    reset()
    f, c, rc = run()
    if f or c:
        print("\u274c \u57fa\u7ebf\u4e0d\u7eff\uff0c\u5148\u4fee\u57fa\u7ebf", f[:3], c)
        return 1
    print("\u2705 \u57fa\u7ebf\u5168\u7eff\uff08RC=0\uff09")

    miss = []
    for name, key, old, new, expect in MUTATIONS:
        reset()
        try:
            sub1(key, old, new)
        except RuntimeError as e:
            print("SKIP %-52s %s" % (name, e))
            miss.append(name)
            continue
        failed, crashed, rc = run()
        if expect is None:
            ok = (not failed) and (not crashed) and rc == 0
            print("%-56s \u274c=%-2d %s" % (name, len(failed), "\u2705\u5982\u671f\u7eff" if ok else "\u274c\u5047\u7ea2\uff01"))
            print("         \u5931\u8d25\u884c: %s" % (failed[:2] if failed else "\u65e0"))
        else:
            named = any(expect in l for l in failed)
            ok = (bool(failed) or crashed) and named
            print("%-56s \u274c=%-2d \u76ee\u6807\u65ad\u8a00 %s %s" % (
                name, len(failed), expect, "\u2705\u70b9\u540d\u5230" if named else "\u274c\u672a\u70b9\u540d"))
            print("         \u5931\u8d25\u884c: %s" % (failed[:2] if failed else "\u65e0\uff08\u5d29\u6e83=%s\uff09" % crashed))
        if not ok:
            miss.append(name)

    reset()
    af, ac, arc = run()
    ok_back = (not af) and (not ac) and arc == 0
    print("\n\u8fd8\u539f\u540e \u274c=%d crash=%s RC=%d %s" % (len(af), ac, arc, "\u2705\u56de\u7eff" if ok_back else "\u274c\u6ca1\u56de\u7eff"))

    # 字节级还原自证
    same = all(open(TARGETS[k], "rb").read() == BASE[k] for k in TARGETS)
    print("\u5b57\u8282\u7ea7\u8fd8\u539f\u81ea\u8bc1\uff1a%s" % ("\u2705 \u9010\u5b57\u8282\u76f8\u7b49" if same else "\u274c \u4e0d\u7b49"))
    print("\n=== \u56de\u704c\u6c47\u603b\uff1a\u53d8\u5f02 %d \u6761 / \u672a\u8fbe\u671f %d %s ===" % (len(MUTATIONS), len(miss), miss))
    return 0 if (not miss and ok_back and same) else 1


sys.exit(main())
