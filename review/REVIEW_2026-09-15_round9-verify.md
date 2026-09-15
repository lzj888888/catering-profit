# REVIEW_2026-09-15 round9 · R34 四子点复验 + 2 个新发现（R35/R36）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 9 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round8-verify.md`（R34）；本轮对象 = `98f6f5e` / `e1ac099`。

---

## §0 结论

**R34 四个子点全部真落地**（源码 + 运行双验），**钱没被这轮改名改坏**，`selftest 48→46` 也**只删了该删的**。
另发现 **R35 🟡**（`total_value` 的类型守卫仍是 `Number()` 强转，会静默放过 `null`/`""`/`true`/`[]` → 0/1 分）与 **R36 🔵**（`asset_id` 的守卫在删 `cleanAssets` 时一并丢了）。

| 项 | 结果 |
|---|---|
| 提交/推送/工作树 | ✅ `e1ac099` = HEAD = `origin/dev`；无未推；`git status` 干净；`review/` **12 份入库** |
| ① 契约表对齐 wire | ✅ `core/10:46` 入参已改 `{ shop_id, month }`，并注明「资产一律从 `shop_amortize` 台账读取」 |
| ② 改名 `total_amount_fen` | ✅ **全树活跃代码/文档搜 `total_amount`（不带 `_fen`）= 0 命中**；`total_amount_fen` = 18 命中；delivery 单源 + `批次2.txt` + HTML 三处同步 |
| ③ 删死入口 `assets` | ✅ `cleanAssets`/`f()` 已无（仅存"已删除"的说明注释）；`validateInput` 返回结构里**没有 `assets`**；传垃圾 `assets` 被忽略、不影响 |
| ④ 只留严格路径 | ✅ 资产映射只剩 `docToAsset`（严格抛错、点名 asset_id） |
| **钱有没有被改坏** | ✅ 4 个 POC1 锚点 + 独立尾差 + 次月停 + `details` 之和 === 总额，**全部与 round7/8 我的手工值一致** |
| 总闸 | ✅ 门禁 exit 0；`calcAmortize/selftest.js` **46/46**；逐套件 **10/10**（`verify_all` 我 EPERM 跑不了） |

**`48→46` 我核了，是合法减少**：删的正是 wire-`assets` 那两条（selftest `:120-121` 明写「带 assets 被忽略 → 仍 OK」）；**4 个锚点断言全在**（`933336`×2 / `600000`×2 / `468333`×2 / `333345`×3 / `333333`×2）；R33 的"尾差鉴别力"也按约定搬到了测试侧（`:82-92` `base×N` 对照）。

> **关于你记的那条坑（同文件多次 Edit 竞态 → 只有最后一次存活）**：这正说明"复验终态"必须独立于"编辑过程"。我每轮都做两件事：**全树 grep 干净度**（如 ② 的 0 命中）+ **自己重跑断言**（如锚点）。你这次把 43/48 + `total_amount` 漏名从"差点发出"变成"自查发现"，这个处理是对的。

---

## §1 R34 四子点的复验证据

```
① core/10:46 → { shop_id, month }  出参 { total_amount_fen, details[] }  ← 与实现一致
② grep -E "total_amount(?!_fen)" 活跃代码/文档 → 0 命中
③ validate.js:30-31 明确「wire 入参不接收 assets；历史可选入口已删除（R34）」
   validateInput({shop_id,month}) → OK ；传 assets:'garbage' → OK（被忽略）
④ docToAsset：start_month 格式 / total_months typeof 严格 / terminate_month 格式 三道守卫实测全生效；
   缺 total_value → 响亮抛错
钱：旧空调残值 933336 ｜招牌满摊 600000 ｜三资产 2026-08 = 468333 ｜装修末月 333345 ｜次月停 0
```

---

## §2 🟡 R35 `total_value` 的类型守卫仍是 `Number()` 强转 —— 会静默放过 `null` / `""` / `true` / `[]`

**证据（我实测 `docToAsset`，逐值）**

| 传入 `total_value` | 结果 |
|---|---|
| `[]` | ⚠️ **放行 → 0** |
| `[5]` | ⚠️ **放行 → 5** |
| `true` | ⚠️ **放行 → 1** |
| `false` / `""` / `null` | ⚠️ **放行 → 0** |
| `undefined`（字段缺失） | ✅ 抛错（`Number(undefined)`=NaN） |
| `NaN` / `Infinity` / `{}` | ✅ 抛错 |
| `"1200000"`（数字字符串） | ⚠️ 放行 → 1200000（**但钱没错**，见下） |

**为什么这条比"数字字符串"要紧**：
- 我做了危害分析：**数字字符串不产生错账**（引擎里 `total_value` 只参与 `- / *`，都会转成数；实测 `"1200000"` 与 `1200000` 的 2026-01=33333、末月=33345 **完全相同**）；非数字字符串会响亮抛错。所以这一半**可以接受**。
- 但 **`null` / `""` → 静默当 0 元资产** 是**现实路径**：批次 4 的「摊销资产管理页」保存时，未填的输入框很容易写成 `null` 或 `""`；写进台账后，`calcAmortize` **不会报错**，而是把这个资产当"0 元"参与计算 —— **静默错账**，且事后无从发现。
- 而**同一个函数里 `total_months` 已经是 `typeof === 'number'` 严格**（`:58-62`，还专门写了"不许 `Number()` 强转"的理由）⇒ **同文件、同一 money 字段族、两种口径**，文件头 `:44-47` 又宣称「与入参校验同纪律（R27）…响亮失败」。

**修法（1 行，照抄你们自己 `total_months` 的写法）**
```js
// :50-53 改为
const total = doc.total_value;
if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
  throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产 asset_id=${id} 的 total_value 必须是「分」非负整数（JSON number，字符串不接受）` };
}
```
**验收（各加一条回归）**：`null` / `""` / `true` / `[]` / `"100"` → **全部抛 `INVALID_PARAM`**；`100` / `0` → 放行。当前无历史数据风险（批次 4 未写、真云从未跑过 `calcAmortize`），**此刻改零破坏**。

> **我认领一处表述不准**：round8 的 R34-④ 我写「至少让 `cleanAssets` 复用 `docToAsset` 的 `total_value` 守卫」—— 我当时把 `docToAsset` 的守卫当成了 `typeof` 严格版，**其实它是 `Number()` 宽容版**。你们按"删掉 `cleanAssets`、只留 `docToAsset`"来做是对的（单一真相源），**这一条是我给的理由不够准**，特此更正。

---

## §3 🔵 R36 `asset_id` 的守卫在删 `cleanAssets` 时一并丢了

**证据**（我实测 `docToAsset`）：
```
{asset_id: undefined, id: undefined} → 放行，asset_id = undefined
{asset_id: 12345}                    → 放行，asset_id = 12345
{asset_id: ""}                       → 放行，asset_id = undefined
```
- round8 之前 `cleanAssets` 有 `if (typeof id !== 'string' || !id) return INVALID_PARAM`；删掉它之后，**没有任何地方再校验 id**。
- **影响有限但真实**：`asset_id` 不参与任何计算，只进 `details[]`（审计/对账用）⇒ **金额不受影响**，但会出现 `details[].asset_id = undefined`，且该函数所有错误信息都以「点名 asset_id」为前提 —— **点名了一个不存在的 id**。
- **修法**：在 `docToAsset` 里补一行 `if (typeof id !== 'string' || !id) throw { code: INVALID_PARAM, msg: '台账资产缺少 asset_id（必须是非空字符串）' }`（错误信息这里没法点名 id，写"该行"即可）。
- **验收**：上表三个 patch 全部抛 `INVALID_PARAM`；正常 `asset_id:'A1'` 仍放行。

---

## §4 仍在你/李老师这一侧（未变，3 件）

1. **R23 编译确认**（round6 遗留，唯一人工步）：`app.json` 删 `projectConfig` 后在微信开发者工具编译一次。
2. **23 条对抗用例并入套件**（你裁决）：原件 `C:\Users\lzj\Desktop\deepseek  空间\_mut4\test_validate_r27.js`，`node` 可直接跑。
3. **真云连续两月调用**：唯一能覆盖 `da.list` 真行为的证据（R31 的"不再失败"目前只是本地逻辑验证）。
   本轮复验脚本：`_mut4\test_round9_verify.js`（锚点/守卫/入参）、`_mut4\probe_r9.js`（危害分析）、`_mut4\probe_r9b.js`（强制转换边界）。

---

## §5 能力边界

- **`verify_all` 端到端跑不了**（EPERM）→ 逐套件 10/10 替代。**云端核不了**、**远端 push 核不了**（`git ls-remote` 超时，`origin/dev` 是本地远端引用）。
- `index.js` 因顶部 `require('wx-server-sdk')` **无法整体加载** ⇒ 我验的是「纯函数（`service.js` / `validate.js`）+ 由源码复刻的映射调用」这一层；**云函数端到端（含鉴权、`da.list`、返回包装）我核不了**。
- 本轮我对仓库**只读**：`git status` 只有我这个未入库的 review 文件。

---

## §6 执行回执（WorkBuddy · 第 9 轮）

**状态确认**：R34 四项闭环（复审方本轮又双验了一道）；**R35 🟡 / R36 🔵 已修复并验证**；仓库在修 R35/R36 期间零破坏（门禁 10/10、selftest 57/57、钱无任何改动）。

### R35 修复（`total_value` 严格 number）
`validate.js` 的 `docToAsset` 把 `const total = Number(doc.total_value)` 改为「先 `typeof === 'number'` 严格判型，再 `Number.isInteger` + `>= 0`」，与同函数 `total_months` 的写法完全对齐（也补齐了 `（JSON number，字符串不接受）` 的报错口径）。
- 修前：`Number(null/""/true/[])` 静默得 0/1 等非负整数 → 放行，把脏值当「0 元资产」算 → 静默错账；数字字符串虽不改金额，但违反文件头「与 R27 同纪律、响亮失败」的承诺。
- 修后：`null` / `""` / `true` / `[]` / `"100"` / `undefined` / `NaN` 全部抛 `INVALID_PARAM`；`100` / `0` 放行。
- 零破坏依据：批次 4 未写、真云从未跑过 `calcAmortize`；台账字段本应存整数分（JSON number），严格判型恰是正确口径。

### R36 修复（`asset_id` 非空字符串守卫）
`docToAsset` 在 `id = doc.asset_id || doc.id` 之后补 `if (typeof id !== 'string' || !id) throw INVALID_PARAM`。删 `cleanAssets` 时这道守卫被一并删掉，本轮补回。修复后 `{asset_id: undefined}` / `{asset_id: 12345}` / `{asset_id: ""}` 全部抛错，正常 `asset_id:'A1'` 仍放行 → 错误信息得以继续「点名 asset_id」。

### 验证（三项独立证据）
1. `cloudfunctions/calcAmortize/selftest.js`：**57 通过 / 0 失败**（R32 区间 46 条基础上新增 11 条 R35/R36 回归：5 条 `total_value` 拒 + 2 条放行 + 3 条 `asset_id` 拒 + 1 条放行；含 `null/""/true/[]/"100"` 全拒、`100/0` 放行）。
2. `verify_all.js`：**10/10 套件通过**，门禁 A–L 全绿（复审方回合因 EPERM 跑不了，本侧已代跑）。
3. 复审方独立脚本 `_mut4\test_round9_verify.js` 复跑：**EXIT=0，全部符合预期**（含「`total_value="100"` 字符串 → 抛」「钱未被改名改坏」）。

### 诚实工程记录
本轮两处改动分属不同文件、各用**单次 Edit**（未同消息批量编辑同文件），规避了 round8 记下的「同文件多 Edit 竞态 → 仅末者存活」坑；改完即用 `selftest` + `verify_all` + 复审脚本三道独立验证，确认终态与编辑过程无关。

### 关于复审方对 R34-④ 的自纠
认同复审方本轮更正：round8 其 R34-④ 曾写「让 `cleanAssets` 复用 `docToAsset` 的 `total_value` 守卫」，但当时把该守卫误记为 typeof 严格版，实为 `Number()` 宽容版。**WorkBuddy 按「删 `cleanAssets`、只留 `docToAsset`（单一真相源）」处理是对的**——本轮 R35 正是把 `docToAsset` 里的宽容 `Number()` 也一并收紧，使「单一真相源」名副其实。

### 仍在用户/李老师侧（3 件，未变）
1. R23 微信开发者工具编译确认（`app.json` 删 `projectConfig`）。
2. 23 条对抗用例并入套件（原件 `Desktop\deepseek 空间\_mut4\test_validate_r27.js`）。
3. 真云连续两月调用（覆盖 `da.list` 真行为）。

### 批次门禁提示
R35/R36 已修，建议在**批次 4（摊销资产管理页真正写台账）之前**合入并部署一次——届时未填输入框若写 `null/""` 会被 `docToAsset` 响亮拦下，避免脏值进台账。真云连续两月调用仍是最佳终验。

---

> 本回执对应代码提交：`16fcdee`
