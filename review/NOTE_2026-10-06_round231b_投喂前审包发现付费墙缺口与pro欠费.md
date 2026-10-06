# NOTE · R231b —— 投喂前「审包」发现付费墙真缺口 + `pro` 池欠费阻塞

> **日期**：2026-10-06
> **触发**：李老师问「接下来我们做什么？」
> **自决路径**：投喂 **M3.33 阶段②（堂食半场）** —— 理由见 §一。
> **性质**：**投喂前审包 + 文档修复**；**代码 0 行改动、集合 0 新建、索引 0 新增、引擎 0 改动**。
> **基线**：`7db559f`（R234 收口）→ 本轮改 2 个 specs 文件。

---

## 〇 结论先行（四句）

1. 🔴 **投喂前审包抓出真缺口**：投喂包 §2.6「付费墙」只写了 **1 处**（云端 `PAID_FEATURES`），
   漏掉**另 3 处**（前端 `PAYWALL_TYPES` 派生键 / `terms.paywall` 四字段文案 / 页面 `t:{}`）⇒
   **若原样投喂，`check_paywall_coverage` 至少 3 条断言必红**，快马必然返工或（更坏）去改 `tools/` 修绿。
2. ✅ **已修**（2 文件）：投喂包 §2.6 补成「四处 + 边界归属」；规范 v1.6:32 点明四处联动。另订正 **1 处行号漂移**。
3. 🔴 **投喂被硬阻塞**：`pro` 余额池 **5/5 稳定 429**（`insufficient_quota`）⇒ 只剩 `flash` 级模型，
   而项目纪律是「不用 flash 写核心逻辑」⇒ **需李老师给 `pro` 池充值（≈20 元/批次）后方可按纪律投喂**。
4. 📌 本批`守卫 R231-1/2/3/5` 与新增云函数的契约/提审登记，**归门禁方**（不在投喂包职责内）—— 见 §三。

---

## 一 为什么选「投喂 M3.33 阶段②」这条

| 候选 | 前置是否满足 | 性质 | 判定 |
|---|---|---|---|
| **投喂 M3.33 阶段②（堂食半场）** | ✅ 满足（R231 已补齐投喂包 254 行 + 规范 v1.6 + 锚点 41/41） | **产出型**（B 线主线） | **✅ 选它** |
| G2 孤儿 `calcMonthlyProfit` 归属裁决 | ⚠️ 需拍板（删/留/登记） | 收尾 | 次选 |
| G4 `ENGINE_VERSION` 规范对齐 | ⚠️ 需改 specs（先审后合） | 收尾 | 次选 |
| 再审计一轮 | ✅ | 审计 | **不选**（R232/R233/R234 已连做三轮，边际收益递减） |

**选它的三条硬依据**（全部现读，非记忆）：
1. **InsCode 空闲**：`inscode.db::inflight_turn` = **0**；`InsCode.exe` 在跑（PID 20708）。
2. **投喂包已就绪**：`specs/dev-specs/delivery/批次M3v1.2_G_...txt` = **254 行 / 19.5 KB**，自包含（§0 铁律 → §6 守卫）。
3. **无路线级阻塞**：ROADMAP §三-9 标「🟡 堂食路径**已可投喂**（R231 · 2026-10-06）」。

---

## 二 投喂前审包：抓出的真缺口（§2.6 付费墙）

### 2.1 缺口形态

投喂包 §2.6 原文**只写了一条**：付费键 `m3_dishreview` ⇒ 单源 `entitlement.js::PAID_FEATURES`。
但本仓付费墙是**四处联动**（`check_paywall_coverage` 逐条把守）：

| # | 落点 | 原 §2.6 是否写了 | 漏了会怎样 |
|---|---|---|---|
| ① | 云端 `common/entitlement.js::PAID_FEATURES` | ✅ 写了 | — |
| ② | 前端 `utils/paywall.js::PAYWALL_TYPES` 增**派生键** `dishreview` | ❌ **漏** | `openPaywall('dishreview')` **静默 return** ⇒ 「点了没反应」 |
| ③ | `terms.paywall.dishreview` **四字段**文案 | ❌ **漏** | `def` 为 `undefined` ⇒ **弹窗崩** |
| ④ | 页面 `.js` 的 `t:{}` 映射 | ❌ **漏** | WXML 取 `undefined` ⇒ **静默空白** |

### 2.2 实测判据（不是推测）

读 `tools/check_paywall_coverage.js` 源码（`deriveKey` 在 `:70`）：

```
deriveKey('m3_dishreview')            === 'dishreview'
PAID_FEATURES 追加 'm3_dishreview'
  ⇒ derived = [export, combo, takeaway, dishreview]
  ⇒ TYPES   = [saveLimit, export, combo, takeaway]        （utils/paywall.js:23）

L2      noWall = ['dishreview']  ⇒ ❌ 红（弹不出墙）
L6-②b   nonExport 含 m3_dishreview，无同名云函数目录、WALL_ANCHORS 无登记
        ⇒ anchorGaps = ['m3_dishreview(无同名目录，且未登记落点)']  ⇒ ❌ 红
L6-②d   分类不重不漏被打破                                      ⇒ ❌ 红
```

⇒ **至少 3 条断言必红**（同一根因）。这是**真缺口**，不是纸面演练。

### 2.3 顺带订正：一处行号漂移

| 位置 | 原文 | 实测 | 处置 |
|---|---|---|---|
| 投喂包 §2.6 | `saveCostCard/index.js:120` | 实际在 **`:136`** | ✅ 已订正 |

（`exportData/selftest.js:36-37` 的「包含式断言」说法**核对无误**，未改。）

### 2.4 顺带补上「守卫归属」声明（防快马越界）

`WALL_ANCHORS` 要求「无同名云函数目录的付费能力必须显式登记落点」。本批新云函数目录名**不含**
`dishreview` ⇒ 必然要走这张表。**该表在 `tools/` 下，属门禁方** ⇒ 已在投喂包与载荷尾部**双处写明**：
「落点登记由门禁方后补；若门禁报 `paywall-coverage` 红，**那是预期内的**，在回执里说明，
🔴 **不得改 `tools/` 下守卫、删断言、加旁路来"修绿"**」。

> 同族于技能 `inscode-desktop-feed` 坑 16「清单类守卫会强制改变可改文件集 ⇒ 必须预告预期内的红」。

---

## 三 本轮实际改动（3 处 · 纯文档）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `specs/dev-specs/delivery/批次M3v1.2_G_M3.33单品毛利复盘_提示词_可直接复制.txt` | §2.6 由 **1 处 → 四处**（含派生键名、四字段、双副本 md5 自证、`≤4` 字符硬限、`content` 防钓表述）+ 行号订正 + **守卫归属声明**（④） |
| 2 | `specs/dev-specs/core/开发规范v1.6_ModuleM3增量_M3.33阶段二解析与清洗定案.md:32` | 「新增 1 个付费键」→ 点明 **四处联动**（原来只写"见投喂包 §2.6"） |
| 3 | `review/NOTE_2026-10-06_round234_G3开库存口径三副本对拍.md`（**L94 措辞**） | 修门禁红：见 §5.1（**只换说法、事实与语义不变**） |

🔴 **无生产代码改动**（`cloudfunctions/` / `pages/` / `utils/` / `miniprogram/` 全未动）。

---

## 四 🔴 阻塞：`pro` 余额池欠费（投喂跑不动）

### 4.1 取证（直连实测，不采信界面文案）

按技能 `inscode-desktop-feed` 的两通道表分离探测，**每个池都探到位**：

| 池 / 通道 | 端点 | 模型 | 结果 |
|---|---|---|---|
| 套餐 `free` | `api.taotoken.net/coding/v1` | `deepseek-v4-flash` | **HTTP 200 ✅** |
| 套餐 `free` | `api.taotoken.net/coding/v1` | `glm-5.3-flash` | **HTTP 200 ✅** |
| **余额 `pros[0]`** | `api.taotoken.net/v1` | **`deepseek-v4-pro`** | **HTTP 429 ❌（5/5 稳定）** |
| 余额 `free` | `api.taotoken.net/v1` | `deepseek-v4-flash` | HTTP 429 ❌ |

错误体（`traceId` 齐全，非我方构造）：
```json
{"error":{"message":"Free allocated quota exceeded.","type":"insufficient_quota",
 "code":"Free quota exhausted and balance too low, please recharge compute credits."}}
```

旁证（`inscode.db::turn_telemetry`）：存在 `stop_reason=ProviderError` + `error_category=balance_insufficient` 的历史轮次
⇒ **不是网络抖动，是真欠费**。

### 4.2 结论

- **`deepseek-v4-pro` 不可用**（唯一"按纪律可写核心逻辑"的档位）。
- 套餐池**只剩 `deepseek-v4-flash` / `glm-5.3-flash`**，能跑但**违反 ROADMAP §五「❌ 不用 flash 写核心逻辑」**。
- ⇒ **投喂 M3.33 阶段② 需先给 `pro` 池充值 ≈20 元**（解除人 = 李老师，属**只有用户能做的动作**）。

---

## 五 门禁与提交

| 项 | 值 |
|---|---|
| 改动面 | **3 处纯文档**（2 个 `specs/` ＋ 1 处 R234 NOTE 措辞 · **零代码**） |
| 针对性守卫 · `check_paywall_coverage` | **17 通过 / 0 失败 · RC=0** ✅ |
| 针对性守卫 · `check_quota_limits` | 24/1 —— 唯一红 `L1-① 扫描面 0 文件`＝**沙箱 `git ls-files` 空**（环境级，同 R233/R234；真门禁走缓存 preload 为绿） |
| 行尾一致性 | 全部**纯 LF** ✅ |
| 全量门禁（**第 3 跑 · 干净存档**） | **144/144 · RC=0 · 真 FAIL=0 · miss=0 · 425.5s · R92 ✅** —— `per_suite/` **144 件** · `❌` 计数 **2**（均断言描述字面量）· **A7-① 门禁内 ✅「仅重启键一处自称本口径单源」** |
| 提交 | **`08810f5`**（150 files）|

> **门禁共跑 3 次**：① 143/144（红 = R234 NOTE 标记词扩散，见 §5.1）→ ② 143/144（红 = **本轮新 NOTE 自己又踩同一条**，见 §5.1 末）→ ③ **144/144**。
> ⇒ 取证存档只保留第 ③ 跑（前两跑作废，`gate_full.txt` 为最终树复跑结果）。

### 5.1 🔴 第一跑门禁 143/144 —— 抓到 R234 遗留的「标记词扩散」（已修）

**现象**：第一跑 `总览：143/144`，唯一红 = `[suite-assert-counts] exit=1`，自报
`❌ A7-① 另有 1 处自称本口径单源：review/NOTE_2026-10-06_round234_....md`。

**根因**（读源码定性，非猜）：`tools/check_suite_assert_counts.js:34` 定义了 `DECL_MARK` =
「套件断言数口径」＋括号内「**唯一**声明处」连成的**一个完整短语**；A7 判据 = 扫**全部 `.md`**
（排除重启键与 `tools/`），凡 `includes(DECL_MARK)` —— 即该短语**连续出现** —— 即判红。
R234 NOTE 的 L94 **照抄**了重启键那一行的同一短语（含括号、连续出现）⇒ 命中。
⚠️ 仓内另有 30+ 份 NOTE 含子串「唯一声明处」但**不含完整短语** ⇒ 均不触发（**判据是短语、不是词**）。

**为什么 R234 当时没红 = 写作时序**：该 NOTE 是在 R234 门禁**跑完之后**才写的
⇒ 门禁扫的是"NOTE 诞生前"的树 ⇒ 当时那 144/144 **不含它**。
⇒ 🔴 **纪律：「文档写在门禁之后」会漏扫 —— 门禁跑完后新写的文档，必须再跑一次门禁才算数。**

**修法**：改措辞避开完整短语（→ `重启键的「套件断言数口径」声明行（该口径在本仓的唯一声明位置）`），
**事实与语义不变**；单跑复验 `✅ A7-① 仅重启键一处自称本口径单源`。

**通用纪律（已进技能 `gate-suite-checklist`）**：写 NOTE / 评审件时**不要整段照抄被守卫当"标记"的短语**
（A7 是"单源不扩散"判据，把"第二处出现"一律判红 —— **哪怕只是引用**）。

---

## 六 待办

1. 🔴 **【需李老师】给 InsCode `pro` 池充值**（≈20 元/批次）⇒ 解除后即可按纪律投喂 `批次M3v1.2_G`。
   - 备选（**需李老师拍板**）：接受用 `flash` 级模型写本批（**推翻** ROADMAP §五 的既定纪律）。
2. ✅ 投喂包 §2.6 已补齐 ⇒ **投喂前不再需要人工干预**。
3. 承 R233 未结：**G2** 孤儿 `calcMonthlyProfit` 归属裁决 · **G4** `ENGINE_VERSION` 规范对齐。
4. 承 R189：**付费墙三缺口** —— `real_profit` **零判据（两层）**，本轮实测：
   - ① **登记层**：不在 `PAID_FEATURES`（= `['export','m3_combo','m3_takeaway']`）；
   - ② **消费层**：**全仓零 `hasFeature(..., 'real_profit')` 调用点** ——
     实测 `real_profit` 的全部命中都是**金额字段名** `operation_ref_profit_fen` / `total_factor_real_profit_fen`，
     唯一"干净"的一处是 `initDb/collections.js:180` 的 `SEED_FEATURES` **播种**（plan 维度能力位，
     `entitlement.js:8-12` 明说它**不参与付费判定**）。
   - ⇒ **口径后果**：`SEED_PLANS` 四个档位名**全叫「真实利润·月/季/年/自动续费」**（付费档卖的就是"真实利润"），
     `terms.paywall.saveLimit.content` 亦承诺「**开通真实利润后**不限数量」；但真实利润（`totalFactorRealProfitFen`）
     在 `saveLedger` / `getLedger` / `pages/month` **全链路无任何付费判定** ⇒ **免费档可完整使用**。
   - ⚠️ **属产品边界决策**（是有意的引流，还是漏接线？），须李老师拍板，**不自行修**。
   - 📌 附注：单纯把键加进 `PAID_FEATURES` **修不好它**（无消费点仍不拦）；正解需同时在
     `saveLedger`/`getLedger` 加 `hasFeature(db, userId, 'real_profit')` 判定 —— 两层必须同时做
     （否则触发守卫 L6-①「未登记就拦」）。

---

## 七 R231b²（同日续做）：审包**第二处**真缺口（函数面）+ 一次自伤事故（缓存被砸）

### 7.1 为什么又多一轮

§2.6 补完后，按技能 `inscode-desktop-feed` 坑19 继续走查 —— 但这次不按「我想到的面」走，
而是**按守卫会查的面**逐条走（`tools/` 下每个会读 `cloudfunctions/`、`specs/`、`.md` 的守卫）。
⇒ 抓出**与付费墙同类的第二处缺口**（函数面），且比它更贵。

### 7.2 缺口形态（三处 · 全部机器核过）

| 面 | 投喂包原状 | 判据（本轮现读） | 漏了会怎样 |
|---|---|---|---|
| 函数面 | **零字提及**（对照：`批次M2v1.2` 有专节「新增云函数牵动五处」；`批次M2v1.3` 明写"不新增函数" ⇒ 本批两不沾） | `selftest_r85.js::A15_EXEMPT`(`:322`) · `check_fn_inventory` F2/F4/F5 · `check_fn_public_surface` · `check_idempotency` | 只要新增 1 个云函数 ⇒ **≥4 处必红** |
| 页面面 | §0.6 只指了机器三关，**文档侧四处**未写 | `check_page_manifest`（机器）＋ 提审材料五处计数（人工） | 材料自相矛盾；清单类守卫红 |
| `sync_common` 目录数 | 写 **43**（R188 期历史值） | `node tools/sync_common.js --check` 现读 **46** | 实现方按 43 自证 ⇒ 看着"对不上"⇒ 白跑一轮 |

### 7.3 关键实测值（供验收方复算）

- `cloudfunctions/` 函数目录 **46**（≡ `core/10:5` 那行全集口径）· 带 `selftest.js` **43**（≡ 重启键 `:438`）·
  不带的三个 = `importSalesBill` / `initDb` / `smokeTest`
- A15 判据 = `git status --porcelain cloudfunctions/` 过滤 `A15_EXEMPT`；`importSalesBill` **已在册**（`:216`）·
  先例：M2v1.3 扩 `exportData` 也登记了一行 ⇒ **改既有函数同样要登记**
- `check_fn_inventory`：F4 锚 `全集口径`（`:55`）· F5 锚「N 个云函数…selftest」（`:57`）· F2/F3 双向（代码↔文档）
- **复用路径可行**：`importSalesBill` 幂等三件套已就绪（`index.js:94` `findPriorResult` /
  `:128` `writeAudit` / `:134` 单源 `shopKey`）⇒ 复用即天然满足 `check_idempotency`
- 页面 **24 页**：`app.json` ＋ 提审材料 `:16` / `:44` / `:64` / `:66` / `:95` / `:96`

### 7.4 改动（3 处 · 纯文档 · 零代码）

1. 投喂包新增 **§2.7**：A 段（首选不新增 ＋ 六处同步面表 ＋ 逐条归属）＋ B 段（页面面四处）；
2. 投喂包 `§0.1` / `§4-1`：**43 → 46**（判据段跟现值；`★知识存储点:438` 的 43 是**另一口径**（带 selftest 数）、
   `review/evidence/**` 的 43 是**历史快照** ⇒ **一律不动**）；
3. 投喂包 `§4` 追加第 14 条自检：函数面必须显式声明「不新增 / 新增 N 个（目录名：…）」。

### 7.5 🔴🔴 本轮自伤事故：把 preload 缓存砸了（定性 → 恢复 → 防复发）

- **起因**：我按纪律「续跑前必刷 preload 缓存」跑了 `%TEMP%\inscode\mk_gitcache.py`。
  那是 **Sep 29 的 6 键残件**，且**键格式错**：只写 args（如 `ls-files`），
  而 preload 用 `basename(exe) + args`（`git ls-files`）命中 ⇒ **6 个键永不命中**。
- **后果**：原 **158 键**缓存被覆盖成 6 个无效键 ⇒ 第 2 跑 **135/144**，红的 9 个套件全是
  `spawnSync git/python EBUSY`（docx-derive / suite-coverage / suite-count-claims / quota-limits /
  collection-perms / privacy-collection / acceptance-counts / suite-assert-counts / r85-takeaway）
  —— **症状看着像真缺陷**，是最容易误改成"迎合"的形态。
- **定性**：`node -e spawnSync('git',…)` = `null EBUSY`（通道确被封）＋ 缓存键格式自查（裸 args 键）⇒
  判「缓存砸」而**非**「代码坏」。
- **恢复**：底表 `review/evidence/r179_gate_sandbox/gitcache.json`（48 键、格式正确）＋ miss log **另存**
  ＋ 脚本 `review/evidence/r231b_gate2/rebuild_cache.py`（🔴 **每阶段之间落盘** —— 否则 node 子进程
  读到的还是旧缓存 ⇒ 把假红当真值 ⇒ 提前收敛）⇒ **72 键 · 全 `rc=0` · miss=0**。
- **防复发**：`mk_gitcache.py` 正文换成 ⛔ 停用桩（运行即 `exit 2`、不碰缓存）；
  技能 `gate-under-sandbox`：坑④ 改写（日常刷新**只用原地三件套** `mk_git_keys.py` + `mk_force.py` +
  `mk_fix_py_keys.py`）＋ **新增坑⑪**（认症状 / 恢复手册 / 跑 `mk_*.py` 前先查它是否覆盖式）＋
  ⑥-ter 补「阶段间必须落盘」。
- 🔴 **教训一句**：**别把"刷新缓存"当无需审查的机械动作** —— 先看它 (a) 是不是覆盖式
  (b) 键格式对不对；拿不准就用原地三件套，**永远不要用"从零重建"的脚本去刷新**。

### 7.6 门禁与提交

- 第 2 跑 **135/144**（缓存砸 · 非代码缺陷 · 已定性，见 §7.5）
- 第 3 跑（缓存修复后）**144/144 · RC=0 · 真 FAIL=0 · miss=0 · 804.5s · R92 ✅**；
  `❌` 计数 **2** 且**均在 ✅ 行内**（字面量）；`per_suite/` **144** 件；
  **A7-① 门禁内 ✅**（`review/evidence/r231b_gate2/gate_full.txt:2793`）
- 取证 `review/evidence/r231b_gate2/`（含驱动 `run_gate9.py` / 恢复脚本 `rebuild_cache.py` /
  重建后缓存 `gitcache_rebuilt.json`）
- 提交 **`9d92e30`**（150 files）⇒ `HEAD ≡ origin/dev ≡ 9d92e30`、工作树干净。**未部署、零生产代码改动**。
- ✅ 第 4 跑（覆盖本 §七 追加后的状态）：**144/144 · RC=0 · 真 FAIL=0 · miss=0 · 1089.9s · R92 ✅**
  —— 取证 `review/evidence/r231b_gate3/`（`❌` 计数 2 且均在 ✅ 行内）。
  ⇒ 本 §七 所在提交 = **`e16455e`**；第 3 跑的 `r231b_gate2/` 是 `9d92e30` 那版的有效存档，
  按技能坑⑩纪律**不覆盖**，两套并存。

### 7.7 待办（在 §六 之上增量）

- 🔴 承 §四：**`pro` 池欠费仍在** ⇒ 投喂仍卡着（需李老师给 `pro` 池充值 ≈20 元/批次）。
- 🔴 投喂包 §2.7-A 要求实现方在交付说明里**显式声明函数面**（不新增 / 新增 N 个及其目录名）
  ⇒ 门禁方据此登记 ①③④ 与 ⑥ 的登记部分。

