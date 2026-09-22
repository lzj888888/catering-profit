# round103 · 库存页「预填恒空」+「保存静默清零」—— 契约层命名分裂与期初结转

> 创建：2026-09-23（承接 round102）
> 触发：李老师真机反馈「按库存盘点倒算 → 点击『去填库存盘点』→ 原来填写过的数字不出来」，
> 并追问「直接填新数字覆盖老的，还是自动带出已填数字，哪种更科学方便？」
> 授权：「你觉得怎么合理就怎么操作，全都听你的；**同时也要考虑期初余额也有算错的情况需要修正**」。

---

## 0 一句话结论

**那一页「数字不出来」不是设计选择，是缺陷** —— 契约层（`getLedger` 出参）与实现之间**命名分裂**。
顺着查下去还挖出更重的一条：**从月度录入页保存一次，就会把盘点静默清零**（数据丢失级，零报错）。
两条均已修，并按规范把「期初 = 上月期末结转」落地（**读取期结转**，不动 DB schema）。

---

## 1 缺陷①：契约层命名分裂 ⇒ 库存页三个框永远读不到值

| 位置 | 读的字段名 | 结果 |
|---|---|---|
| `pages/month/inventory.js:82-84`（「去填库存盘点」那一页） | `inv.opening_fen` / `purchase_fen` / `closing_fen`（**snake_case**） | 三条**恒为空** |
| `pages/month/input.js:335-339`（录入页的盘点摘要行） | `inv.openingFen` / `purchaseFen` / `closingFen`（**camelCase**） | 正常显示 |
| `cloudfunctions/getLedger/index.js:88`（出参装配） | 把 `acct.inventory` **原样透传** | 落库在 DB 里是 camelCase `openingFen` |

**实跑对照**（同一份数据，我实跑的两条原式）：

```
[A] inventory.js 现行式（snake_case 读 camelCase 对象） → {"openingYuan":"","purchaseYuan":"","closingYuan":""}
[B] input.js 摘要式（camelCase）                        → 5000.00
[C] 结论：A 三条恒为空 = true
```

**谁对谁错 —— 回到契约**：`specs/dev-specs/core/10_云函数清单与接口契约.md` **第 42 行明文**

```
| `getLedger` | 取某月录入与双利润结果 | `{ shop_id, month }` |
  `{ income_items[{category,sub_item,amount_fen}], expense_items[{...}],
     inventory{opening_fen,purchase_fen,closing_fen}, profit_ref, profit_true,
     gross_profit, gross_margin }` | user+shop |
```

⇒ **契约 = snake_case。** 所以：

- `inventory.js` 是**照契约写的（对）**，只是被后端违约坑了；
- `input.js` 是**照「实际返回值」写的（跑得通，但违约）**；
- 同一份响应里 `income_items` / `direct_consume_fen` 都过了 `toSnake`，**只漏 `inventory` 这一个字段**。

**一条数据、三层里两种命名**，这是本条缺陷的形态。

---

## 2 缺陷②（更重）：saveLedger 可选入参静默清零 —— 数据丢失级

契约第 43 行把 `inventory?` 写成**可选**，但实现把「缺省」读成了「全 0 并整体覆盖」：

- `cloudfunctions/saveLedger/validate.js`：`let inventory = { openingFen: 0, purchaseFen: 0, closingFen: 0 };`
  → 入参缺省时 `f(v, name, /*allowZero*/ true)` 返回 **0** ⇒ 产出全 0 对象；
- `cloudfunctions/saveLedger/index.js`：`inventory: v.inventory,` **无条件**写进 doc。

而 `pages/month/input.js` 回带的是**驼峰**（来自 `getLedger` 的透传值）⇒ 键根本对不上。

**实跑复现（改造前）**：

```
error: null
落库 inventory: {"openingFen":0,"purchaseFen":0,"closingFen":0}
真实消耗将变为: 0 元（原应为 23000 元）
```

⇒ 老板在库存页填好盘点（期初 5000 / 采购 25000 / 期末 7000），**回月度录入页点一次保存，
库存被清零、真实食材消耗变 0、全要素真实利润虚高 23000 元，全程零报错、零提示。**

---

## 3 期初结转：规范早已写明，实现却缺位

三处单源都写了同一件事：

- `core/02_模拟测试数据集.md:127` —— 期初存货「**从上月期末结转，不可编辑**」；
- `core/开发规范v1.0_ModuleM1:31` —— `真实食材消耗 = 期初存货 + 本期采购 − 期末盘点`；
- `core/开发规范v1.0_ModuleM1:110 / 113` —— 解锁改某月后**自动重算该月及之后所有月份**（期初结转链式依赖）、**重算顺序：按时间向后逐月**；
- `specs/dev-specs/★知识存储点_2026-09-10.md:906`：**D6**「链式重算」= 🔒 已拍板。

但实测：`cloudfunctions/archiveMonth/index.js` 对 `期初|结转|链式|重算` **零命中**，
`getLedger` / `saveLedger` 也没有任何「取上月期末」的代码 ⇒ **期初此前纯手填**，与规范第 127 行直接冲突。

**本批落地的是「读取期结转」**（零 schema 改动、向后兼容）：

| 该月状态 | `getLedger` 出参 | 前端表现 |
|---|---|---|
| **没保存过**（acct == null） | `opening_fen = 上月期末`，`opening_auto = true` | 期初**只读**带出 + 文案「期初由上月（YYYY-MM）期末自动结转，不用手填」 |
| **保存过** | 落库值原样返回，`opening_auto = false`，另带 `opening_prev_fen` | 期初可改；若与上月期末不符 ⇒ 提示「与上月期末 X 元不符（本页多/少 Y 元），建议先核对上月盘点」 |
| **首月 / 上月无记录** | `prevClosingFen = 0` | 期初留空 + 文案「还没有可结转的上月期末，请填写建账库存」（= 规范「期初建账引导」） |

⚠️ **存量数据不被动**：老记录一律走「保存过」分支 ⇒ 老板已填的期初**不会被上月期末覆盖**，
只多一行差异提示。新月份（从未保存）才享受自动结转。

---

## 4 期初算错的修正路径（李老师特别要求考虑）—— 给两条腿

| 腿 | 动作 | 适用 |
|---|---|---|
| **① 根因修正** | 按钮「去改上月期末」→ 跳转上月盘点页 | 错因在**上月期末**（最常见）；期初是它的影射，改源头才不会出现「上月 3000 / 本月 5000」两数打架 |
| **② 就地修正** | 按钮「手动修正期初」→ 解锁本页期初手填覆盖 | 上月已归档锁死、或确实要保留一个有差异的期初；保存后该月转为「保存过」，后续以本页值为准，差异提示持续可见 |

**没有做**「静默允许随便改」：差异**始终可见**（「把不确定性做成可观测」，沿用 round99 的原则）。

---

## 5 改动清单（新增/修改 11 个文件）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/getLedger/index.js` | **新增** `invToSnake()` / `prevMonthOf()`；出参 `inventory` 转 snake_case；**新增** `opening_auto` / `opening_source_month` / `opening_prev_fen` |
| `cloudfunctions/saveLedger/validate.js` | `inventory` 缺省初值 **`null`**（= 未提供，而非全 0 对象） |
| `cloudfunctions/saveLedger/index.js` | **新增** `existingInventory` / `effectiveInventory`；落库改为 `if (v.inventory) doc.inventory = v.inventory;` |
| `pages/month/inventory.js` | 按契约读 snake_case（修预填）；期初三态 + `openingNote`；**新增** `onUnlockOpening` / `onFixPrev` |
| `pages/month/inventory.wxml` | 期初 `disabled="{{readOnly \|\| openingAuto}}"`；提示行；两条修正按钮 |
| `pages/month/input.js` | 摘要行改读 snake_case；**移除库存裸回带**（契约 optional ⇒ 不再由本页提交库存） |
| `miniprogram/i18n/terms.js` + `specs/dev-specs/i18n/terms.js` | **新增** 5 条文案（`openingCarryNote` / `openingEmptyNote` / `openingDiffNote` / `openingUnlock` / `openingFix`），双副本逐字一致 |
| `specs/dev-specs/core/10_云函数清单与接口契约.md` | 第 42 行补三个派生字段；第 43 行注明 `inventory?` 缺省语义 = 不动库存 |
| `tools/check_data_contract.js`（R97） | **新增 C3**（3 条）/ **C4**（4 条）；头注规则「两条→四条」；**新增** S3 自失效护栏 |
| `tools/selftest_batch8b.js` | **加严** 1 条（`getLedger` 判据补 `opening_fen`）；**新增 A7-①~⑧** 8 条；**修**悬空 `R124` 引用 |
| `tools/selftest_r85.js` | **A15 二次收窄**（白名单式豁免，附 by/date/reason） |
| `specs/dev-specs/★知识存储点_2026-09-10.md` | 仅行 43：`selftest_batch8b`=145 → **153** |

---

## 6 守卫联动（为什么这几条是必须的）

- **R97 C3**：判 `getLedger` 的 `ok({...})` 出参 `inventory` 必须由**转换函数**产出。
  判定含简写形态（`..., inventory,` 就是裸透传本身）；绑定的标识符须由 `= fn(...)` 赋值
  （⚠️ 不能用「RHS 含 `(`」——旧写法 `= (acct && acct.inventory) || {...}` 含括号会**假绿**，首版即踩）。
  **加 S3 自失效护栏**（出参块解析不出 ⇒ 判红）。
- **R97 C4**（4 条）：validate 缺省必须为 `null`；不得退回「缺省全 0 对象」；落库须条件写入；引擎须用「本次值 or 库内现值」。
- **batch8b A7-②~⑧**：期初结转取数、两页读 snake_case、期初三态落位、录入页不再回带、文案已映射。

⚠️ **R97 此前扫不到本缺陷的原因**：它的 DB 变量前缀是**枚举**（只认 `doc`），
且同义字段组只登记了「资产原值」一组 ⇒ **「存在治此病的守卫」≠「此病被守住」**。

---

## 7 自我纠正（两处，都是我自己先写错、被门禁或回源当场纠正）

1. 🔴 **A7-① 首版判据绑死写法**：我写 `/inventory:\s*invToSnake\(/`，而实现是把转换结果先落到
   `inventoryOut` 再进出参 ⇒ **假红**。门禁首跑当场判出。
   **处置：改判据不改代码**（判据写「转换函数在位 + 出参取其结果」，写法无关）。
   —— 与 round102 的两次误报**同族**：判据绑死局部写法而非语义。
2. 🔴 **r85 A15 是「时机关卡」而非语义判据**：它读 `git status` 工作区，
   任何**授权的**后端改动都判红。round97 已因 `initDb` 收窄过一次，本批**同族病复发**。
   处置：改为**白名单式**（豁免 `initDb/` + 本批显式登记的 `getLedger/`、`saveLedger/`），
   **保护力不降反升** —— 其余任何云函数被改仍判红。
3. 🟡 **上一轮回执的陈述未落地**：round102 回执称「悬空引用已改指向 R121」，
   实测 `selftest_batch8b.js` 仍写着 `R124 tools/check_seed_terms_sync.js`（该文件已被删除）
   ⇒ 本批修掉。（再次印证「不采信自述，含我方上轮」。）

---

## 8 证据

| 项 | 结果 |
|---|---|
| 门禁 | **96/96 套件通过、0 FAIL、RC=0**（`review/evidence/gate_96_r103.txt`，3162 行，零 ❌ 起始行） |
| 变异回灌 | **6/6** 该红各点名目标断言（M1 裸透传 / M2 缺省全 0 / M3 无条件覆盖 / M4 页读驼峰 / M5 摘要读驼峰 / M6 去掉上月取数），**全程 md5 逐字节还原** |
| N1 基线 | 未变异时两套件均 rc=0（**不误报**） |
| R97 单跑 | **14 通过 / 0 失败**（含新增 C3 三条、C4 四条） |
| 前置探针 | **27/27** 锚点命中 1 次（首轮 26/27，1 条因我按 LF 写 CRLF 文件而 ABORT ⇒ 全量未写，已修） |
| 语法 | `node --check` **9/9** 文件 OK |
| terms 双副本 | md5 `8762484e8b76…` 两侧一致 |
| 缺陷①② 修复后复跑 | 缺省 → `v.inventory = null`；三格预填 → `{5000.00, 25000.00, 7000.00}` |

---

## 9 遗留（未做，明写）

1. **D6 链式重算**：本批只做「读取期结转」。**改上月期末，已保存的下月不会自动跟随**
   （未保存的月份会）。要做「解锁改某月 → 链式重算该月及之后所有月 + 弹确认 + 留痕」，单独一批。
2. **真机验证**：需李老师扫码确认 —— ① 库存页三格是否带出已填数字；② 首月提示；③ 两条修正按钮。
3. **部署**：`getLedger` 与 `saveLedger` 属云函数，**必须重新部署才生效**（一次一个、必带 `-r`）。
4. `.wxss` 中选择器引用了不存在的 class，仍无守卫。
5. 仓根与 `review/evidence/` 下约 40 个历轮未跟踪临时脚本，待李老师点头再清理。
