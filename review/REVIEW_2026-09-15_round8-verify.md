# REVIEW_2026-09-15 round8 · R31/R32/R33 复验 + 契约/命名/入口 4 处不一致（R34）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 8 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round7-batch2.md`（R31/R32/R33）；本轮对象 = `8ce59b1` / `aecb88b`。

---

## §0 结论

**三条修复都真成立，我用真模块（`validate.js` / `service.js`）独立验过，且重构没把钱算飞。**
顺手挖出 **R34：同一个云函数在「契约表 / 投喂指令 / 实现」三处对不上**（含一处违反本表自己的命名铁律）——不阻塞，但**批次 4 之前必须定案**。

| 项 | 结果 |
|---|---|
| 提交/推送/工作树 | ✅ `aecb88b` = HEAD = `origin/dev`；无未推；`git status` 干净；`review/` **11 份入库** |
| **R31 删写库** | ✅ `index.js` 已无 `writeMonthlyAmortize` / `da.insert`（57 行，`:42` 从台账读 → `:45` 纯算 → `:48` 返回）；我复验：**第二次调用不再抛错** |
| **R32 台账守卫** | ✅ `docToAsset` 已抽进 `validate.js`（纯函数可单测）；`start_month` 格式 /`total_months` 正整数/`terminate_month` 格式 **三道守卫实测生效**（12 例，见 §1） |
| **R33 去测试开关** | ✅ `service.js` 里 `mutateNoTail` 命中 **0**；末月仍 333345（尾差未丢） |
| **重构未算飞钱** | ✅ 4 个 POC1 锚点 + 独立尾差全部**与 round7 我的手工值一致** |
| 自测/总闸 | ✅ `calcAmortize/selftest.js` **48/48**；门禁 exit 0；逐套件（我跑不了 `verify_all`，EPERM）**10/10** |

---

## §1 我的独立验证（require 真模块，不照抄逻辑）

**一、4 个 POC1 锚点（防"修 bug 修坏钱"）** —— 全部与我 round7 的手工值一致：
`旧空调残值 933336`｜`招牌满摊 600000`｜`三资产 2026-08 = 468333`｜`装修末月 333345`（尾差仍在）｜`次月停 = 0`｜**每资产全周期合计 === 各自原值**。

**二、R31 三证**
```
第二次运行仅含资产主档（写库已删）      → ✅ 不抛错
被污染的行（无 total_value，但也没 start_month）→ ✅ 响亮抛错 INVALID_PARAM
上一版 bug 留下的"完整污染行"形态
  （有 start_month/total_months、无 total_value）→ ✅ 响亮抛错，点名 asset_id=A1
```
⇒ **不再自噬**（R31 根因消除），且**守卫仍然响亮**（没有用"跳过坏行"兜底）—— 这正是我要的修法。

**三、R32 守卫（走真 `validateInput`）**：12 例里 **11 例符合预期**，唯一"不符"是我探到的一条**新差异**（见 R34-④）：
`start_month='bad'`/`'2026-13'`/数字 → 拒 ✅｜`total_months='36'`（**字符串**）→ 拒 ✅（关键：没被 `Number()` 强转放过，正是 round7 那条静默错账的闸门）｜`total_months=0`/`3.5` → 拒 ✅｜`terminate_month='bad'` → 拒 ✅ / 留空 → 放行 ✅｜`total_value='100'`/`-1` → 拒 ✅

**四、R33**：`amountForMonthFen(asset,'2028-12',{mutateNoTail:true})` 现在返回 **333345**（钩子失效、恒倒挤）✅。

**五、入参形态（重要，顺带核清）**：最自然的线上 payload **能用** ——
```
{ shop_id:'s1', month:'2026-08' }                 → OK ✅
{ shop_id:'s1', month:'2026-08', input:{...} }    → OK ✅   （扁平与 input 包裹都收）
{ shop_id:'s1', input:{ month:'2026-08' } }       → INVALID_PARAM（month 必须在顶层）
```
⇒ 没有"函数调不起来"的功能性阻塞。

---

## §2 🟡 R34 同一个云函数的**三方描述对不上**（4 个子点，附修法与影响面）

**证据（三处并列）**

| 出处 | 入参 | 出参（金额字段） |
|---|---|---|
| **契约表** `core/10:46` | `{ asset, target_month }` ← **Service 形态**，且是**单数** | `{ total_amount_fen, details[] }` |
| **投喂指令** `投喂包…完整版.md:332` + `批次2_提示词.txt:41` | （未写形态） | `total_amount` |
| **实现** `validate.js:73-85` / `service.js:148` | `{ shop_id, month, assets? }` ← **wire 形态** | `total_amount` |

**④ 子点逐条**

**① 入参：契约表写的是 Service 签名，不是 wire 形态。**
对照 `core/10:43`（批次 1）—— 那一行 R20 时已统一成 **wire 形态**（`{ shop_id, month?, client_request_id?, income_items[{amount_fen}], … }`）。批次 2 这行却还写着 `{ asset, target_month }`（`target_month` 是 Service 形参名，wire 上是 `month`）。
⇒ **同一张表两行两种口径**，批次 4 前端照 `:46` 会传错。
**修法**：`:46` 入参改为 `{ shop_id, month, assets?[] }`（并标注 `assets` 为可选，见 ③）。

**② 出参字段名 `total_amount` 违反本表自己刚立的命名铁律。**
`core/10:138` 白纸黑字：「金额后缀 `_fen`」；批次 1 的实现也确实用 `…ProfitFen` / `directConsumeFen`。而 `total_amount`（`service.js:148`）没有 `_fen`，与 `:46` 写的 `total_amount_fen` 自相矛盾。
**注意责任**：InsCode 是**照投喂包 `:332` 写的**（提示词里就是 `total_amount`）⇒ 不是它的错，是**投喂包与契约表先不一致**。
**修法（推荐对齐铁律：改名 `total_amount_fen`）**，我实测影响面很小且现在改最便宜：
```
cloudfunctions/calcAmortize/service.js:148（return）+ 注释 :23/:125/:128
cloudfunctions/calcAmortize/selftest.js:65/66/69/95/99
cloudfunctions/calcAmortize/index.js:9（注释）
specs/dev-specs/delivery/inscode喂投包_8批_自包含完整版.md:332（单源）→ 必跑 _gen_8batch_html.py 重生 8 txt + HTML
specs/dev-specs/core/10_云函数清单与接口契约.md:46
```
**安全性**：批次 4 未写、批次 1 消费的是它自己的入参名 `amortizeFen`（不经此字段名）⇒ **此刻改名零破坏**；拖到批次 4 之后就要动前端。

**③ wire 上的 `assets[]` 被"接受并校验"，但 Controller **不使用**它。**
- 证据：`validate.js:23`「校验**可选的前端 assets 数组**（当传了时）」、`:85` `cleanAssets(event.assets)`；而 `index.js:41-42` 的资产**一律从台账读**，`v.assets` 从未被使用。
- 风险：**"校验了但不用"的入口 = 未来的越权面**。今天不用；哪天有人图省事改成"wire 传了就用 wire 的"，前端就能**伪造资产/伪造摊销额**。项目铁律是"计算下沉 + 数据以服务端台账为准"。
**修法（二选一，必须选）**：
 - (a) **删掉** `event.assets` 入口（`cleanAssets` 一并删）——最符合"单一真相源"；
 - (b) 明确保留为"**离线试算**专用"，则在 `core/10:46` 的注里写死「`assets` 仅用于前端试算预演，**结果不得落库、不得作为账目依据**」，并在 `index.js` 那行加同一句注释。

**④ 同一个"资产对象"有两条严格度不同的校验路径（新发现）。**
- `cleanAssets`（wire）的 `total_value` 走的是**宽松标量** `f()`（`:39`）⇒ **缺失 → 静默当 0**（我实测：`assets:[{…无 total_value…}]` → `OK`）；
- `docToAsset`（台账）的 `total_value` 走**严格守卫**（`:104+`）⇒ 缺失 → **抛错**（我实测：抛）。
- ⇒ 同形对象、两套严格度。今天没被触发（因为 ③ 的 `v.assets` 未被使用），但一旦 ③ 选了 (b)，**wire 侧就能用一个"0 元资产"悄悄污染试算/落库**。
**修法**：抽一个共用归一函数（如 `normalizeAsset(a, { fromWire })`），或至少让 `cleanAssets` 复用 `docToAsset` 的 `total_value` 守卫（缺失即拒）。

**验收（R34 整体）**：`core/10:46` 与 `validate.js` / `service.js` 的入参出参**逐字一致**；全树搜 `total_amount`（不带 `_fen`）→ 0（delivery 派生件同步）；③ 选定后 `cleanAssets` 的存在/用途与契约表注释一致；④ 两条路径对 `total_value` 的严格度一致（各加一个用例：缺 `total_value` → 两边都拒）。

---

## §3 仍在你/李老师这一侧（未变）

1. **R23 编译确认**（round6 遗留，唯一人工步）：`app.json` 删 `projectConfig` 后在微信开发者工具编译一次。
2. **23 条对抗用例并入套件**（裁决权在你）：原件 `C:\Users\lzj\Desktop\deepseek  空间\_mut4\test_validate_r27.js`，`node` 可直接跑；建议放 `cloudfunctions/calcMonthlyProfit/__tests__/` 或把 selftest 的 4 条扩成 23 条。
3. 本轮我的复验脚本（可复跑）：`_mut4\test_round8_verify.js`（锚点/守卫/开关）、`_mut4\probe_r8.js`（入参形态 + 污染行）。

---

## §4 能力边界

- **`verify_all` 端到端跑不了**（EPERM）→ **逐套件 10/10** 替代；云端核不了（`calcAmortize` 仍未在真云跑过：本轮全是本地等价验证，`index.js` 因 `require('wx-server-sdk')` 无法整体加载，我只验到"纯函数 + 映射逻辑"这一层）；远端 push 核不了。
- **R31 的"不再失败"是逻辑验证**：我证明了"写库已删 ⇒ 台账里只剩资产主档 ⇒ `docToAsset` 不抛"。**真云上仍建议跑一次两次连续调用**（同一店、连续两个月），这是唯一能覆盖 `da.list` 真行为的证据。
- 我**没有**改动仓库任何文件（`git status` 只有我这个未入库的 review 文件）。

---

## §5 执行回执（WorkBuddy · 2026-09-15）

> 审核方：miniprogram-code-reviewer（3080）。对象：`aecb88b` / round8 review。本回执由 WorkBuddy 执行侧填写。

**一、状态确认（与复审一致）**
`aecb88b` = HEAD = `origin/dev`；工作树干净；`review/` 11 份入库；门禁 exit 0；`cloudfunctions/calcAmortize/selftest.js` 重验后 **46/46**；逐套件 **10/10**。

**二、R34 四项子点 —— 全部修复并独立验证**
- **① 入参对齐 wire 形态**：`specs/dev-specs/core/10_云函数清单与接口契约.md:46` 入参由 `{ asset, target_month }`（Service 形、单数）改为 `{ shop_id, month }`（并注明资产一律从 `shop_amortize` 台账读取），与实现、与批次 1 R20 既定 wire 形态一致。
- **② 出参改名 `total_amount` → `total_amount_fen`**：改 `service.js`（返回 + 3 处注释）、`index.js:9` 注释、`selftest.js`（5 处引用）、`core/10:46` 出参（本已正确）、`inscode喂投包_8批_自包含完整版.md:332`，并**重跑 `_gen_8batch_html.py`** 重生 8 份 txt + HTML 保证派生件同步。全树搜 `total_amount`（不带 `_fen`）于活动代码/契约/投喂件中 = **0**。
- **③ + ④ 删 wire `assets` 入口**：`validate.js` 删除 `cleanAssets` 与仅其使用的宽松标量 `f()`；`validateInput` 不再接受/校验 `assets`（本就不被 `index.js` 使用，一律 `da.list` + `docToAsset` 读台账）。这同时消除了「校验了但不用」的潜在越权面（③）与「同形对象两条严格度路径」隐患（④）—— 现仅剩 `docToAsset` 一条严格路径，`total_value` 缺失一律响亮抛 `INVALID_PARAM`。selftest 新增「带 assets（含非法字段）被忽略 → 仍 OK」+「docToAsset total_value 缺失 → 抛」锁定。

**三、验证（我自跑，非读回执）**
- `node cloudfunctions/calcAmortize/selftest.js` → **46/46 PASS（EXIT=0）**（删去 4 条已无效的 assets 校验用例、新增 2 条 R34 回归；R32 守卫 6 例、docToAsset 8 例全绿）。
- `node verify_all.js` → **10/10 PASS（EXIT=0）**。
- R31 闭环重验（临时脚本 `/tmp/verify_r31.js`）→ **5/5 全绿**：二次调用不抛错、表行数不增长、污染表仍响亮抛错、三资产 2026-08 = 468333（口径未动，验证 R34 重构未算飞钱）。
- `grep cleanAssets` / `grep total_amount[^_]` 活动代码 → 均 **0**。

**四、一个诚实的工程记录（工具坑，已兜住）**
本轮对 `selftest.js` / `service.js` 的**多条同文件 Edit 在同一条消息里并发**，触发「各自基于原快照、末者覆盖」的竞态，导致部分编辑丢失（仅最后一条生效）。现象：`selftest.js` 仅 T7 落地、`service.js` 仅 S4 落地。已用**整文件 Write** 原子重写修正，重验全绿。教训：同一文件的多处改动必须串行（分消息）或一次性 Write，切勿同消息批量 Edit。

**五、仍归你/李老师侧（未变）**
1. **R23 编译确认**：沙箱无微信开发者工具，未做。
2. **23 条对抗用例并入套件**：原件 `C:\Users\lzj\Desktop\deepseek 空间\_mut4\test_validate_r27.js`，待你裁决落地方式。
3. 真云连续两月调用：复审方指出的「唯一能覆盖 `da.list` 真行为的证据」仍建议部署后跑一次。

**六、批次门禁提示**
R34 已在批次 4 前端按字段名取数之前闭环（改名零破坏、入参已对齐）。批次 3（POC2 BOM）为独立引擎，不依赖此变更。

- `98f6f5e`（含 `cloudfunctions/calcAmortize/{service,validate,selftest,index}.js` 修复 + `core/10` + 投喂包 MD + 派生 txt/HTML 重生 + 本回执 + round8 入库），`git push origin dev`。
