# -*- coding: utf-8 -*-
# R215b 补丁：付费档解锁「账套不限 / 卡数不限」（specs 01_架构总览:167 / 04_核对清单:118）
#
# 两阶段：① 全部锚点先校验「恰命中 1 次」 ② 才写入（任一不唯一 ⇒ ABORT 零写入）
# 🔴 本机纪律：先 txt.encode('utf-8') 再 open(p,'wb')，避免报错时文件被截断成 0 字节。
import io, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/"

PAID_NOTE = """    // 🔴 R215b：付费档解锁「账套/卡数不限」（specs 01_架构总览:167、04_核对清单:118）。
    //   付费期 ⇒ 跳过免费额度，只留硬上限（hit_hard_limit 不受影响，付费也受 200 限制）。
    //   权益到期后 isPaid 回落 false ⇒ 自动回到「只冻结新增、存量照常可用」（方案 A，不删任何存量）。"""

EDITS = [
    # ---------- 1. manageShop/service.js :: decideCreate ----------
    dict(
        rel="cloudfunctions/manageShop/service.js",
        old="""function decideCreate(p) {
  const used = Number(p && p.used) || 0;
  const lim = requireShopLimits(p && p.limits);
  return {
    used,
    free_limit: lim.free_limit,
    hard_limit: lim.hard_limit,
    hit_free_limit: used >= lim.free_limit,
    hit_hard_limit: lim.hard_limit !== null && used >= lim.hard_limit,
  };
}""",
        new="""function decideCreate(p) {
  const used = Number(p && p.used) || 0;
  const lim = requireShopLimits(p && p.limits);
  const paid = !!(p && p.isPaid);          // 缺省 false ⇒ 既有调用方（selftest）行为不变
""" + PAID_NOTE + """
  return {
    used,
    free_limit: lim.free_limit,
    hard_limit: lim.hard_limit,
    is_paid: paid,
    hit_free_limit: !paid && used >= lim.free_limit,
    hit_hard_limit: lim.hard_limit !== null && used >= lim.hard_limit,
  };
}""",
    ),
    # ---------- 2. manageShop/index.js :: onCreate 注入 isPaid ----------
    dict(
        rel="cloudfunctions/manageShop/index.js",
        old="    d = S.decideCreate({ used: (cnt && cnt.total) || 0, limits: fp && fp.limits });",
        new="    // 🔴 R215b：付费判定走单源 common/entitlement.js（只读 expire_at，不看 plan_id）\n"
            "    const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n"
            "    d = S.decideCreate({ used: (cnt && cnt.total) || 0, limits: fp && fp.limits, isPaid: paid });",
    ),
    # ---------- 3. getShopList/index.js :: hit_free_limit ----------
    dict(
        rel="cloudfunctions/getShopList/index.js",
        old="  const hitFreeLimit = shops.length >= freeShopLimit;",
        new="  // 🔴 R215b：付费档账套不限 ⇒ 前端「新增店铺」不再误显示已达上限、不再弹付费墙\n"
            "  const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n"
            "  const hitFreeLimit = !paid && shops.length >= freeShopLimit;",
    ),
    dict(
        rel="cloudfunctions/getShopList/index.js",
        old="""    used: shops.length,
    hit_free_limit: hitFreeLimit,""",
        new="""    used: shops.length,
    is_paid: paid,
    hit_free_limit: hitFreeLimit,""",
    ),
    # ---------- 4. checkQuota/service.js :: checkQuota ----------
    dict(
        rel="cloudfunctions/checkQuota/service.js",
        old="""  return {
    user_id: (p && p.userId) || '',
    scope,
    used,
    free_limit: freeLimit,
    hard_limit: hardLimit,
    // used >= 免费额度 → 下一次保存（第 freeLimit+1 个）超限
    hit_free_limit: used >= freeLimit,
    hit_hard_limit: used >= hardLimit,
  };""",
        new="""  const paid = !!(p && p.isPaid);          // 缺省 false ⇒ 既有调用方行为不变
""" + PAID_NOTE + """
  return {
    user_id: (p && p.userId) || '',
    scope,
    used,
    free_limit: freeLimit,
    hard_limit: hardLimit,
    is_paid: paid,
    // used >= 免费额度 → 下一次保存（第 freeLimit+1 个）超限；付费档跳过此限
    hit_free_limit: !paid && used >= freeLimit,
    hit_hard_limit: used >= hardLimit,
  };""",
    ),
    # ---------- 5. checkQuota/index.js :: 注入 isPaid ----------
    dict(
        rel="cloudfunctions/checkQuota/index.js",
        old="    r = checkQuota({ userId, scope: v.scope, activeCount, limits });",
        new="    // 🔴 R215b：付费判定走单源（只读 expire_at）\n"
            "    const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n"
            "    r = checkQuota({ userId, scope: v.scope, activeCount, limits, isPaid: paid });",
    ),
    # ---------- 6. saveCostCard/service.js :: judgeCardQuota ----------
    dict(
        rel="cloudfunctions/saveCostCard/service.js",
        old=""" * @param {number} activeCount 该 shop_id 下活跃逻辑卡号数（card_code 去重后的大小）
 * @returns {{ hit_free_limit:boolean, hit_hard_limit:boolean, free_limit:number, hard_limit:number }}""",
        new=""" * @param {number} activeCount 该 shop_id 下活跃逻辑卡号数（card_code 去重后的大小）
 * @param {boolean} [isPaid] R215b：付费档 ⇒ 跳过免费额度、只留硬上限（缺省 false ⇒ 行为不变）
 * @returns {{ hit_free_limit:boolean, hit_hard_limit:boolean, free_limit:number, hard_limit:number, is_paid:boolean }}""",
    ),
    dict(
        rel="cloudfunctions/saveCostCard/service.js",
        old="function judgeCardQuota(limits, activeCount) {",
        new="function judgeCardQuota(limits, activeCount, isPaid) {",
    ),
    dict(
        rel="cloudfunctions/saveCostCard/service.js",
        old="""  return {
    free_limit: freeLimit,
    hard_limit: hardLimit,
    hit_free_limit: used >= freeLimit,
    hit_hard_limit: used >= hardLimit,
  };""",
        new="""  const paid = !!isPaid;                   // 缺省 false ⇒ 既有调用方（selftest）行为不变
""" + PAID_NOTE + """
  return {
    free_limit: freeLimit,
    hard_limit: hardLimit,
    is_paid: paid,
    hit_free_limit: !paid && used >= freeLimit,
    hit_hard_limit: used >= hardLimit,
  };""",
    ),
    # ---------- 7. saveCostCard/index.js :: 注入 isPaid ----------
    dict(
        rel="cloudfunctions/saveCostCard/index.js",
        old="      verdict = judgeCardQuota(limits, activeCount);",
        new="      // 🔴 R215b：付费判定走单源（只读 expire_at）\n"
            "      const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));\n"
            "      verdict = judgeCardQuota(limits, activeCount, paid);",
    ),
]


def main():
    texts = {}
    # ---- 阶段 1：全部校验 ----
    for i, e in enumerate(EDITS, 1):
        p = ROOT + e["rel"]
        s = io.open(p, encoding="utf-8", newline="").read()
        n = s.count(e["old"])
        if n != 1:
            print("ABORT 锚点 %d 命中 %d 次（须恰为 1）: %s" % (i, n, e["old"][:70].replace("\n", "\\n")))
            sys.exit(1)
        texts[e["rel"]] = s
    print("阶段1：%d 个锚点全部唯一命中 OK" % len(EDITS))

    # ---- 阶段 2：写入 ----
    for e in EDITS:
        rel = e["rel"]
        s = texts[rel].replace(e["old"], e["new"], 1)
        texts[rel] = s
        data = s.encode("utf-8")
        with open(ROOT + rel, "wb") as f:
            f.write(data)
        print("  写入 %-46s %d bytes" % (rel, len(data)))
    print("阶段2：全部写入完成")


main()
