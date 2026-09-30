# -*- coding: utf-8 -*-
"""批次 F：新增云函数 importSalesBill 引发的同步面补丁（4 类 / 6 处）。

两阶段：先断言每个锚点命中唯一，任一不符则整体不落盘。
"""
import io, os, sys

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
R85 = os.path.join(ROOT, "tools", "selftest_r85.js")
FN10 = os.path.join(ROOT, "specs", "dev-specs", "core", "10_云函数清单与接口契约.md")
PRIV = os.path.join(ROOT, "specs", "dev-specs", "上线材料_隐私政策_v1.md")

EDITS = [
    # ① A15 白名单（本批授权新增函数）
    (R85,
     "  /^cloudfunctions\\/getMaterial\\//,                // round127（M3 v1.2 批次 P0）授权：原料档案三可选字段出参（category/aliases/remark）\n",
     "  /^cloudfunctions\\/getMaterial\\//,                // round127（M3 v1.2 批次 P0）授权：原料档案三可选字段出参（category/aliases/remark）\n"
     "  // R181l（批次 F 阶段①）：新增授权云函数 importSalesBill（账单导入：xlsx → 解析 → 甲级门禁 →\n"
     "  //   落 external_sales_daily）。按 round103 白名单式登记，**不放宽成全豁免**：\n"
     "  /^cloudfunctions\\/importSalesBill\\//,\n",
     "r85-A15白名单"),

    # ② core/10 全集声明 42 → 43
    (FN10, "本表共登记 **42** 个已部署云函数", "本表共登记 **43** 个已部署云函数", "core10-全集声明"),

    # ③ core/10 新增契约登记行（挂在 M3 表格 detectCycle 之后）
    (FN10,
     "| `detectCycle` | 循环引用检测（DFS 深度≤5） | `{ edges:[{from,to}] }` | `{ has_cycle }`（命中抛 `BOM_CYCLE_DETECTED`） | user+shop |\n",
     "| `detectCycle` | 循环引用检测（DFS 深度≤5） | `{ edges:[{from,to}] }` | `{ has_cycle }`（命中抛 `BOM_CYCLE_DETECTED`） | user+shop |\n"
     "| `importSalesBill` | **账单导入**（批次 F 阶段①：xlsx → 平台判定 → 解析 → **甲级门禁 fail-closed** → 落 `external_sales_daily`；`confirm=false` **只预览不落库**） | `{ shop_id, fileID, platform?, confirm?, client_request_id }` | `{ shop_id, platform, grade, preview{headerRow,rows,totals,months,excluded}, written?, client_request_id }` | user+shop+幂等 |\n",
     "core10-契约行"),

    # ④ 隐私政策：收集项新增第 7 行
    (PRIV,
     "| 6 | **设备与网络状态** | 运行时 | 断网提示、版本热更新、异常排查 | `app.js`（`onNetworkStatusChange` / `getUpdateManager` / `recordScene`） |\n",
     "| 6 | **设备与网络状态** | 运行时 | 断网提示、版本热更新、异常排查 | `app.js`（`onNetworkStatusChange` / `getUpdateManager` / `recordScene`） |\n"
     "| 7 | **用户主动选择的文件**（账单 xlsx） | 仅用户上传时 | 解析外卖/堂食账单、导入营收数据（**只读用户此次选中的那一个文件，不扫描设备文件**） | `pages/takeaway/index.js`（`chooseMessageFile` + `uploadFile`） |\n",
     "priv-收集项第7行"),

    # ⑤ 隐私政策：不收集段——文件不再「一律不收集」
    (PRIV,
     "- ❌ 相册 / 文件（头像走微信官方 `chooseAvatar` 能力，不读相册）\n",
     "- ❌ 相册（头像走微信官方 `chooseAvatar` 能力，不读相册）；⚠️ **文件**：只读用户**主动选中**的那一个账单文件（见上表第 7 项），**不扫描、不遍历**设备文件\n",
     "priv-不收集段"),

    # ⑥ 隐私政策：取证方式段（API 命中说明）
    (PRIV,
     "- 「不收集」逐条为**调用点零命中**：`getPhoneNumber` / `getLocation` / `chooseImage` / 相册相关 API 均未出现。\n",
     "- 「不收集」逐条为**调用点零命中**：`getPhoneNumber` / `getLocation` / `chooseImage` / 相册相关 API 均未出现。\n"
     "- ⚠️ 例外：`chooseMessageFile`（R181l 批次 F 账单导入）**已出现** —— 它读取的是用户**当次主动选中**的单个文件，属「用户提供」而非「自动收集」，已登记为上表第 7 项。\n",
     "priv-取证段"),
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
r85 = io.open(R85, encoding="utf-8").read()
fn10 = io.open(FN10, encoding="utf-8").read()
priv = io.open(PRIV, encoding="utf-8").read()
print("  r85 含 importSalesBill %d 次" % r85.count("importSalesBill"))
print("  core10 全集声明 43 %d 次 / 契约行 importSalesBill %d 次" % (fn10.count("本表共登记 **43** 个已部署云函数"), fn10.count("| `importSalesBill` |")))
print("  priv 第7行 %d / chooseMessageFile %d / 旧不收集句残留 %d"
      % (priv.count("| 7 | **用户主动选择的文件**"), priv.count("chooseMessageFile"), priv.count("- ❌ 相册 / 文件（头像走微信官方")))
