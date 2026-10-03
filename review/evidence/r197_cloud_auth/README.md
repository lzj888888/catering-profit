# R197 云端只读核验 —— 44 份 `cx_auth.js` 真云是否含 R194 越权修复

> 轮次：R197（2026-10-03）· 触发：李老师「**你接着做你能做的**」（承接 R195/R196 遗留的零风险项）
> 性质：**只读核验**（只 `download`、只读、**零部署、零写库**）⇒ 对真云无任何副作用。
> 结论：**44/44 PASS** —— R194 那个「越权拦截整体失效」的严重缺陷，**真云 44 个函数全部已修复并生效**。

---

## 一 一句话

R194 修的越权缺陷（`assertShopOwner` 返回 `{code,msg,data}` 而调用点判 `owner.error` ⇒ 校验形同不存在）
**本地改了、云端也真的改了** —— 逐个把 44 个云函数的**实际包下载回来**核对，**44/44 通过**。

---

## 二 核验通道（可复现）

```bash
CLI="C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
ENV=cloud1-d4gphpoxy337f2a25          # 现读自 cloudfunctions/initDb/config.json::DEV_ENV_ID
REPO=C:/Users/lzj/WorkBuddy/Claw/catering-profit
"$CLI" cloud functions download -e "$ENV" -n <函数名> -p<下载目录> --project "$REPO"
```

🔴 **两个必踩的坑（都实测过）**：
1. **必须带 `--project`**（或 `--appid`）—— 缺了报 `code 31 缺失参数 'project / appid'`（`RC=0` 但零文件，别被 rc骗）。
2. **判据不能看 `rc`** —— 成功时输出 `√ download cloudfunction`，失败时也`RC=0`。
   ⇒ 判据 = **下载目录里有没有 `cx_auth.js` 文件**。

**取环境 ID 的纪律**：从 `cloudfunctions/initDb/config.json::DEV_ENV_ID` **现读**，不抄记忆里的值。
**函数名清单**：从本地 `cloudfunctions/*/cx_auth.js` **反查**（44 个），不手抄。

---

## 三 判据（每份云端包跑 5 条，全过才算 PASS）

| # | 判据 | 含义 |
|---|---|---|
| ① | 含 `return { error: null, data: shop }` | 修复后的正常返回形态 |
| ② | 含 `return { error: ERROR_CODES.FORBIDDEN }` | **越权拦截本体**，必须保留 |
| ③ | 含注释标记 `R194（2026-10-03）` | 证明是R194 修复**之后**的版本 |
| ④ | **不含** `return fail(ERROR_CODES.*` | 修复前的旧形态不得残留（**先剥注释再判**，否则注释里的 `fail(` 会误判） |
| ⑤ | `async function assertShopOwner` 恰好 1 处 | 不得重复定义 |

**结果：44/44 全 PASS**（`r197_summary.json::all_pass = true`）。

---

## 四🔴 一个曾让我误判的坑：md5「不一致」其实是**设计行为**

初跑脚本报「与单源 md5 一致 = 0/44」，看着像**云端全是旧版**。**先怀疑自己**，逐字节定位后：

| 项 | 本地单源 `common/auth.js` | 云端 `*/cx_auth.js` |
|---|---|---|
| 字节 | 8345 | **8351**（全部 44 份**完全统一**） |
| 行数 | 160 | 160（**相同**） |
| 换行 | LF 159 | LF 159（**相同**） |
| BOM | 无 | 无 |

**逐行 diff 只有 2 行**，全是 `require` 路径：

```
本地 L14: require('./errors')      云端: require('./cx_errors')
本地 L15: require('./utilTime')    云端: require('./cx_utilTime')
```

⇒ **这是 `sync_common` 派生时的设计行为**（云函数目录下模块统一加 `cx_` 前缀防冲突），
**不是"云端没同步"**。44 份**字节完全一致**（都是 8351）⇒ 反过来证明**派生副本 100% 统一，无一份漂移**。

⚠️ **记档纪律**：比对派生副本**不能直接比 md5** —— 必须先剥 `require` 前缀差异（或只比**行为判据**）。
本次 5 条判据全部避开该差异，才是有效判据。

---

## 五 逐份结果（44/44）

`adminExport` · `adminGrantEntitlement` · `adminInit` · `adminLogin` · `adminLogout` ·
`adminManualOrder` · `adminOrderList` · `adminQueryUser` · `adminRefreshToken` ·
`adminRefundMark` · `adminRevokeToken` · `archiveMonth` · `calcAmortize` · `calcBom` ·
`calcMonthlyProfit` · `calcSandbox` · `checkQuota` · `deleteAccount` · `detectCycle` ·
`exportData` · `getAmortSchedule` · `getCardVersions` · `getCostCard` · `getLedger` ·
`getMaterial` · `getMonthList` · `getShopContext` · `getShopList` · `importSalesBill` ·
`initDb` · `manageShop` · `payCallback` · `payCreateOrder` · `payExpireNotify` ·
`payOrderList` · `payQueryEntitlement` · `payRenew` · `saveAsset` · `saveCostCard` ·
`saveLedger` · `saveMaterial` · `saveShopSetting` · `smokeTest` · `syncCostCard`

**全部**：`has_ok_return` ✓· `has_forbidden` ✓· `r194_mark` ✓· `cx_` 前缀 ✓· 8351 bytes ✓

---

## 六 明确「没做到」的（防下一轮误判）

- **本轮只核验了 `cx_auth.js` 一个文件**：44 个函数各自的 `index.js` 里**20 处 `assertShopOwner`
  调用点**是否都判`owner.error`（而非 `owner.code`）**未逐个核验** —— R194 的守卫
  `tools/check_auth_guard_shape.js`（17 断言）覆盖的是**本地源码**，云端 `index.js` 逐份比对**本轮未做**。
  ⇒ **下一步可做且零风险**：把 44 份 `index.js` 也下载回来，跑同一套判据（查 `if (owner.error)`）。
- **没做真云 e2e 越权复现**：即"用A 账号改B 店铺 `shop_id` 看是否被拒"——
  dev 只有 1 家店且 `hit_free_limit=true`，做不了（会动真实数据/占额度）。
- **没核验其他云函数文件**（`cx_index.js` / `cx_errors.js` / `index.js` 等）是否与本地一致。
- **没验真机**：与本轮无关（纯云端只读）。

---

## 七 本目录文件

| 文件 | 说明 |
|---|---|
| `r197_summary.json` | **44 份逐份判据结果**（5 条判据 + 字节数 + `cx_` 前缀检查） |
| `r197_cloud_auth_verify.json` | 首跑脚本的完整记录（含 `cli_rc`、逐份 PASS/FAIL 原始输出） |
| `<函数名>/cx_auth.js` × 44 | **云端实际包**（未入库本目录，避免仓内堆 44 份重复文件；原始副本在 `C:\Users\lzj\WorkBuddy\Claw\_r197_dl\`） |

**复现脚本**（**仓外**，不落 `review/evidence/**` 扫描面）：
`C:\Users\lzj\WorkBuddy\Claw\_r197_verify.py`（批量下载 + 5 条判据）、
`_r197_diff.py`（换行/BOM/行数对比）、
`_r197_bytes.py`（逐行 diff 定位差异）。
