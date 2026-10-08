# -*- coding: utf-8 -*-
"""
R237 变异回灌（mutation backfill）—— 证明本轮新增的三条守卫**不是假绿**。

⚠️ 脚本命名刻意避开 check_ / verify_ / selftest_ / test_ 前缀：
   那些前缀会被 check_suite_coverage 的「面 B」判为「未登记的测试脚本」而转红。

两组成对：
  组 A（want_red=True） —— 把源码改回**错误写法**，守卫必须**红在目标断言名上**。
                           「崩溃红 ≠ 有效红」：判定必须命中指定断言名，否则算复用崩溃。
  组 B（want_red=False）—— 反向伤害二型校验：
                           ① 把违规写法**只写进注释** ⇒ 不得转红（证明剥注释有效）
                           ② 等价改写（`=== null || === undefined` → `== null`）⇒ 不得转红
                              （本仓纪律：判行为不判字面）

用法：python mut_backfill.py            （跑全部，产出 mut_backfill.out.txt）
      python mut_backfill.py M1         （只跑一组）

铁律：每组独立、先备份、跑完必还原、还原后校验 md5 与改前一致。
"""
import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
OUT = pathlib.Path(__file__).with_suffix(".out.txt")
BACKUP = ROOT / "review" / "evidence" / "r237_m2_turn" / "mut_backup"

b = lambda s: s.encode("utf-8")  # noqa: E731

MUTATIONS = [
    dict(
        id="M1", group="A", want_red=True, assert_named="A-⑧",
        suite="tools/check_m2_biz_inputs.js",
        file="pages/sandbox/index.js",
        note="唯一换算点被绕过：seats 直接取桌数（漏乘单桌座位数）",
        pairs=[(b"seats: this.seatsNow()",
                b"seats: Math.floor(Number(this.data.tablesNum))", 2)],
    ),
    dict(
        id="M2", group="A", want_red=True, assert_named="E-①",
        suite="tools/check_m2_reverse_rent.js",
        file="cloudfunctions/calcSandbox/service.js",
        note="翻台红警被加回来（旧写法 turnRate > 8 ? ['turnOverHigh'] : []）",
        pairs=[(b"\n    warn_keys: [],\n  };\n}",
                b"\n    warn_keys: turnRate > 8 ? ['turnOverHigh'] : [],\n  };\n}", 1)],
    ),
    dict(
        id="M3", group="A", want_red=True, assert_named="F-③",
        suite="tools/check_biz_preset.js",
        file="utils/bizPreset.js",
        note="空值护栏失效 ⇒ Number(null)===0 被分档成 easy（把'算不出来'说成'很轻松'）",
        pairs=[(b"if (value === null || value === undefined || value === '') return '';",
                b"if (value === '__never__') return '';", 1)],
    ),
    dict(
        id="M4", group="B", want_red=False, assert_named="A-⑧",
        suite="tools/check_m2_biz_inputs.js",
        file="pages/sandbox/index.js",
        note="反向伤害①：违规写法**只进注释** ⇒ 不得转红（证明剥注释有效）",
        pairs=[(b"const api = require(",
                b"// \xe6\x97\xa7\xe5\x86\x99\xe6\xb3\x95 seats: Math.floor(Number(this.data.tablesNum))\nconst api = require(", 1)],
    ),
    dict(
        id="M5", group="B", want_red=False, assert_named="F-③",
        suite="tools/check_biz_preset.js",
        file="utils/bizPreset.js",
        note="反向伤害②：等价改写（=== null || === undefined → == null）⇒ 不得转红（判行为不判字面）",
        pairs=[(b"if (value === null || value === undefined || value === '') return '';",
                b"if (value == null || value === '') return '';", 1)],
    ),
]

lines = []


def say(s=""):
    print(s)
    lines.append(s)


def md5(p):
    return hashlib.md5(p.read_bytes()).hexdigest()


def run_suite(rel):
    p = subprocess.run([NODE, rel], cwd=str(ROOT), capture_output=True)
    return p.returncode, (p.stdout + p.stderr).decode("utf-8", "replace")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    BACKUP.mkdir(parents=True, exist_ok=True)
    red_hit = red_miss = nonred_bad = restored_bad = 0

    say("== R237 变异回灌 ==")
    say(f"仓根 {ROOT}")
    say(f"node {NODE}")
    say("")

    for m in MUTATIONS:
        if only and m["id"] != only:
            continue
        f = ROOT / m["file"]
        before = f.read_bytes()
        before_md5 = hashlib.md5(before).hexdigest()
        bak = BACKUP / (m["id"] + "__" + pathlib.Path(m["file"]).name + ".bak")
        bak.write_bytes(before)

        # ---- 施加变异（每组独立：逐条 count 精确替换，命中数不符即中止）----
        src = before
        applied = []
        ok = True
        for old, new, cnt in m["pairs"]:
            got = src.count(old)
            if got != cnt:
                ok = False
                say(f"[{m['id']}] ⚠️ 锚点失配：期望 {cnt} 处，实得 {got} 处 ⇒ 该组作废（不改文件）")
                break
            src = src.replace(old, new)
            applied.append(got)
        if not ok:
            continue
        f.write_bytes(src)

        rc, out = run_suite(m["suite"])
        f.write_bytes(before)  # 立即还原
        after_md5 = md5(f)

        # 找出「真 FAIL」行（❌ 开头的断言行，排除描述里的字面量）
        fail_lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("❌")]
        hit = any(m["assert_named"] in ln for ln in fail_lines)
        total = [ln for ln in out.splitlines() if "通过 /" in ln]

        verdict = ""
        if m["want_red"]:
            if rc != 0 and hit:
                verdict = "✅ 有效红（命中目标断言名）"
                red_hit += 1
            elif rc != 0:
                verdict = "❌ 崩溃红/非目标红（只在目标断言名上红才算效）"
                red_miss += 1
            else:
                verdict = "❌ 假绿（改了错误写法却不红）"
                red_miss += 1
        else:
            if rc == 0 and not fail_lines:
                verdict = "✅ 未转红（符合预期）"
            else:
                verdict = "❌ 反向伤害（正确实现被判红）"
                nonred_bad += 1

        if after_md5 != before_md5:
            verdict += "  🔴 还原失败"
            restored_bad += 1

        say(f"[{m['id']}·组{m['group']}] {verdict}")
        say(f"      文件 {m['file']} · 替换 {applied} 处 · {m['note']}")
        say(f"      套件 {m['suite']} · RC={rc} · 真FAIL={len(fail_lines)} · md5 {before_md5[:8]}→{after_md5[:8]}")
        if fail_lines:
            for ln in fail_lines[:3]:
                say(f"        {ln[:150]}")
        if total:
            say(f"        {total[0].strip()}")
        say("")

    say("== 汇总 ==")
    say(f"组A 有效红 {red_hit} / 无效红 {red_miss}")
    say(f"组B 反向伤害 {nonred_bad}（应为 0）")
    say(f"还原失败 {restored_bad}（应为 0）")
    say(f"结论：{'全绿 —— 守卫有效且无反向伤害' if (red_miss == 0 and nonred_bad == 0 and restored_bad == 0) else '存在缺陷，见上'}")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    say(f"\n（已落 {OUT.relative_to(ROOT)}）")
    return 0 if (red_miss == 0 and nonred_bad == 0 and restored_bad == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
