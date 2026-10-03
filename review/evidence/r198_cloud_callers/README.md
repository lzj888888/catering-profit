# R198 · 云端 `index.js` 调用点核验（21/21 全判 `.error`）

> **一句话结论**：R194 修好了 `assertShopOwner` 的返回形状，但**守卫 `check_auth_guard_shape.js::G6` 只扫本地源码**
> ⇒ 云端实际跑的 44 份 `index.js` 从未被这条判据覆盖过。本轮把同一判据搬到真云包上跑，
> **21 处生产调用点全部用 `owner.error` 判失败，零处 `owner.code` 变体** ⇒ 云端与本地一致，越权拦截在云端真实生效。

## 一、为什么要做这一件

R194 修的是一个**静默失效**的鉴权分支：

```js
// common/auth.js（修前）——fail() 产出 {code,msg,data}，没有 error 字段
return fail(ERROR_CODES.FORBIDDEN);
// 而全部 20 处调用点统一写：
const owner = await assertShopOwner(...);
if (owner.error) return fail(owner.error, owner.msg);   // owner.error 恒 undefined ⇒ 分支永不进入
```

后果是任意已登录用户把 `shop_id` 换成别人的即可读写他人店铺数据。

R194 修了单源 + 加了本地守卫，R197 又证明了**云端 44 份 `cx_auth.js` 已与单源同形**（44/44 PASS）。
但 🔴 **还剩最后一层没验**：守卫 G6 扫的是 `cloudfunctions/*/index.js`（本地），
**云端那 44 份 `index.js` 里那 21 处调用点判据对不对，从来没人看过。**
若云端某份 `index.js` 是旧版（判 `owner.code` 或压根没判），本地守卫再绿也是假绿。

## 二、通道与成本（可复现）

```bash
# 前提：R197 已把 44 份云端包下载回本地，目录仍在 ⇒ 本轮零下载成本
DL="C:/Users/lzj/WorkBuddy/Claw/_r197_dl"      # 44 个函数目录，每个含 index.js + cx_auth.js
python C:/Users/lzj/WorkBuddy/Claw/_r198_callers.py
```

若目录已清，重取用（🔴 两条坑见 R197 README）：
```bash
CLI="C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
"$CLI" cloud functions download -e <ENV 现读 initDb/config.json::DEV_ENV_ID> \
      -n <单个函数名> -p "$DL/<函数名>" --project "C:/Users/lzj/WorkBuddy/Claw/catering-profit"
```
- 🔴 必带 `--project`：缺了报 `code 31`，但 **RC=0 且零文件** ⇒ **判据不能看 rc，要看目录里有没有 `index.js`**。
- 逐函数下载，44 份实测 **28m22s**（≈38s/份）。本轮复用 R197 落盘目录，**0 成本**。

## 三、判据（5 条，同形于本地 G6，形态无关、剥注释后判）

| # | 判据 | 本轮实测 |
|---|---|---|
| C0a | 44 份云端包全部有 `index.js`（扫描面非退化） | ✅ 44/44 |
| C1 | 含生产调用点的函数数 ≥ 18（本地实测 21，取保守下沿） | ✅ **21** |
| C2 | 每个调用点都用 `owner.error` 判失败 | ✅ **21 处全判** |
| C3 | 无 `owner.code` 变体（成功返回已无 `code` 字段，判它会恒假） | ✅ 无混用 |
| C4 | 探针式调用单独识别记录，不当漏判 | ✅ **1 处（smokeTest）** |

**「生产调用点」定义**（照抄本地守卫，未放宽）：
形如 `= await assertShopOwner(` 的**解构导入直接调用取返回值**；
带 `common.` 限定的是 `smokeTest` 的**探针式调用**（断言函数自身行为、不取 `data`）⇒ 按探针记，不判红。

**判据窗口**：以调用点行为中心 **前 2 行 + 后 6 行**，要求窗口内出现 `owner.error`、且**不得**出现 `owner.code`
（比本地守卫的整文件判**更严**——整文件判会被文件里别处的 `.error` 误兜住）。

## 四、🔴 首版判据我自己写错了（自查发现，已修）

**现象**：首跑 C4 报「探针式 **0 处**」，与守卫注释里"`smokeTest` 有探针式调用"不符。

**根因（我方判据错，不是被测代码错）**：我把调用点正则写成
`=\s*await\s+assertShopOwner\s*\(` —— 要求 `await` 后**紧接** `assertShopOwner`。
而探针式的真实形态是 `= await common.assertShopOwner(`，中间夹着 `common.`
⇒ **压根匹配不上** ⇒ 不是「被排除」而是「不存在」⇒ 探针计数假 0。

**修法**：正则改为 `=\s*await\s+(common\.)?assertShopOwner\s*\(`，再按捕获到的前缀分组分流。

**修后**：探针 **1 处（smokeTest L111）**，生产调用点**仍是 21 处不变**
⇒ **原结论未受影响，错的只是探针计数表述**。
⚠️ 顺带记一条：**本地守卫 G6 也有同款表述不准**（它用同一条正则，靠"带 `common.` 就不算生产调用点"达到同样结论）——
结论对、机制描述与实现不匹配。**未改本地守卫**（本轮零源码改动），留此备查。

## 五、清单

**有生产调用点的 21 个函数**（各 1 处）：
`archiveMonth` `calcAmortize` `calcBom` `calcMonthlyProfit` `calcSandbox` `detectCycle` `exportData`
`getAmortSchedule` `getCardVersions` `getCostCard` `getLedger` `getMaterial` `getMonthList` `importSalesBill`
`manageShop` `saveAsset` `saveCostCard` `saveLedger` `saveMaterial` `saveShopSetting` `syncCostCard`

**无调用点的 23 个函数**（合理，不是漏判）：
- 支付族（8）：`payCreateOrder` `payCallback` `payQueryEntitlement` `payRenew` `payOrderList` `payExpireNotify` `checkQuota`
- 管理后台族（10）：`adminExport` `adminGrantEntitlement` `adminInit` `adminLogin` `adminLogout` `adminManualOrder`
  `adminOrderList` `adminQueryUser` `adminRefreshToken` `adminRefundMark` `adminRevokeToken`
- 其他（5）：`initDb` `smokeTest`（探针式）`getShopList`（本账号自己的店，无需归属校验）`getShopContext` `deleteAccount` `payCallback`

## 六、现场采证（云端 `archiveMonth/index.js`）

```js
30|const shopId = event && event.shop_id;
31| const owner = await assertShopOwner(db, shopId, userId);      // ← 生产调用点
32| if (owner.error) return fail(owner.error, owner.msg);         // ← 判据正确
```
全文见 `sample_archiveMonth_callers.txt`。

## 七、明确**没**做到的（不许拿这些当已验）

1. ❌ **未做真云 e2e 越权复现**——`cli` 无 `invoke` 子函数，只能控制台或真机；本轮是**静态核验**，证明不了运行时一定拦得住。
2. ❌ **未核 44 份云端 `service.js` / `cx_audit.js`**——只核了 `index.js` 的调用点与 R197 的 `cx_auth.js`。
3. ❌ **未改本地守卫 G6 的表述**（见 §四）——本轮零源码改动。
4. ❌ **未覆盖"调用点引用了但漏传 `userId`"这类实参缺陷**——判据只管判据字段，不管实参正确性。

## 八、本目录文件

| 文件 | 内容 |
|---|---|
| `README.md` | 本文件 |
| `r198_summary.json` | 44 份逐份判据（`all_pass=true`）+ 21 处调用点清单 + 1 处探针清单 |
| `sample_archiveMonth_callers.txt` | 云端 `archiveMonth/index.js` 调用点现场（前后各带上下文） |