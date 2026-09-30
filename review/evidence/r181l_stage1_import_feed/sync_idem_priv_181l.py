# -*- coding: utf-8 -*-
"""批次 F 收尾补丁：隐私 C4/C5 + importSalesBill 幂等（4 处）。

C 部分是**生产代码**补漏（写操作按项目红线须带 client_request_id 幂等）；
形态逐字对齐既有单源用法（syncCostCard）：findPriorResult 预检 + writeAudit 登记。
"""
import io, os, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
PRIV = os.path.join(ROOT, "specs", "dev-specs", "上线材料_隐私政策_v1.md")
PC = os.path.join(ROOT, "tools", "check_privacy_collection.js")
ISB = os.path.join(ROOT, "cloudfunctions", "importSalesBill", "index.js")

EDITS = [
    # A 隐私文档：声明数 6 → 7（表格已加到 7 行，声明处漏改）
    (PRIV, "本表共 **6** 项个人信息收集项", "本表共 **7** 项个人信息收集项", "priv-声明数"),

    # B 隐私守卫白名单：新增两个**小程序 API**（非云函数，属合法出处）
    (PC,
     "  'shop_entitlement', 'name', 'remark', 'chooseAvatar',\n",
     "  'shop_entitlement', 'name', 'remark', 'chooseAvatar',\n"
     "  // R181l：批次 F 账单导入引入的小程序 API（读用户**主动选中**的文件，非自动收集）\n"
     "  'chooseMessageFile', 'uploadFile',\n",
     "pc-白名单"),

    # C1 importSalesBill：落库前补幂等预检（重放形态）
    (ISB,
     "  if (!grade.pass) {\n    return fail(ERROR_CODES.INVALID_PARAM, '甲级门禁未通过，已阻断落库');\n  }\n\n  const now = nowUtc();\n",
     "  if (!grade.pass) {\n    return fail(ERROR_CODES.INVALID_PARAM, '甲级门禁未通过，已阻断落库');\n  }\n\n"
     "  // 🔒 R181l 幂等（重放形态）：命中即返回首次结果、不重复写入。\n"
     "  //    本函数落库用确定性 _id（同店同平台同账单日 ⇒ 覆盖同一文档），语义上已幂等；\n"
     "  //    此处按项目红线「写操作带 client_request_id 幂等」补**显式**预检 + 审计登记（形态对齐 syncCostCard）。\n"
     "  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);\n"
     "  if (prior) return ok(prior);\n\n"
     "  const now = nowUtc();\n",
     "isb-幂等预检"),

    # C2 importSalesBill：返回前补幂等登记（键走单源 shopKey）
    (ISB,
     "  return ok({\n    shop_id: shopId,\n    platform,\n    written,\n    totals: parsed.totals,\n    client_request_id: clientRequestId || '',\n  });\n};\n",
     "  const out = {\n    shop_id: shopId,\n    platform,\n    written,\n    totals: parsed.totals,\n    client_request_id: clientRequestId || '',\n  };\n\n"
     "  // 幂等登记（键与上面查重键**同源**，一律走单源 shopKey）\n"
     "  if (clientRequestId) {\n"
     "    try {\n"
     "      await common.audit.writeAudit(db, {\n"
     "        action: 'IMPORT_SALES_BILL',\n"
     "        operator_type: 'user',\n"
     "        operator_id: userId,\n"
     "        shop_id: shopId,\n"
     "        after_data: out,\n"
     "        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),\n"
     "      });\n"
     "    } catch (e) { /* 审计失败不阻断主流程 */ }\n"
     "  }\n\n"
     "  return ok(out);\n};\n",
     "isb-幂等登记"),
]

fails = []
cache = {}
for path, old, new, label in EDITS:
    if path not in cache:
        cache[path] = io.open(path, encoding="utf-8").read()
    txt = cache[path]
    n_lf = txt.count(old)
    n_crlf = txt.count(old.replace("\n", "\r\n"))
    if not (n_lf == 1 or (n_crlf == 1 and n_lf == 0)):
        fails.append("[%s] LF=%d CRLF=%d（期望 1）片段: %s" % (label, n_lf, n_crlf, old[:60].replace("\n", "\\n")))

if fails:
    print("!! 阶段一失败，**未落盘**（零损失）：")
    for f in fails:
        print("   -", f)
    sys.exit(2)
print("阶段一 OK：%d 处锚点全部命中唯一" % len(EDITS))

for path, old, new, label in EDITS:
    txt = cache[path]
    if txt.count(old) == 1:
        txt = txt.replace(old, new, 1)
    else:
        txt = txt.replace(old.replace("\n", "\r\n"), new.replace("\n", "\r\n"), 1)
    cache[path] = txt

for path, txt in cache.items():
    io.open(path, "w", encoding="utf-8", newline="").write(txt)
    print("  落盘 %s：%d 字符" % (os.path.basename(path), len(txt)))

print("\n回读自证：")
priv = io.open(PRIV, encoding="utf-8").read()
pc = io.open(PC, encoding="utf-8").read()
isb = io.open(ISB, encoding="utf-8").read()
print("  priv 声明 **7** %d 次" % priv.count("本表共 **7** 项个人信息收集项"))
print("  pc 白名单含 chooseMessageFile %d / uploadFile %d" % (pc.count("'chooseMessageFile'"), pc.count("'uploadFile'")))
print("  isb 含 findPriorResult %d / writeAudit %d / shopKey %d"
      % (isb.count("findPriorResult"), isb.count("writeAudit"), isb.count("shopKey")))
