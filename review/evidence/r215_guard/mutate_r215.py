# -*- coding: utf-8 -*-
"""mutate_r215.py —— 变异回灌（mutation-backfill）

目的（两条，缺一不可）：
  A 证明**修复真被拦住**：把 payExpireNotify / smokeTest 的来源校验改回旧写法，
    守卫必须**点名到 C-②** 并说出是哪个函数；
  B 证明**守卫不是假绿、也不假红**：
    · 削弱判据（mustSelfGuard→false / MIN_FNS 调大 / 登记表腐化）必须转红（否则该判据是装饰）；
    · 语义等价改写（单行 → 多行块）必须**保持绿**（否则判据形态太窄 = 反向伤害第二型）。

铁律：每条独立（reset_to_base）／锚点命中恰为 1／还原后逐字节等于 HEAD／判据点名到目标断言。

🔴 R215 修订：备份改**纯内存**（原用 `<file>.mutbak` 磁盘临时文件，触发本机
   safe-delete-bulk-guard 拦截 ⇒ 改为 `BASE = {rel: bytes}`，零临时文件落盘）。
"""
import hashlib
import os
import re
import subprocess
import sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"

GUARD = "tools/check_fn_public_surface.js"
PAY = "cloudfunctions/payExpireNotify/index.js"
SMOKE = "cloudfunctions/smokeTest/index.js"

TARGETS = [GUARD, PAY, SMOKE]
ABS = {r: os.path.join(REPO, r) for r in TARGETS}

# 🔴 纯内存备份（零临时文件）
BASE = {}


def read(p):
    with open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write(p, s):
    # 🔴 字节写回（防 Windows 换行翻译 —— mutation-backfill 坑 15）
    data = s.encode("utf-8")
    with open(p, "wb") as f:
        f.write(data)


def sha(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=180)
    out = (r.stdout or "") + (r.stderr or "")
    failed = [l for l in out.splitlines() if l.startswith("❌")]
    crashed = (r.returncode != 0) and not re.search(r"\d+ 通过 / \d+ 失败", out)
    return r.returncode, failed, crashed, out


def reset_to_base():
    """从内存字节还原（不依赖任何磁盘临时文件）"""
    for r in TARGETS:
        with open(ABS[r], "wb") as f:
            f.write(BASE[r])


def sub1(rel, pattern, repl):
    """单词替换 + **强制锚点唯一**（命中 != 1 即抛错，整条不写）"""
    src = read(ABS[rel])
    new, n = re.subn(pattern, repl, src, count=1)
    if n != 1:
        raise RuntimeError("锚点命中 %d 次（须恰为 1）: %s" % (n, pattern[:80]))
    write(ABS[rel], new)


# ===== 变异清单 =====
# (名字, 目标文件, 正则, 替换, 期望红?, 目标断言关键字)
MUTATIONS = [
    # --- 组 A：必须红（真缺陷被拦住 / 判据有分辨力）---
    ("M1 退回旧 bug：payExpireNotify 去掉来源校验", PAY,
     r"  const ctx = cloud\.getWXContext\(\);\n  if \(ctx && ctx\.OPENID\) return fail\(ERROR_CODES\.FORBIDDEN\);\n",
     "  // (变异：来源校验被删除)\n", True, "C-②"),

    ("M2 退回旧 bug：smokeTest 去掉来源校验", SMOKE,
     r"  const wxCtx = cloud\.getWXContext\(\);\n"
     r"  if \(wxCtx && wxCtx\.OPENID\) return \{ code: 'FORBIDDEN', msg: 'smokeTest 仅限云控制台 / cli 调用（R215 加固）' \};\n",
     "  // (变异：来源校验被删除)\n", True, "C-②"),

    ("M3 削弱判据：mustSelfGuard 全改 false", GUARD,
     r"mustSelfGuard: true \}", "mustSelfGuard: false }", True, "C-①"),

    ("M4 削弱判据：MIN_FNS 调到 9999（下界恒真测试）", GUARD,
     r"const MIN_FNS = 40;", "const MIN_FNS = 9999;", True, "S-①"),

    ("M5 登记表腐化：把已鉴权函数登记为免鉴权", GUARD,
     r"\{ fn: 'initDb', ", "{ fn: 'getShopContext', ", True, "B-④"),

    ("M6 登记表陈旧键：登记一个不存在的目录", GUARD,
     r"\{ fn: 'initDb', ", "{ fn: 'initDbXyz', ", True, "B-③"),

    ("M7 C 类未登记：把 payCallback 从登记表删掉", GUARD,
     r"\n  \{ fn: 'payCallback',[^\n]*\n", "\n", True, "B-①"),

    ("M8 判据形态变假：REJECT_RE 放宽成'只看有 OPENID'", GUARD,
     r"const REJECT_RE = /if",
     "const REJECT_RE = /OPENID/;\nconst UNUSED_REJECT_RE = /if", True, "C-④"),

    # --- 组 B：必须保持绿（判据形态够宽，不假红）---
    ("B1 等价改写：来源校验 单行 → 多行块", PAY,
     r"  if \(ctx && ctx\.OPENID\) return fail\(ERROR_CODES\.FORBIDDEN\);\n",
     "  if (ctx && ctx.OPENID) {\n    return fail(ERROR_CODES.FORBIDDEN);\n  }\n", False, "C-②"),

    ("B2 等价改写：登记表 why 文案改写（语义不变）", GUARD,
     r"why: 'admin 后台初始化（建首个超管）—— 运维在控制台执行，一次性幂等'",
     "why: 'admin 后台初始化：建首个超管，运维在控制台执行，一次性幂等'", False, "B-②"),
]


def main():
    # 备份（纯内存，零临时文件）+ 基线 md5
    base_md5 = {}
    for r in TARGETS:
        BASE[r] = open(ABS[r], "rb").read()
        base_md5[r] = hashlib.md5(BASE[r]).hexdigest()

    rc, failed, crashed, _ = run_guard()
    if failed or crashed:
        print("基线不绿，先修：", failed[:3])
        return 1

    misses = []
    try:
        for name, rel, pat, repl, expect_red, key in MUTATIONS:
            reset_to_base()
            try:
                sub1(rel, pat, repl)
            except RuntimeError as e:
                print("SKIP  %-52s %s" % (name, e))
                misses.append(name)
                continue
            rc2, failed2, crashed2, out2 = run_guard()
            hit_key = any((("❌ " + key) in l) or (key in l) for l in failed2)
            if expect_red:
                ok = bool(failed2) and hit_key
                why = ("点名 %s" % key) if hit_key else ("红了但**未点名** %s：%s" % (key, failed2[:2]))
            else:
                ok = (not failed2) and (not crashed2)
                why = "保持绿" if ok else ("假红：%s" % failed2[:2])
            if not ok:
                misses.append(name)
            print("%-52s %s  rc=%s ❌行=%d  %s" % (name, "✅" if ok else "❌漏网", rc2, len(failed2), why))

        reset_to_base()
        rc3, failed3, crashed3, _ = run_guard()
        print("\n还原后：rc=%s ❌=%d crash=%s" % (rc3, len(failed3), crashed3))
        # 逐字节自证
        bad = [r for r in TARGETS if sha(ABS[r]) != base_md5[r]]
        print("还原完整性（md5 逐文件比对）：", "✅ 全部一致" if not bad else "❌ 不一致：" + str(bad))
        return 0 if (not misses and not failed3 and not crashed3 and not bad) else 1
    finally:
        reset_to_base()
        # 🔴 无任何磁盘临时文件需要清理（纯内存备份）


sys.exit(main())
