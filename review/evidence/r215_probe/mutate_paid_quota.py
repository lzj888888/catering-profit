# -*- coding: utf-8 -*-
# R215b 变异回灌：证明 check_paid_quota_unlock 真能抓到「付费不解锁」复发
#
# 🔴 本机纪律（R215 踩过）：备份一律走**内存**，绝不落 .mutbak 磁盘临时文件
#    —— 删临时文件会撞 safe-delete-bulk-guard，脚本收不了尾。
# 🔴 写入纪律：先 txt.encode('utf-8') 再 open(p,'wb')，避免报错时文件被截断成 0 字节。
import io, os, re, subprocess, sys, hashlib

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
GUARD = "tools/check_paid_quota_unlock.js"

MS = "cloudfunctions/manageShop/service.js"
MI = "cloudfunctions/manageShop/index.js"
GL = "cloudfunctions/getShopList/index.js"
CS = "cloudfunctions/checkQuota/service.js"
SS = "cloudfunctions/saveCostCard/service.js"

BASE = {}
for rel in [MS, MI, GL, CS, SS]:
    with open(ROOT + rel, "rb") as f:
        BASE[rel] = f.read()


def md5(rel):
    with open(ROOT + rel, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def reset_all():
    for rel, b in BASE.items():
        with open(ROOT + rel, "wb") as f:
            f.write(b)


def sub1(rel, old, new):
    s = io.open(ROOT + rel, encoding="utf-8", newline="").read()
    n = s.count(old)
    if n != 1:
        raise RuntimeError("锚点命中 %d 次（须恰为 1）: %s" % (n, old[:60].replace("\n", "\\n")))
    data = s.replace(old, new, 1).encode("utf-8")
    with open(ROOT + rel, "wb") as f:
        f.write(data)


def run_guard():
    r = subprocess.run([NODE, GUARD], capture_output=True, cwd=ROOT)
    out = ((r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace"))
    bad = [l for l in out.splitlines() if l.startswith("❌")]
    return bad, r.returncode, out


# (名字, 文件, 原文本, 变异文本, 期望点名的断言)
MUT = [
    ("M1 退回旧bug：manageShop 免费额度不再被 paid 短路", MS,
     "    hit_free_limit: !paid && used >= lim.free_limit,",
     "    hit_free_limit: used >= lim.free_limit,", "A-①"),
    ("M2 退回旧bug：checkQuota 同理", CS,
     "    hit_free_limit: !paid && used >= freeLimit,",
     "    hit_free_limit: used >= freeLimit,", "A-①"),
    ("M3 退回旧bug：saveCostCard 同理", SS,
     "    hit_free_limit: !paid && used >= freeLimit,",
     "    hit_free_limit: used >= freeLimit,", "A-①"),
    ("M4 修过头：付费连硬上限一起豁免（可无限建店）", SS,
     "    hit_hard_limit: used >= hardLimit,",
     "    hit_hard_limit: !paid && used >= hardLimit,", "B-①"),
    ("M5 Controller 不读 expire_at（manageShop）", MI,
     "    const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n",
     "    const paid = false;\n", "C-①"),
    ("M6 Controller 不读 expire_at（getShopList）", GL,
     "  const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n",
     "  const paid = false;\n", "C-①"),
    ("M7 Controller 不读 expire_at（checkQuota）", "cloudfunctions/checkQuota/index.js",
     "    const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n",
     "    const paid = false;\n", "C-①"),
    # 负样本：等价改写（换变量名）⇒ 判行为不判变量名，应保持绿
    ("M8 等价改写：paid 改名 isPaidUser（应仍绿）", MS,
     "  const paid = !!(p && p.isPaid);",
     "  const isPaidUser = !!(p && p.isPaid);", None),
]

print("===== R215b 变异回灌（守卫 %s）=====" % GUARD)
bad0, rc0, _ = run_guard()
print("基线：❌=%d rc=%d" % (len(bad0), rc0))
if bad0 or rc0 != 0:
    print("基线不绿，先修"); sys.exit(1)

miss = []
for name, rel, old, new, expect in MUT:
    if rel not in BASE:
        BASE[rel] = open(ROOT + rel, "rb").read()
    reset_all()
    try:
        sub1(rel, old, new)
        if expect is None and name.startswith("M8"):
            # 等价改写要连带改引用处，否则语法上 paid 未定义（仍会红，但不是我们要验的东西）
            sub1(rel, "    hit_free_limit: !paid && used >= lim.free_limit,",
                      "    hit_free_limit: !isPaidUser && used >= lim.free_limit,")
            sub1(rel, "    is_paid: paid,", "    is_paid: isPaidUser,")
    except RuntimeError as e:
        print("SKIP %s :: %s" % (name, e)); miss.append(name); continue
    bad, rc, out = run_guard()
    hit = (len(bad) > 0) or (rc != 0)
    if expect is None:
        good = (not bad) and rc == 0
        print("%-52s %s  (❌=%d rc=%d)" % (name, "✅保持绿（等价改写不假红）" if good else "❌误红", len(bad), rc))
        if not good: miss.append(name)
    else:
        named = any(expect in l for l in bad)
        print("%-52s %s  点名 %s" % (name, "✅转红" if hit else "❌漏网", expect if named else "未点名(" + ";".join(bad)[:60] + ")"))
        if not hit or not named: miss.append(name)

reset_all()
print("\n===== 还原完整性（md5 逐字节比对）=====")
allok = True
for rel in BASE:
    same = md5(rel) == hashlib.md5(BASE[rel]).hexdigest()
    allok = allok and same
    print("  %-46s %s" % (rel, "✅ 一致" if same else "❌ 被改动"))

bad_f, rc_f, _ = run_guard()
print("\n还原后守卫：❌=%d rc=%d" % (len(bad_f), rc_f))
print("===== 结果：%s =====" % ("全部通过" if (not miss and allok and not bad_f) else "有问题: " + str(miss)))
sys.exit(0 if (not miss and allok) else 1)
