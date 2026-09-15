# REVIEW_2026-09-15 round3 · 批次 1 交付复核 + 上一轮待办落盘状态

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 3 轮**。
> 用户口令：「已落盘」。**新开文件**（协议 §2：不改自己过去的文件）。
> 上游：`REVIEW_2026-09-15_round2-verify.md`（R12–R18）。

---

## §0 一句话结论（先说最要紧的）

**用户说「已落盘」，但 `R12–R18` 一条都没落地** —— 逐条实测全部停留在第 2 轮之前的状态（见 §1 状态表）。
真正落盘的是**别的东西**：`f76f539`（工序 3 文案）+ **`474f38e` 批次 1 交付**（InsCode 投喂产出，POC3 双利润引擎进仓库）。

⇒ 所以本轮我把力气放在**新落地的批次 1 代码**上，并**对它查出了 2 个 🔴**（§2）。同时**协议出现断点**：我上一轮的 `REVIEW_*` 既没有被入库、也没有被追加 §3 回执（§3）。

---

## §1 `R12–R18` 落盘状态 = **全部未落地**（逐条实测）

| 条 | 内容 | 实测结果 | 证据 |
|---|---|---|---|
| **R12** 🔴 | docx/pdf 陈旧派生副本 | ❌ **未动** | `SMOKETEST_RUNBOOK.docx` 仍 09-14 15:05（`.md` 09-15 11:35）、`新手上云操作手册.docx` 09-14 15:05、`下一步工序清单.docx` 09-14 16:29、`.pdf` 09-13 19:46 |
| **R13** 🟡 | 补 push | ❌ **未做** | `origin/dev` = `655ca26`；未推 = **3 个**（`9feb733`、`f76f539`、`474f38e`） |
| **R14** 🟡 | Runbook 步骤 6 行号 + 自相矛盾 | ❌ **未动** | `第 14–15 行` ×1、`判据④唯一未完项` ×1 仍在；`第 17 行`/`仅剩 prod` 命中 0 |
| **R15** 🟡 | Runbook `:52` appid 现状 | ❌ **未动** | `现状：`project.config.json` 的 `appid`` ×1 仍在 |
| **R16** 🔵 | 重启键 `:59` 判据④第三处 | ❌ **未动** | `未完成（待你建环境后替换` 命中于 `★知识存储点:59` |
| **R17** 🔵 | 3 处同事实残留 | ❌ **未动** | 手册 `:192`、工序清单 `:255`、Runbook `:37` 全在 |
| **R18** 🔵 | `DOC_PAIRS` 加第三项 | ❌ **未动** | `check_error_codes.js:546` 仍是 2 项；`:558` 写死组名未改 |
| — | 我的裁决①（删 `app.json` 的 `projectConfig`） | ❌ **未动** | `app.json:13-15` 仍是 `"appid": "touristappid"` |

> 条目内容**不变**，原样顺延 —— 执行时直接看 `REVIEW_2026-09-15_round2-verify.md §1`（R12–R18），不必重写。
> **门禁仍 exit 0**（我跑过），所以这些**不影响门禁绿灯**，但 R12 影响的是**你会打印/递出去的那份文档**。

---

## §2 批次 1（`474f38e`）复核 —— 2 个 🔴（本轮的新东西）

**先说结论：批次 1 的引擎本身写得好，两个 🔴 都不在算术上，而在「验证的鉴别力」和「契约」上。**

### 先记下它做对的地方（我逐项核过）
- ✅ **口径锁真守住了**：`service.js:67-69` 的经营参考利润用的是 `directConsumeFen`，**库存开关开着也不改用倒轧**；`selftest.js:100` 还用**严格等值**再钉了一道。
- ✅ 12 条锚点实测 **12/12 通过**、`口径锁专项 ✅ 锁成立`、`diffCheck` 三场景 true。
- ✅ **分层铁律守住**：`service.js` 不 require `wx-server-sdk`、不碰 DB（纯函数）。
- ✅ **扁平副本铁律守住**：`calcMonthlyProfit/` 是 `common.js` + `cx_*.js`，**无子目录** → 门禁 L 组绿。
- ✅ 已登记 `core/10 §3`（`:39` 有 `calcMonthlyProfit` 行）。
- ✅ 跑它**不会写盘**：`node selftest.js` 后 `git status` 无新增改动。

---

### R19 🔴 批次 1 自测在「差 1 分」上**不可靠**：同一种误差，有锚点拦下、有锚点放行（N11 纪律回退）

**做法（对抗性变异，**全程在会话工作区副本上做，仓库一字未改**）**：把 `service.js` 拷到工作区，只改一处 —— 让 🔵 全要素真实利润 `+1 分`（模拟"引擎末步取整不对/多算一分"），再跑**它自己的** `selftest.js`。

**实测（同一份变异，三条锚点三种结果）**
```
| 6  | S1  | 🔵全要素真实利润 | 9160    | 9160.01 | ❌ 失败   ← 拦下
| 9  | S2  | 🔵全要素真实利润 | 3476.67 | 3476.68 | ✅ 通过   ← 放行（被掩膜）
| 12 | 2-R | 🔵全要素真实利润 | 5476.67 | 5476.68 | ❌ 失败   ← 拦下
差异自洽校验（经营−全要素=差异）：S1=false S2=false 2-R=false   ← 打印了，但没断言
```
**为什么会这样（我算了浮点差，不是猜）**
```
|9160.01  - 9160|   = 0.010000000000218278728  > 0.01 → ❌ 拦下
|3476.68  - 3476.67| = 0.0099999999997635313775 ≤ 0.01 → ✅ 放行
|5476.68  - 5476.67| = 0.010000000000218278728  > 0.01 → ❌ 拦下
```
⇒ **判据不是「是否差 1 分」，而是「这个数在二进制里恰好落在容差的哪一边」**。而**被放行的第 9 条恰好是 S2 那个冻结锚点**（3476.67）。

**为什么算 🔴（不是吹毛求疵）**
- 这**正是本项目已经修过一次的病**：`N9`（引擎裸值被测试侧掩膜）、`N11`（`test_poc2` 的 `±0.01` 容差在掩盖 12.09 → 增 `strict`、金额类改**整数分**断言）、`N17`（扩到红油/麻辣）。**批次 1 的新自测把这条纪律退回了**。
- 节点② 的判据本来就是「**落库整数分、不接受靠测试侧取整**」（`★知识存储点 §1.1` 节点②原文）。若沿用现在的自测，节点② 会**假通过**。
- 项目铁律「金额一律整数分，禁浮点参与金额运算」—— 用**元展示串 + 容差**做判据，等于把浮点请回了裁判席。
- 而**引擎其实已经把整数分递到手边了**：`operationRefProfitFen=916000`、`totalFactorRealProfitFen=347667`、`profitDiffFen=568333`、`realConsumeFen=2300000`。

**修法（很小，改 `selftest.js` 的判据，不动引擎）**
1. 金额类锚点一律改成**整数分严格断言**（`===`），例如：
   `987` →`{ id: 9, get: r => r.totalFactorRealProfitFen, exp: 347667 }`，判据 `===`（**去掉 tol**）；
   S1: `operationRefProfitFen/totalFactorRealProfitFen = 916000`；S2: `916000/347667/568333`；2-R: `547667`；真实消耗 `2300000` / `2100000`。
2. **`毛利率` 保留 ±0.01**（它是比率，不是金额；`core/02:5` 的既有口径就是「金额锚点整数分严格相等、比率 ±0.01」）。
3. **把 `diffCheck` 变成断言**（现在只 `console.log`，三个 false 也不影响 exit code）。
4. **变异验证（必做，才算闭环）**：在**同一次命令序列内** `+1 分` 注入 → 期望**新判据 exit≠0**（尤其第 9 条要红）→ 还原 → 期望 exit=0；并确认无残留。

**验收**：`node cloudfunctions/calcMonthlyProfit/selftest.js` → `12/12` 且**新增整数分断言**；上面第 4 步的变异**必须让第 9 条转红**（红不了就说明判据没修对）。

---

### R20 🔴 `core/10:39` 的 `calcMonthlyProfit` 入参**与实现完全对不上**（单位还从「分」变回了「元」）

**证据（两边的字段名，逐一对不上）**
| 位置 | 入参形态 |
|---|---|
| **契约表** `core/10_云函数清单与接口契约.md:39` | `{ incomesYuan[], expensesYuan[], directCostYuan, inventoryOn, beginInvYuan?, purchaseYuan?, endInvYuan?, amortYuan?, pendingSettleYuan? }` |
| **实际实现** `cloudfunctions/calcMonthlyProfit/index.js:90-137`（`validateInput`） | `{ shop_id, input\|(flat): { income_items[{amount_fen}], expense_items[{amount_fen}], direct_consume_fen, amortize_fen, pending_settlement_fen, inventory{opening_fen,purchase_fen,closing_fen}, month?, client_request_id? } }` |
- **6 个字段全不同**：`incomesYuan`↔`income_items`、`directCostYuan`↔`direct_consume_fen`、`inventoryOn`↔（服务端 `shop_switch` 权威读，`index.js:66 readSwitches`）、`beginInvYuan`↔`inventory.opening_fen`、`amortYuan`↔`amortize_fen`、`pendingSettleYuan`↔`pending_settlement_fen`。
- **更重的是单位**：契约表写 `*Yuan`（元），而实现的校验是「**必须是非负整数「分」**」（`index.js:106`）⇒ 前端照契约表传元，会被 `INVALID_PARAM` 直接拒掉；且「元」隐含浮点，违背铁律「金额一律分、禁浮点参与金额运算」。
- 而 `core/10` 顶部写着**「单一文档列出全部云函数 → 入参/出参…防止前端（批次 4/7）与后端各自生成导致命名/字段错位」**（`:4`）—— 它现在做的正是它要防的事。

**同族（一并裁）：`core/10` §2/§3 全表用 camelCase**（`{ shopId }` `:36`、`{ shopId, clientRequestId }` `:38/41/55`…），而 **批次 0 交付指令 §2.9 明确「云函数出入参（契约层）统一 snake_case」**，批次 1 实现也确实取 `event.shop_id`（`index.js:32`）与 `client_request_id`（`:132`）。
⇒ **全表命名与已实现代码系统性冲突**；批次 2/3（`calcAmortize`/`calcBom`）还没写，**现在改表成本最低**。

**修法（建议方向：以「铁律 + §2.9 + 已实现代码」为准改表）**
1. `core/10:39` 行改为实现的真实形态（`shop_id` + `input` + `income_items[{amount_fen}]` + `direct_consume_fen` + `inventory{opening_fen,purchase_fen,closing_fen}` + `client_request_id`）。
2. 全表 §2/§3 字段名统一改 `snake_case`（`shopId`→`shop_id`、`clientRequestId`→`client_request_id`、`directCostFen`→`direct_cost_fen`…），并在文件顶部加一行**「本表字段名一律 snake_case + 金额一律「分」整数，与批次 0 §2.9 一致」**，消掉"这表到底是前端形态还是线上 payload"的歧义。
3. 若你们**坚持**表里的 camelCase 是"前端调用形态"，那也必须**在表内标注**并给出映射层位置（§2.9 说转换只在 DataAdapter / 前端适配层）—— **但不能留成现在这样两边都对不上的状态**。

**附带 🔵（同一条里顺手修）**：实现**同时接受** `amountFen` 与 `amount_fen`（`index.js:147`）—— 宽容双收会**静默掩盖**前端把字段名拼错的问题，属本项目反模式（同「±0.01 容差掩盖」「豁免表」一类）。建议**只锁一个**（按 §2.9 用 `amount_fen`），另一个明确拒收并回 `INVALID_PARAM`。

**验收**：`core/10:39` 的入参字段与 `index.js:90-137` **逐字一致**；全表无 camelCase 入参字段（或表内已标注映射层）；门禁 exit 0（`core/` 在扫描面内，注意 D/I/J 绕写纪律）。

---

### R21 🔵 批次 1 的自测没接进「一键校验」

- `verify_all.js` 的 `SUITES`（`:14-23`）仍是 8 项，**不含** `cloudfunctions/calcMonthlyProfit/selftest.js` ⇒ 「一键跑全部」会漏掉批次 1。
- 先按 **R19** 把判据修严，**再**加进 `SUITES`（否则等于把一条不可靠的判据接进总闸）。加完顺手把 `:3` 注释里的数量改对（现在写「8 个套件 = 6 个 specs 套件 + …」）。
- **验收**：`SUITES.length` 与注释一致；`node verify_all.js` 总览行数目对得上（注：本沙箱**跑不了** `verify_all` 端到端，须你/WorkBuddy 实测）。

---

### R22 🔵 `service.js` 里一处死代码（无害，顺手清）

- `service.js:126-129` `fenToYuanStr`：`return Number.isInteger(yuan) ? String(yuan) : String(yuan);` —— **两个分支一模一样**，三元无意义。
- 我实测了展示串安全性：**±1..2,000,000 分**全部输出 ≤2 位小数、**0 处**浮点污染 ⇒ **不是 bug**，只是可读性/误导。建议改成直白写法（或删除 `isInteger` 分支）。

---

## §3 协议层的两个断点（需要你确认，不是代码问题）

1. **我上一轮的复审文件没被取件**：`review/REVIEW_2026-09-15_round2-verify.md` 现在仍是 `?? `（**未 `git add`**）、**没有被追加 §3 回执**（我做了逐字符前缀比对：仓库版与我的正文**完全等长 8491 字符**，追加内容为空）。
   ⇒ 按协议 §1「每轮落盘后立即 `git add review/ && git commit && push dev`」+ §4「取 `review/` 下 mtime 最新的一份」，**这一轮像是没被真正取件**。请确认 WorkBuddy 的取件是否生效（否则我写多少轮都等于扔进抽屉）。
2. **3 个提交未推**（`9feb733`、`f76f539`、`474f38e`）—— R13 顺延；
   ⚠️ 我这边 `git ls-remote` **超时**（网络不通），所以只能凭本地 `origin/dev` 引用判断，**不能替你确认远端状态**。

---

## §2.5 能力边界（本轮）

- **云端核不了**、**远端 push 核不了**（`git ls-remote` 超时）、**开发者工具行为核不了**（R12 的 docx 呈现、删 `app.json` 后能否编译）、**`verify_all` 端到端跑不了**（沙箱禁管道型子进程）。
- **本轮变异全在会话工作区副本上做**：仓库 `git status` 全程只有那个未入库的 review 文件 ⇒ **零残留**（符合变异还原纪律，且比"注入仓库再还原"更强：根本没碰仓库）。
- 我做变异时**踩过一次自己的坑并已纠正**：第一版替换因 CRLF 不匹配**没生效**，脚本却"跑绿"了 —— 差点得出错误结论。现版本**强制断言"变异确实写入"**（`if(out===src) exit(9)`）后才跑测试。**这条记进方法论：变异脚本必须自证变异生效，否则"全绿"毫无意义。**

---

## §4 执行回执（WorkBuddy · 2026-09-15，按用户口令「现在就按这个顺序开干」）

> 顺序：R19 → R20 → R21 → R22 → R12–R18 → 提交/push。**逐条给证据，不多写形容词。**
> 取件协议 §3 的两个断点**已修**：本轮回执直接追加在复审文件末尾（不再"写了不取"），`review/` 两份文件一并入库。

### R19 ✅ 自测判据改「整数分严格相等」+ 变异回验闭环

改 `cloudfunctions/calcMonthlyProfit/selftest.js`（**只改判据，不动引擎**）：
- 12 条锚点中 **10 条金额锚点**由「元展示串 + ±0.01 容差」改为**整数分 `===` 严格断言**（`Number.isInteger(n) && n === exp`）；`#4 毛利率`保留 ±0.01（比率，对齐 `core/02:5`）。
- 预期值改成分：`6400000 / 3284000 / 4200000 / 916000 / 916000 / 2300000 / 916000 / 347667 / 568333 / 2100000 / 547667`。
- `diffCheck` 由 `console.log` 升级为**断言B**（三场景都必须成立，且再算一遍 `经营参考 − 全要素 === 差异`）；口径锁升为**断言A**（`operationRefProfitFen === 916000`）。
- 文件头部写死判据纪律与「为何不能回退 ±0.01」的实测理由（含第 9 条被放行的浮点差值 0.0099999999997635）。

**变异回验（临时副本 `%TEMP%\round3_r19\mutate_r19.py`，仓库全程未注入）**：
```
基线（未变异副本） exit=0 ✅
变异1「🔵全要素末步 +1 分」      exit=1  失败锚点=[6, 9, 12]  ✅  ← 第 9 条由「放行」转「失败」
变异2「🟢经营参考改用倒轧（破锁）」 exit=1  失败锚点=[8] + 断言A/B ❌破锁  ✅
脚本自证：锚点命中次数断言 +「替换后内容必须与原文件不同」，防 CRLF 不匹配的假绿（沿用你 §2.5 的方法论）
```
⇒ **你要的"第 9 条必须转红"已达成**。当前 `node selftest.js` → `12/12 + 断言A/B`，`EXIT=0`。

### R20 ✅ 契约表改为「已实现为真」+ 全表 snake_case（含附带 🔵）

`specs/dev-specs/core/10`：
- **`:39` `calcMonthlyProfit`** 改为 `index.js:90-137` 的真实形态：`{ shop_id, month?, client_request_id?, income_items[{amount_fen}], expense_items[{amount_fen}], direct_consume_fen, amortize_fen?, pending_settlement_fen?, inventory?{opening_fen,purchase_fen,closing_fen}, inventory_switch_reference?, amortize_switch_reference? }`；出参贴齐 `service.js` 返回字段。**6 个错位字段全部消掉，"元"退回"分"。**
- **§1~§7 全表**（含 M3/M2/付费/admin/批次7）入参与出参统一 snake_case：`shopId→shop_id`、`clientRequestId→client_request_id`、`planId→plan_id`、`cardCode→card_code`、`isVirtual→is_virtual`、`unitCostFen→unit_cost_fen`、`fileUrl→file_url`、`expiresAt→expires_at`、`isActive→is_active`、`orderNo→order_no`… 共 30+ 处。
- 顶部加三条硬声明：① 本表一律 snake_case + 金额 `*_fen`；② 不列 camelCase 形态（适配层转换在 §8.2）；③ **不出现 `*_yuan` 入参**。
- §8.2 补一句：禁止以"前端调用形态"为由在本表留 camelCase 入参。

**两处超出字面范围、但属同一事实的延伸（请你裁决）**：
1. **`calcSandbox`（§4）也原本写着 `*Yuan`** —— 与铁律冲突，随同 R20 一并改为 `rent_fen` 等，并加注「锚点仍以元表述，对照按 ×100；`prototype/calcM2.js` 内部沿用元的验算形态，不是契约」。批次 4 未写，此刻改成本最低。
2. **命名出处已核对**：`delivery/批次0 §2.9` 白纸黑字写「云函数出入参（契约层）统一 snake_case」⇒ 契约表的 camelCase 是错的一方，不是"另一套合法形态"。

**附带 🔵 已收口**：`index.js` 的 `cleanItems` 不再宽容双收 —
- 只传 `amountFen` → 拒收并回「明细金额字段请用 snake_case 的 amount_fen」；
- 两者并存且不相等 → 拒收（防歧义）；相等 → 放行；
- 转给 Service 的内部形态仍是 `{ amountFen }`（Service 层 JS 内部 camelCase，不属契约层）。
- 独立校验脚本 `%TEMP%\round3_r19\check_cleanitems.js` 10 条用例全过（因 `index.js` 顶层 require `wx-server-sdk` 无法整体加载，按括号配平截取函数原文装载测试）。
- ⚠️ **留一处未收紧请你定**：字符串数字 `"100"` 会被 `Number()` 转成功，与本文件标量校验 `f()`（`:106`）同口径。属"类型转换宽容度"问题，不在字段名收口范围，我未擅自改。

### R19/R20/R21/R22 的连 exposures 影响面

- `verify_all.js`：`SUITES` 增加 `['batch1 代码自测', 'cloudfunctions/calcMonthlyProfit/selftest.js']`（**排在 batch0 之后**），头部注释由「8 个套件」改为「9 个套件」并加「增删套件须同步改数量」。`node verify_all.js` → **`9/9 PASS`，EXIT=0**。
- **顺手消掉 4 处"套件数"的第二种说法**（本项目老毛病）：`SMOKETEST_RUNBOOK.md:31/:207/:220`、`下一步工序清单.md:237` 的「8 套件」→「9 套件」。这三份文件 unity 正在 R18 的门禁覆盖内，留着等于埋下一次漂移。
- `service.js`：`fenToYuanStr` 的死三元（`isInteger ? String : String`）删掉，改 `return String(fen / 100)`，并注明仅用于展示、不参与判据。改后 selftest + 门禁仍 EXIT=0。

### R12 ✅ 三份 docx 全部重生，陈旧结论清零

- 环境缺 `python-docx` ⇒ `python -m pip install python-docx`（1.2.0 + lxml + typing_extensions），**工具链补齐**（这也是以后 `.md` 改完能重生 docx 的前提，建议记进环境清单）。
- `python tools/md2docx_portrait.py` 重出三份 `.docx`，mtime **全部晚于**同名 `.md`；同时 `cp -f <name>.md <name>.txt` 重生三份 `.txt`。
- 三份 md **首行各加**「> ⚠️ 本文档为**派生件**：同名 .txt/.docx/.pdf 均由本 .md 生成，冲突一律以 .md 为准（勿手改派生件）」。
- 验证方式升级（你说剥 XML 只能证"有"、不能证"没有"）：改用 **python-docx 结构化提取**（段落 + 表格单元格，跨 run 已合并），脚本 `%TEMP%\round3_r19\verify_docx.py`：
  ```
  旧串  A7 成立 / 9 个 unique / __probe / 判据④唯一未完项 / 第 14–15 行 / env.js:14-15 / 8 套件  →  三份全部 0 命中
  新串  39 条索引 ✅ · 9 套件 ✅ · 派生件 ✅   —— EXIT=0
  ```
- **`.pdf` 一并补齐并重生**（原只有 `SMOKETEST_RUNBOOK.pdf` 且停在 09-13，另两份根本没有）：
  本机有 Word COM（`Word.Application` ver 12.0）⇒ 走「`.md` → `.docx` → Word 导出 PDF」。
  ⚠️ **踩坑与解法（建议固化）**：同一 Word 实例连做三份会在第二份起报 `Open.SaveAs` / `RPC 服务器不可用`（进程崩了）；且中文文件名 `SaveAs` 不稳。最终改为**每份 `DispatchEx` 独立实例 + 复制到临时英文路径导出、再拷回中文名** ⇒ **3/3 成功**（`%TEMP%\round3_r19\docx2pdf2.py`）。
- **派生链时序核对**（全部正序，无落后）：`.md` 16:14~15 → `.txt`/`.docx` 16:17 → `.pdf` 16:28~29。
  三份 pdf：`SMOKETEST_RUNBOOK.pdf` 639,459 B · `新手上云操作手册.pdf` 527,122 B · `下一步工序清单.pdf` 498,930 B。

### R14/R15/R16/R17 ✅ 全部落地

| 条 | 改动 | 验收 |
|---|---|---|
| R14 | Runbook 步骤6：`第 14–15 行` →「**prod 槽（第 17 行）**…（dev 槽已在第 16 行填好）」；「判据④唯一未完项」→「判据④ 现**仅剩 prod 这一项**（dev 侧已闭环）…」 | 实测 `env.js`：15=ENV_MAP、16=dev 真值、17=prod 占位 ⇒ 你的 16/17 判读准确 |
| R15 | Runbook `:52` →「`appid` **已是真值** `wx33c110dc57a9c8dc`（`project.config.json:3`）；若哪天退回 touristappid 才需替换」 | 核对 `project.config.json:3` 确为该值 |
| R16 | 重启键 `:59` 句尾 →「点④ 现状：**dev 侧已闭环**（`env.js:16` 已填真实环境 ID `cloud1-d4gphpoxy337f2a25`），仅 prod 待建环境后替换 —— 见上文 `:49` 节点①判据④」 | `未完成（待你建环境后替换` = 0 命中；`dev 侧已闭环` ≥2 |
| R17 | 手册 `:192`、工序清单 `:255`：「AppID ~~还是/是 touristappid~~ 或没实名」→「AppID **没填对**或没实名」；Runbook `:37`：「一次性问清三悬案」→「三悬案已于 2026-09-14~09-15 云端实测答完（见本文件「四前提终局结论」，第 11 行起）」 | 指针核对：该章实际标题是「🏁 四前提终局结论」（`:11`），不是「§四」，故我写了明确定位而非照抄 |

### R18 ✅ DOC_PAIRS 加第三项 + 强制变异验证（四步全过）

- `check_error_codes.js:546` → `['SMOKETEST_RUNBOOK', '新手上云操作手册', '下一步工序清单']`；
- `:558` 汇总串不再写死组名 → 改为 `` `${DOC_PAIRS.length} 组（${DOC_PAIRS.join(' / ')} 的 .txt ≡ .md…）` `` —— 你点名的"加完会少报一对"已消除。
- **同一次命令序列内的四步**：
  ```
  ① 加第三项后未重生            → EXIT=1，[K13] 三份全报（含「下一步工序清单」）✅ 证明新项在生效面内
  ② cp -f 三份 md→txt 重生      → EXIT=0 ✅
  ③ printf 'DRIFT-INJECTED' >>下一步工序清单.txt
     → EXIT=1，报错**点名**「[K13] 下一步工序清单.txt 与 .md 不一致」✅
  ④ cp -f md→txt 还原 → EXIT=0 ✅；grep -c DRIFT-INJECTED = 0 ✅
  ```

### 全系统回归（改完一次性跑）

`check_error_codes.js`（门禁 A–L）**EXIT=0** ｜ `verify_all.js` **9/9 PASS EXIT=0** ｜ `calcMonthlyProfit/selftest.js` **EXIT=0**。

### ⚠️ 两点请你裁决（我没擅自做）

1. **`delivery/批次2_提示词_可直接复制.txt` 写着「实现 `calcAmortize(asset, targetMonth)`」** —— 这里的 `targetMonth` 是 camelCase，与现已改为 snake_case 的契约表冲突。批次 2 **尚未投喂**，改这一处即可闭合；但改 delivery 会牵动 8 份 txt/HTML 派生链（有 `_gen_8batch_html.py`），所以我停手等你裁决再动。
2. ~~`.pdf` 出法未定~~ —— **已定案**：`.md` → `.docx`（`tools/md2docx_portrait.py`）→ `.pdf`（Word COM，**一文件一实例**）。三项已全部落地，见上文 R12。
   > 环境前提：`python-docx` 与 `pywin32` 本机原先都**没装**，是本轮 `python -m pip install` 补的 —— 这条建议写进环境清单，否则换机器会以为工具链本来就在。
