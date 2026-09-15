# REVIEW_2026-09-15 round7 · 批次 2（calcAmortize）复核 + 对 3 个判读点的裁决

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 7 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round6-verify.md`；本轮对象 = `f94f5e0` / `b05cc68`（批次 2 落地）。

---

## §0 结论

**流程与钱都对，但有 1 个 🔴：这个云函数「第二次调用必然失败」—— 你们列为「判读点①」的那条，比判读点严重一档。**

| 项 | 结果 |
|---|---|
| 提交/推送/工作树 | ✅ `b05cc68` = HEAD = `origin/dev`；无未推；`git status` **干净**；`review/` **10 份全部入库** |
| 总闸 | ✅ 门禁 exit 0；**逐套件 10/10**（`verify_all` 我跑不了，EPERM） |
| `SUITES` | ✅ 10 项，含 `batch2 代码自测` |
| **4 个 POC1 锚点** | ✅ **我按规范手算后拿引擎对，全部一致**（见 §1） |
| 边界/推论 | ✅ 12 条：当月即摊 / 终止月仍摊 / 到期月仍摊 / 次月停 / 单期资产 / 整除 / 跨年 / 每资产独立尾差 |
| 平铺结构 | ✅ `calcAmortize/` 为扁平 `common.js` + `cx_*.js`，无子目录（L 组绿） |
| 🔴 **第二次调用必失败** | ❌ **我复现了**（§2） |
| 🟡 脏台账守卫缺两条 | ❌ 我实测出两条静默错账路径（§3） |

---

## §1 我独立复算的锚点（**先手算，再对引擎**）

手算依据：月摊 = `round(原值 ÷ 总月数)`（分）；自然到期末月 = 原值 − 前(N−1)期合计（尾差倒挤）；提前终止末月仍用 base，未摊余额单列残值；区间两端含。

| 锚点 | 我的手算 | 引擎输出 | 结果 |
|---|---|---|---|
| A1 旧空调（12000元/36期/2026-01 起/**终止 2026-08**）残值 | base=33333；8 期 → 1200000−266664 = **933336** | 933336 | ✅ 9,333.36 |
| A2 招牌（6000元/12期）满摊 | base=50000；末月倒挤 → **600000** | 600000 | ✅ 6,000.00 |
| B 三资产 2026-08 合计 | 装修 333333＋加盟费 125000＋冰柜 10000 = **468333** | 468333 | ✅ 4,683.33 |
| B1 装修末月 2028-12 | 12000000 − 333333×35 = **333345** | 333345 | ✅ **3,333.45**（不是 3,333.33） |

**边界另测 12 条全部符合**：开始当月即摊、终止当月仍摊、到期当月仍摊、**次月停**（2028-03/2029-01 均为 0）、开始前为 0、单期资产当月=全额、整除无尾差、跨年区间（2026-11 起 4 期 → 末月 2027-02）、**每个资产全周期合计严格 === 各自原值**（独立尾差，未合并）。
**尾差判据有鉴别力**：我复用了引擎的 `opts.mutateNoTail`，装修末月立刻从 333345 掉回 333333 ⇒ 你们那条"删尾差行 → 42 条转红"的变异方向是对的。

---

## §2 🔴 R31 `calcAmortize` **第二次调用必然失败**（根因：把明细写进了资产主档表）

**你们的判读点①（「回写行缺 total_value → 二次读 docToAsset 会抛」）我判为不是"隐患"而是"必然"，并且已复现：**

- **证据链**（我把 `index.js:62-76` 的 `docToAsset` 与 `:82-92` 的插入对象**逐行照抄**后做等价验证，因 `index.js` 顶部 `require('wx-server-sdk')` 本地装不了）：
```
第一次运行：total_amount = 83333（分）；写库记录 2 条
写库字段 = shop_id,month,asset_id,name,amount_fen,start_month,total_months,terminate_month,residual_loss,is_deleted,created_at,updated_at
        ← 注意：**没有 total_value**

第二次运行 da.list('shop_amortize',{shop_id}) 返回 4 行（资产主档 2 + 上回写回的明细 2）
🔴 抛错：{"code":"INVALID_PARAM","msg":"台账资产 asset_id=A1 的 total_value 必须是「分」非负整数"}
```
- **前提①我从源码核实了**（不靠假设）：`cloudfunctions/common/dataAdapter.js:16-19`
  ```js
  async function list(coll, where, extra) {
    const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
    return db.collection(coll).where(cond).get();
  }
  ```
  即 `list('shop_amortize', { shop_id })` **只按 `shop_id` + `is_deleted:false` 过滤**，不区分行类型 ⇒ 写回的明细行**一定**会被读回来。而 `insert`（`:49-54`）注入的 `is_deleted:false` 也保证了这些行不会被软删过滤掉。
  前提②：该店至少 1 个资产（否则第一次写入 0 行，第二次自然不报错）。
- **为什么"必然"**：只要该店**至少有 1 个资产**，第一次调用就必然写入 ≥1 行明细；这些行同店、同集合、`is_deleted=false`，于是第二次的 `da.list` 一定把它们当资产读回来 → `Number(undefined)` = NaN → `docToAsset` 抛错。
- **为什么后果是整函数失败**：`index.js:41-42` 的 `(readRes.data||[]).map(docToAsset)` **不在任何 try 内** ⇒ 异常直接冒泡出 `exports.main`，云函数整体报错（不是"某条资产跳过"）。
- **根因不是"忘了写 total_value"，是表用错了**：`shop_amortize` 是**资产台账（主档）**，而 `writeMonthlyAmortize` 把**月度明细**（month/amount_fen/residual_loss）也塞进同一张表，两类行的 schema 不兼容。
- **同时它越了契约**：`core/10:46` 明确 `calcAmortize` 是「**纯计算**（Service 层）」、出参 `{ total_amount_fen, details[] }` **给批次 1 的 `amortizeFen` 用**；**契约里没有"写库"这件事**。写库是这次实现自己加的动作 —— 正是它制造了上面的自噬。

**修法（推荐 A；**不要**用 B）**
- **A（推荐）**：**删掉本次写库**，让 `calcAmortize` 回到契约的"纯计算"。月度摊销总额由调用方（批次 1 `saveLedger` / 批次 4 页面保存）落到该有的地方（`shop_monthly_account` 的月度记录）。
  若确实需要"逐资产/逐月明细"持久化，那是**规格变更**，要按既有四步走：先在 `core/15 集合权限矩阵` + 批次 0 §2.4 表清单里**新增一张明细集合**（如 `shop_amortize_detail`）→ `cloudfunctions/initDb/collections.js` 同步 → **带 `(shop_id, month, asset_id)` 唯一索引** → 再写。**绝不能塞进 `shop_amortize`**。
  若只是想留痕审计：写 `audit_log`（只 INSERT，本就为留痕设计，action 如 `M1_AMORTIZE_CALC`）。
- **B（不推荐，务必别做）**：在 `docToAsset` 里"发现没有 `total_value` 就跳过这行"。
  那是**静默兼容**：既掩盖了"两张表混用"这个真问题，又留下"同一资产主档被明细行重复计数"的隐患 —— 与本项目反复清理的"±0.01 容差 / amountFen 双收 / 门禁豁免表"是同一族病。
  > 顺带说：现在这样**响亮抛错**反而是对的行为 —— 错的是上游写库，不是这个守卫。

**验收**：连续调用两次 `calcAmortize`（同一店、同一月、下一月各一次）→ 第二次**不再报错**；`shop_amortize` 里**只有资产主档**（行数 = 资产数，不随运行次数增长）；门禁 + 逐套件仍绿。

---

## §3 🟡 R32 `docToAsset` 少两道守卫（我实测出两条**静默错账**路径）

**已守的**：`total_value` 被 `Number.isInteger(total) && total >= 0` 守住（`:65-67`）—— 所以你的判读点③"对 DB 读数宽容"**只对了一半**：浮点/负数会被响亮拒掉 ✅；**但另两个字段没守**：

| 脏数据 | 我的实测结果 | 危害 |
|---|---|---|
| `start_month = 'bad'` | 该资产在 **2030-01 仍摊 33333 分**、`residual` 报**全额 1200000** | 「区间」退化成**每月都摊、无限期** —— 静默错账（`parseMonthIndex` 出 NaN，`mi < NaN`/`mi > NaN` 恒 false，于是穿过区间判断落到 base 分支） |
| `total_months = '36'`（字符串） | 2026-02 正常 33333，但 **2030-01 仍是 33333**、**5000-01 仍是 33333**；**全周期合计 === 原值（1200000）** | 更阴：`start + "36" - 1` 变成字符串拼接 → 行列区间算飞，**而"合计"这一层看不出错** |
| `total_months = 0` | 返回 0 | 侥幸安全（区间退化后恰好落在"区间外"分支），但属"碰巧对" |

**修法（3 行）**：在 `docToAsset` 里补两条断言——
`start_month` 必须匹配 `^\d{4}-(0[1-9]|1[0-2])$`；`total_months` 必须是 **≥1 的整数**（`typeof === 'number' && Number.isInteger && >= 1`）。不符 → 抛 `INVALID_PARAM` 并**点名 asset_id 与字段**（沿用你们已有的错误风格）。
理由：台账是"唯一可信源"，而这两条路径会**静默产出错账**；本项目对涉金额缺陷的标准是 P0 级响亮失败。**不阻塞批次 3**，但建议在批次 4（页面会真正驱动它）之前修掉。

---

## §4 🔵 R33 生产 Service 里留着"关掉尾差倒挤"的测试开关

- `service.js:79-92`：`calcAmortize(assets, targetMonth, opts)`，`opts.mutateNoTail=true` 时**末月不做尾差倒挤**（我实测：装修末月从 333345 掉回 333333）。
- **当前不可达** ✅：`index.js:45` 只传 `(assets, v.month)`，线上没有第二个 `opts` 来源 —— 所以**不是漏洞**。
- 但它是个**金额旁路开关长在生产函数签名里**：将来谁给 Controller 加一行"透传 opts"（很常见），就变成**外部可关掉尾差倒挤**。
- **建议**：把变异口移出 `service.js`（例如 `selftest` 自己包一层"末月沿用 base"的实现），或至少把参数改名成 `__testOpts` 并在 `index.js` 那行加注释"禁止透传任何 opts"。可变异的验证方式保留在测试侧即可。

---

## §5 对你们 3 个判读点的正式裁决

| # | 你们的提问 | 我的裁决 |
|---|---|---|
| ① | `shop_amortize` 回写行缺 `total_value` → 二次读 `docToAsset` 会抛 | **升级为 🔴 R31** —— 不是"会抛"的可能，而是**首次调用后必然发生**（§2 已复现）。修法 = 删写库回契约（或换表/落 `audit_log`），**禁止用"跳过无 total_value 的行"兜底**。 |
| ② | 回写纯 INSERT 无幂等 | **随 ① 一并消解**（不再往主档写明细就没有重复问题）。**若你们选择保留落库**：必须带 `client_request_id` 幂等 + 新表上的 `(shop_id, month, asset_id)` 唯一索引，否则重跑翻倍、且会与 ① 叠加成"越跑越坏"。 |
| ③ | `docToAsset` 用 `Number()` 对 DB 宽容，与 `validate.js` 对入参严格是两套口径 | **部分成立**：`total_value` 已严格 ✅；缺的是 `start_month` / `total_months` → 见 **R32**。两套口径本身**不是缺陷**（入参=外部不可信、DB=内部可信源），但**内部可信源也得守"结构合法性"**，因为它是"唯一真相源"。 |

---

## §6 仍在你/李老师这一侧（沿用 round6，未变）

1. **R23 编译确认**：`app.json` 删 `projectConfig` 后在微信开发者工具编译一次（影响面 1 文件 3 行、零消费者）。
2. **23 条对抗用例**：文件已在 `C:\Users\lzj\Desktop\deepseek  空间\_mut4\test_validate_r27.js`（我写的，可直接跑：`node <该文件>`）。**建议并入你们套件**（放 `cloudfunctions/calcMonthlyProfit/__tests__/` 或把 `selftest.js` 的 4 条扩成这 23 条），这样 R27 的回归不会只靠"我那一次跑过"。
   > 我不替你造一份"猜测版"是对的 —— 我的资产我给原件，你决定怎么入库。
3. 本轮的对抗脚本同样在我的工作区，可复跑：`_mut4\test_amortize_r7.js`（锚点+边界）、`_mut4\test_amortize_secondrun.js`（R31 复现）。

## §7 能力边界

- **`verify_all` 端到端跑不了**（EPERM）→ 逐套件 10/10 替代。**云端核不了**（`calcAmortize` 从未在真云跑过；R31 是**本地等价验证**：`docToAsset` 与写库对象按源码逐行照抄 + 真引擎算 details）。**远端 push 核不了**。
- R31 的"必然"结论依赖两个前提：① `da.list` 会返回同店 `is_deleted=false` 的明细行（按 DataAdapter 语义）；② 该店至少 1 个资产。两者都成立时结论成立 —— 若你们认为 `da.list` 对 `shop_amortize` 另有过滤，请把那条过滤贴出来，我按新证据重判。

---

## §8 WorkBuddy 执行回执（2026-09-15）

> 本轮动作：独立验证 R31/R32/R33 的复现与修法 → 执行三处修复 → 自跑门禁与自测 → 入库。

### 验证（先复现，再修）
- **R31 复现**：用真实 `docToAsset`（抽到 `validate.js` 后纯函数可测）+ 假 `DataAdapter`（`list` 只按 `shop_id+is_deleted:false` 过滤，逐字复刻 `dataAdapter.js:17`）跑「读台账→map→calc」链路。`/tmp` 验证脚本 5 项全绿：两次连续调用**不抛错**、`shop_amortize` 行数**不增长**、污染表（明细行混入）仍**响亮抛 `INVALID_PARAM`**、三资产 2026-08 合计仍 **468333**（口径未动）。`docToAsset` 缺 `total_value` 的明细行一定会触发抛错 —— 与你的"必然"一致，且确认 bug 根因是**写库制造自噬**，已消除。
- **R32 复现**：`docToAsset` 旧实现把 `start_month`/`total_months` 透传不守 → 静默错账路径成立（尤其 `total_months='36'` 字符串经 `Number()` 强转会放行，但进引擎后 `start+"36"-1` 字符串拼接区间算飞）。

### 修复
- **R31（删写库）**：`index.js` 删除 `writeMonthlyAmortize` 函数及其调用（`:48`/`78-98`），`calcAmortize` 回到契约 `core/10:46`「只算不写」，返回 `{total_amount, details}` 供调用方落到 `shop_monthly_account`；顶部注释同步。未做 B 方案（"跳过无 total_value 的行"），因那是静默兼容。
- **R32（守卫）**：把 `docToAsset` **抽到 `validate.js`**（纯函数、可单测，沿用 R27 抽 `validate.js` 的同款套路），补三道断言：`start_month` 必须 `MONTH_RE`、`total_months` 必须 `typeof==='number' && 整数 ≥1`（**用 typeof 拒绝字符串 `"36"`**，不用 `Number()` 强转）、`terminate_month` 非空时也必须 `MONTH_RE`。`index.js` 改为 `require('./validate').docToAsset`，本地定义删除。
- **R33（移测试开关）**：`service.js` 的 `amountForMonthFen/calcAmortize/calcAmortizeSchedule` 删除 `opts` 参数与 `if(opts&&opts.mutateNoTail) return base` 分支 —— 尾差倒挤是金额硬逻辑，不在任何开关后。selftest 的"变异回验"改为 **base×N ≠ 原值** 对照证明鉴别力，不依赖生产钩子。

### 验收
- `node cloudfunctions/calcAmortize/selftest.js` → **48/48（EXIT=0）**（原 42 → +6 条 R32 回归；尾差变异测试改写）。
- `node verify_all.js` → **10/10（EXIT=0）**；门禁 A–L `check_error_codes.js` exit 0；`tools/check_requires.js` 静态路径 exit 0。
- R19 纪律保持：金额锚点整数分严格 `===`，无 ±0.01 容差；R32 的 `total_months='36'` 用例证明 **typeof 判型对字符串有鉴别力**（这正是 R33 删除 `Number()` 强转的原因）。

### 提交
- `8ce59b1`（含 `cloudfunctions/calcAmortize/{index,service,validate,selftest}.js` 修复 + 本回执 + round7 入库），`git push origin dev`。

### 仍在你/李老师侧（不擅自造）
- **R23 编译确认**：`app.json` 删 `projectConfig` 后于微信开发者工具编译一次（沙箱无工具）。
- **23 条对抗用例**：原件在 `C:\Users\lzj\Desktop\deepseek 空间\_mut4\test_validate_r27.js`（你的资产），是否并入 `calcMonthlyProfit` 套件由你裁决；本轮未替你造猜测版。
- **本轮复现脚本**：`_mut4\test_amortize_r7.js` / `_mut4\test_amortize_secondrun.js` 在你工作区，可复跑；我的独立验证另用 `/tmp/verify_r31.js`（不入库）。
