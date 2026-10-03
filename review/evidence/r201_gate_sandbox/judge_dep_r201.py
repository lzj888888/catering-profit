# -*- coding: utf-8 -*-
"""judge_dep_r201.py —— 判 43 个部署日志真假（判据=某行同时含函数名+ASCII true，绝不按 │ 匹配）。
用法：python judge_dep_r201.py [间隔秒] [最大轮数]
"""
import os, sys, time

P = r"C:/Users/lzj/AppData/Local/Temp/inscode/dep_r201"
FNS = """adminExport adminGrantEntitlement adminInit adminLogin adminLogout adminManualOrder
adminOrderList adminQueryUser adminRefreshToken adminRefundMark adminRevokeToken archiveMonth
calcAmortize calcBom calcMonthlyProfit calcSandbox checkQuota deleteAccount detectCycle
exportData getAmortSchedule getCardVersions getCostCard getLedger getMaterial getShopContext
getShopList importSalesBill initDb manageShop payCallback payCreateOrder payExpireNotify
payOrderList payQueryEntitlement payRenew saveAsset saveCostCard saveLedger saveMaterial
saveShopSetting smokeTest syncCostCard""".split()
# getMonthList 已在 R201 单函数部署里完成
DONE_EXTRA = {"getMonthList"}

gap = int(sys.argv[1]) if len(sys.argv) > 1 else 120
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 40

hit, miss = [], []
for r in range(rounds):
    hit, miss = [], []
    for fn in FNS + sorted(DONE_EXTRA):
        lp = os.path.join(P, fn + ".log")
        if fn in DONE_EXTRA and not os.path.exists(lp):
            lp = r"C:/Users/lzj/AppData/Local/Temp/inscode/dep_gml.txt"
        if not os.path.exists(lp):
            miss.append(fn); continue
        raw = open(lp, "rb").read().decode("latin1")   # latin1: ASCII 判定稳定，绕开 GBK
        ok = any((fn in ln) and ("true" in ln) for ln in raw.splitlines())
        (hit if ok else miss).append(fn)
    alld = os.path.exists(os.path.join(P, "_ALLDONE.txt"))
    print(f"[{time.strftime('%H:%M:%S')}] round{r + 1} HIT={len(hit)} MISS={len(miss)} ALLDONE={alld}", flush=True)
    if alld and not miss:
        break
    if r < rounds - 1:
        time.sleep(gap)

print("\n===== 部署判读（判据：某行同时含函数名 + ASCII true）=====")
print(f"HIT  = {len(hit)} / {len(FNS) + len(DONE_EXTRA)}")
if miss:
    print("MISS = " + ", ".join(miss))
print("ALLDONE marker =", os.path.exists(os.path.join(P, "_ALLDONE.txt")))
