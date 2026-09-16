# REVIEW_2026-09-15 round15 · 批次 3（POC2 BOM）节点②验收 + 索引裁决 A′

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 15 轮**。**新开文件**（协议 §2）。
> 触发：InsCode 抛出「部署决策问题」（索引），WorkBuddy 独立核实后请我定夺。
> 本轮对象：**批次 3 产出（7 个新云函数、未提交）** + `initDb/collections.js:61` 索引冲突。

---

## §0 三条裁决（先给结论）

1. **节点② 判据：核心项 ✅ 通过**（`total_cost` 落整数分、`=== 975` 严格无容差、4 位精度中间量、末了才 round），**我另做变异实证了它有鉴别力**；但**发现一处判据缺口**（"不逐行 round"这条规则没有用例守 → 见 §2.3）。
2. **索引裁决：选 A 的加强版 —— `A′ = 复合唯一 (shop_id, card_code, version)`**（不是它提的 `(card_code, version)`）。**否 B、否 C。** 理由与连带改动见 §3。
3. **可以开做**：17 套件我逐个跑过 **17/17**（与 InsCode 的 17/17 一致）；提交前需先做 §3/D 的两处文档同步与 §5 的三件事。

---

## §1 仓库现状（先纠正一处口径）

- ✅ 门禁 **exit 0**；`origin/dev = e6a5c3a`（与 HEAD 同步）。
- ⚠️ **批次 3 尚未提交**：工作区里 7 个新函数目录（`calcBom`/`detectCycle`/`getCostCard`/`getMaterial`/`saveCostCard`/`saveMaterial`/`syncCostCard`）+ `verify_all.js` + 我那份 round14 复审 + `.atomcode/` 均未跟踪。
- ⚠️ **"改动 29 文件 +157/−2"与我实测口径不符**：我数到 **7 × 15 = 105 个新文件**（每个函数 = index/service/validate/selftest + `common.js` + 10 个 `cx_*.js` + `package.json`）。请在下轮回执里写清"29"指的是哪一档（我怀疑是"人工编辑过的文件数"，那就该说明）。
- ⚠️ `cloudfunctions/calcAmortize/cx_money.js`、`cx_utilTime.js` 显示为 modified，但 **`git diff --stat` 为空、L 组绿** ⇒ 是**行尾差异（LF/CRLF）**，内容未变。提交时留意别把整文件行尾翻掉（`git add` 后看一眼 `git diff --cached --stat`）。

---

## §2 节点② 验收（本项目最关键的钱算关卡）

### 2.1 我对 InsCode 与 WorkBuddy 两条自述的独立复核 —— **都属实**

| 判据（来自 `★知识存储点 :50`） | 我核到的证据 | 判定 |
|---|---|---|
| 落库 `total_cost == 975`（整数分） | `saveCostCard/index.js:177` `total_cost: result.unit_cost_fen` + `:10-11` 只 INSERT 不改 | ✅ |
| **不接受"测试侧额外取整一次才等于 9.75"** | `saveCostCard/selftest.js:42` `res.unit_cost_fen === 975 && Number.isInteger(res.unit_cost_fen)` —— **严格 `===`、无容差、带整数守卫** | ✅ |
| 净料单位成本中间 ≥4 位、最后才 round 到分 | `calcBom/service.js:47-49` `netUnitCostWan = Math.round(yuan*10000)`（万分整数）；`:52-54` 行成本**不 round**；`:85+` 合计高精度累积；末了才 round 到分 | ✅ |
| 多版本只 INSERT | `saveCostCard/index.js:151-161` 取该 `card_code` 下最大 version + 1；**不翻转 `is_latest`**（查询取版本最大者）—— 比"改标记位"更贴"只增不改" | ✅ |
| 17/17 套件 | **我逐个跑**：门禁 A–L / seed / poc1-4 / batch0(20) / batch1(12+2) / batch2(57) / batch3 七件(25/12/8/15/4/7/8) / check_requires → **17/17 exit=0** | ✅ |

### 2.2 我的变异实证（证明判据有鉴别力，不是"看起来绿"）

在**工作区副本**上做（仓库未动），先自证基线绿（25/25）再变异：

| 变异 | 期望 | 实测 |
|---|---|---|
| **M1 净料 4 位 → 2 位**（`yuan*10000` → `yuan*100`，即"中间只保 2 位"） | 必须被抓住 | ✅ **决定性抓住**：`净料单位成本 4 位=0.0333(万分333) → 实得 万分 3`、`宫保总成本 975 分 → 实得 61 分`、`明细合计 876 → 8`，exit=1 |

### 2.3 ⚠️ 但 **M2「明细逐行 round 到分」未被抓住** —— 规则有、判据缺（新增 **R38**）

规范在 `service.js:16` 明写「明细净料成本合计 = Σ(每行用量 × 快照)（**高精度累积，不逐行 round**）」。我把 `lineNetCostYuan` 改成每行 round 到分 → **selftest 仍 25/25 全绿**（判据没覆盖）。

**我构造的反例（两种做法确实会差钱）**：
```
输入：3 行 { quantity:250, net_unit_cost:333(万分) }，auxFen:0, lossPct:0, mode:'A'
高精度累积（规范要求） material_total_fen = 2498   unit_cost_fen = 2498
逐行 round（规范禁止） material_total_fen = 2499   unit_cost_fen = 2499   ⇒ 差 1 分
```
且 `selftest.js` 里**没有**这类"行成本含 3 位以上小数"的用例（现存用例的逐行值恰好都是 2 位，所以两种做法同值 ⇒ 掩盖了差异）。

**修法（很小）**：在 `calcBom/selftest.js` 加一条用例 —— 上述输入断言 `unit_cost_fen === 2498`（**整数分严格相等**），并在用例名里点明"防逐行 round"。加完请做变异回验：把 `lineNetCostYuan` 改成逐行 round → **该条必须转红**。
**优先级**：🟡 —— 这是节点②判据的补洞，不影响已通过的部分，但**批次 4 会真正驱动成本卡**（用户改原料价、批量刷新），建议在批次 4 之前补上。

---

## §3 索引裁决：**A′ = 复合唯一 `(shop_id, card_code, version)`**

**冲突事实（我复核属实）**：`initDb/collections.js:59-62`
```js
shop_cost_card: [
  { name: 'idx_card_shop', keys: { shop_id: 1 } },
  { name: 'idx_card_code', unique: true, keys: { card_code: 1 } },   // ← :61
],
```
而本批是**多版本模型**（同 `card_code`、`version` 递增、只 INSERT）⇒ **云端写第二版必撞 duplicate key**。

### A. 为什么是 `(shop_id, card_code, version)` 而不是 `(card_code, version)`

| 理由 | 证据 |
|---|---|
| **查询一律带 `shop_id`**（本项目铁律 3：店铺隔离） | `saveCostCard/index.js:156` `da.list('shop_cost_card', { shop_id, card_code })`；`getCostCard/index.js:48` 同样带 `shop_id` |
| **与同文件既有复合索引口径一致** | `idx_acc_shop_month` = `(shop_id, month)`、`idx_inv_shop_month` = `(shop_id, month)`、`idx_switch_shop_key` = `(shop_id, switch_key)` —— 全是"shop_id 打头" |
| **复合前缀可直接服务现有查询** | `(shop_id, card_code, version)` 可服务 `{shop_id}` 与 `{shop_id, card_code}` 两种前缀查询 ⇒ 那个单列 `idx_card_code` 没有独立存在价值 |
| **抗未来变更** | 若将来把 `card_code` 改成"店内序号"（如 `C0001`），`(card_code, version)` 会**跨店误撞**；带 `shop_id` 则不会 |
| **顺带充当并发守卫** | `saveCostCard:151-161` 是"读最大版本 + 1"的 **read-then-write（非原子）** ⇒ 并发保存可能算出同一 version；复合唯一索引让撞车变成**响亮失败**而不是静默写重复版本 —— 正合本项目"响亮失败优于静默漏检" |

**否 B（改非唯一）**：丢掉的正是"防同版本重复"这条约束，且把上面那条并发撞车变成静默重复。
**否 C（暂不改）**：本批代码**已经在写多版本**，云端第二次保存就坏 —— 这不是"待办"，是**功能性缺陷**，不能挂到上线前。

### B. 精确改法（`collections.js:61` 一行替换）

```js
    // R38（2026-09-16）：多版本模型（同 card_code、version 递增）⇒ 单列唯一会被第二版撞库。
    // 改复合唯一 (shop_id, card_code, version)：允许多版本、防同版本重复，并充当并发守卫
    //  （saveCostCard 是"读最大版本+1"的非原子写，唯一索引让撞车变成响亮失败）。
    { name: 'idx_card_code_version', unique: true, keys: { shop_id: 1, card_code: 1, version: 1 } },
```
**计数不变**：索引总数仍 **39**、unique 仍 **10**（替换而非新增）——所以文档里的"39 条/10 条 unique"两个数字**不用改**。

### C. ⚠️ 云端侧：**A7 决定这条索引只能在控制台手工建**（连带动作）

- **若该集合的索引还没建**（`工序 5.5` 说 dev 阶段可跳过；请确认你实际建到哪一步）⇒ 只需按上面的新定义建，**无需 drop**。
- **若 `idx_card_code` 已经在控制台建过** ⇒ 必须**先 drop 旧索引、再建复合索引**（改 `collections.js` 不会回溯改线上）。顺序：控制台 → 数据库 → `shop_cost_card` → 索引管理 → 删 `idx_card_code` → 新增 `(shop_id↑, card_code↑, version↑)` 唯一。
- **这条要进上线清单**：WorkBuddy 已提醒"已有集合需显式重建索引"，我确认并建议写进 `★知识存储点 §1.3` 的 R37/R38 条目。

### D. 文档连带（**两处副本 + 派生件**，别漏）

索引清单在本仓有**两份副本**，改一处必须改全（否则又是"同一事实两处不一致"）：
| 位置 | 现文 | 改为 |
|---|---|---|
| `新手上云操作手册.md:141` | 10 条 unique 清单里的 `shop_cost_card.card_code` | `shop_cost_card.(shop_id,card_code,version)` |
| `下一步工序清单.md:162`（工序 5.5 表第 19 行） | `\| 19 \| shop_cost_card \| idx_card_code \| card_code ↑ \| 【唯一】 \|` | `idx_card_code_version \| shop_id ↑, card_code ↑, version ↑ \| 【唯一】` |

⚠️ 这两份文件的 `.txt` 是**派生件**（K12/K13 守）⇒ 改完 `.md` 必须重生 `.txt`（`Copy-Item <name>.md <name>.txt -Force`）。
（`review/REVIEW_2026-09-15_restartkey-writeback.md` 的 §1 附A 那份 39 条权威清单也含 `idx_card_code`，但那是**历史复审记录**，按协议 §2 不改 —— 本份 REVIEW 即为更正。）

---

## §4 两个附带项

### 4.1 `.atomcode/`（InsCode 元数据）
- ✅ 该加 `.gitignore`（你说的对）：现未忽略，会出现在未跟踪列表里、有误提交风险。
- 🔵 **打包层面也要加**：`.atomcode/memory.md` 目前**恰好被 `.md` 后缀规则挡住**（我复算确认它不在候选集里），但**目录本身没被忽略** ⇒ 哪天里面出现 `.json`/`.png` 之类就会进包。建议 `packOptions.ignore` 里加一条 `{ "type": "folder", "value": ".atomcode" }`（与 R37 同族、零成本）。

### 4.2 R37 的价值随批次推进在上升（数据点）
我按 ignore 规则复算：**候选集仍是 18 文件 / 24.2 KB**（批次 3 的 105 个新文件**一个都没进来**，因为 `cloudfunctions/` 整目录被忽略）；而**"修前上界"从 193 文件 / 2.97 MB 涨到 372 文件 / 5.13 MB**。⇒ 没有那份 ignore，现在预览/上传早就超 2 MB 了。

---

## §5 给下一步的建议顺序（我认为 WorkBuddy 的规划基本正确）

1. ✅ **先独立跑 batch3 自测** —— 我已代做（17/17 + M1 变异），不必重复；**但请补 §2.3 那条用例**。
2. **改索引**：`collections.js:61` 换成复合唯一（§3/B）+ **两处文档同步 + 重生 txt**（§3/D）+ 确认云端是否需 drop（§3/C）。**批次 3 代码本身"只新增"，InsCode 不动 initDb 是对的** —— 索引作为**独立变更**提交（可单独一个 commit，便于回滚）。
3. **`.gitignore` + `packOptions.ignore` 都加 `.atomcode`**。
4. **一次性提交**：7 个新函数（105 文件）+ `verify_all.js` 接线 + 索引修复 + 两处文档与派生 txt + 忽略项。提交前 `git diff --cached --stat` 确认没有行尾翻动（§1 那条）。
5. 回执请写清：**"29 文件"的口径**、索引是否已在云端建过、以及 §2.3 那条用例是否补上。
6. 之后回到常驻队列：真云两月 `calcAmortize`、真云 `smokeTest`（验 R29）、23 条用例并入套件、上传留提审前。

## §6 能力边界

- **云端索引现状我核不了**（控制台状态）；**A7 已定案"代码建不了索引"**，所以 §3/C 的 drop/建必须人工在控制台做。
- 开发者工具、云端、远端 push、`verify_all` 端到端 —— 一如既往核不了（我用"逐个跑 17 个成员"替代）。
- 本轮我对仓库**只读**（唯二写入 = 本份 REVIEW 与其副本）；变异全在工作区副本上做，**且第一次尝试因我用 `-LiteralPath` 配通配符导致拷贝 0 文件、node 报 ENOENT 被误读成"变异被抓住"，已修正并加自证步骤**（先验拷贝数 15、再验基线 25/25，才施变异）。
