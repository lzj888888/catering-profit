# NOTE · round115（2026-09-24）—— M1 结果页「行业对照」落地 + 修 `Number(null)===0` 真缺陷 + R129 新守卫

> 本轮起因（李老师原话，逐字）：
> 「记得提过的M1指标 吗？比如人工占比 等 ，昨天询问是否加，参考M2模型，现在看可以加了，
>   只是这些指标后期要变动，所以看小程序怎么写方便以后变更升级，」
>
> 拆成三件事：① M1 结果页**现在可以加**指标对照了（昨天还在问"是否加"）；② **参考 M2 模型**
> （复用 M2 的指标口径与参考带）；③ **核心关切 = 可变更性** —— 指标后期要变动，问「小程序怎么写」
> 才方便以后变更升级。**本轮三件全做**。

## 0 一句话结论

「指标后期要变」这个问题的答案不是"把数字写到某处"，而是**四层分离**：
归属层（`terms.js` 细项挂 `indTag`，偶尔变）→ 计算层（`getLedger` 按 tag 汇总，极少变）→
**参考带层（`indicatorRef.js::BANDS`，最常变 · 唯一改动点）** → 展示层（**页面零阈值**）。
落地时顺手抓出两个真缺陷：**① M1 台账科目与 M2 指标口径错位**（`manage` 无对应科目）、
**② `Number(null) === 0`** 让"没填"被算成"0%"（毛利率判 `bad`、推广费判 `good`）。

## 1 李老师三项拍板（AskUserQuestion）

| 问题 | 选项 | 决议 |
|---|---|---|
| M1 台账里没有「管理费」这个科目，这项指标怎么取数？ | M1 不做管理费这一项 / 硬凑一个科目 | **M1 不做管理费这一项** |
| 推广费这项，M2 是「费率」、M1 是「金额」 | 加一行小字说明 / 不做 / 换算 | **加一行小字说明**（`indMktNote`） |
| 指标对照这块，现在就开工吗？ | 现在就做 / 等等 | **现在就做** |

## 2 🔴 本轮最值钱的查码发现：M1 台账科目 ≠ M2 指标口径

M1 台账的支出只有 **4 个大类**（`operation` / `labor` / `marketing` / `other`），
而 M2 的指标要 **5 个成本项**（`rent` / `labor` / `energy` / `manage` / `mkt`）⇒ **天然错位**：

| M2 指标键 | M1 台账对应 | 取数方式 |
|---|---|---|
| `rent` | **藏在 `operation` 的细项里** | 按细项名 `房租` 命中 |
| `labor` | `labor` 大类（**直接对应**） | 细项名命中，未命中则**大类整额回落** |
| `energy` | `operation` 的细项 | = **水费 + 电费 + 燃气费** 三项之和 |
| `manage` | **无对应科目** | ⇒ 李老师拍板 **不做** |
| `mkt` | `marketing` 大类（**直接对应**） | 细项名命中，未命中则大类整额回落 |

## 3 🔴 新形态缺陷：用可见文案当机器匹配键 = 静默失效

M1 台账落库存的是**细项名字符串**（`sub_item`），归属靠 `indicatorRef::ITEM_TAGS` 按名字匹配。
⇒ 李老师哪天在 `terms.js` 把「房租」改成「租金」，归属表就**匹配不上**：
页面显示「—」、**不报错、不崩溃、门禁全绿** —— 这是最贵的一类 bug（改了文案，功能悄悄没了）。

而且细项名**用户可自定义** ⇒ 名字**本来就不是稳定键**。本轮做法：

1. **名字命中优先**（`TAG_BY_ITEM`）；
2. 名字未命中 ⇒ **回落到大类级归属**（`CATEGORY_TAG = { labor: 'labor', marketing: 'mkt' }`），
   保证用户自建细项（如「临时工」）不整笔漏算；
3. ⚠️ `operation` / `other` **故意不列**：它们是把房租 + 水电 + 物业混装的大类，
   **整额归属等于把 15000 运营费整笔当房租** ⇒ 宁少一项也不猜（fail-closed）。

⇒ **这一条已立机器守卫 R129**：把「归属表每个名字必须真实存在于 terms 支出细项」变成判据，
**改名即转红**，而不是悄悄算不出数。

## 4 🔴 同轮抓出的真缺陷：`Number(null) === 0`

探针 `_probe_r115.js` 用例 9（**我主动探边界**，非他人报）：

- `grossMargin` 缺项 ⇒ 得 `0% / bad`（应为 `null / na`）
- `mkt` 缺项 ⇒ 得 `0% / good`（**0% 最低 = 优秀** —— 最坏方向的错）

真因：`evaluateIndicators` 里 `const gm = Number(opt.grossMarginPct)`，
而 **`Number(null) === 0`** ⇒ "没填"被当成"填了 0"。
⇒ 已加 `pctOrNull()` 严格区分「没填（`null`/`undefined`/`''`）」与「填了 0（`0`）」；
**缺项 `pct = null` → `level = 'na'` 不评级**，前端显示「本月没填」而不是 0%。

⚠️ 与 round114 的 P0（"没填"被当成"填了 0"）**同族** —— 那条在**入参校验层**，这条在**指标计算层**。

## 5 落地清单

| 层 | 文件 | 改动 |
|---|---|---|
| 单源 | `cloudfunctions/common/indicatorRef.js` | 新增 **§七**：`ITEM_TAGS` / `CATEGORY_TAG` / `tagOfItem` / `sumByTag` / `toFixedFen` / `indFenKeyOf` / `M1_IND_KEYS` / `m1IndicatorsOf`；新增 `pctOrNull()` 并改 `evaluateIndicators` |
| 派生副本 | `cloudfunctions/*/cx_indicatorRef.js` ×42 | `node tools/sync_common.js` 同步 |
| 云函数 | `cloudfunctions/getLedger/index.js` | 读 `shop` 取业态/城市；出参 `indicators` + `indicator_scope` |
| 云函数 | `cloudfunctions/getLedger/selftest.js` | 新增第 5 段（细项归属 / 缺项不出键 / operation 不猜 / 自定义回落 / 映射 / 缺项→`na`）⇒ **37 → 57 通过** |
| 云函数 | `cloudfunctions/saveShopSetting/validate.js` + `index.js` | 业态/城市白名单（**三态**：`undefined`=不动库 / `''`/`null`=清空 / 非白名单=报错）；出参回读 |
| 前端 | `pages/month/result.js` · `result.wxml` · `result.wxss` | 「行业对照」卡：两个 `<picker>`（业态/城市）+ 逐行（名 / 评级 / 你的值或「本月没填」/ 行业带）+ 口径注释行；**零硬编码阈值** |
| 全局样式 | `app.wxss` | 评级配色 `.lv-good/.lv-ok/.lv-warn/.lv-bad/.lv-na` **上提为全局单源**（原只在 `pages/sandbox/index.wxss`，为免 M1/M2 漂移） |
| 术语 | `miniprogram/i18n/terms.js` ≡ `specs/dev-specs/i18n/terms.js` | 7 键：`indTitle/indSub/indMissing/indMarginNote/indMktNote/indScopeTip/indScopeChange`（md5 双副本一致） |
| 守卫 | `tools/check_m1_indicator_view.js`（**新 · R129**） | 6 段 31 条，见 §6 |

### 5.1 energy ↔ utility 键映射（易错处）

M2 指标键是 `energy`，而 `evaluateIndicators` 的 `fixedFen` 入参键是 `utility`
（源自 `INDICATORS.from: 'fixed:utility'`）⇒ 映射**必须由后端单源出**
（`indFenKeyOf` / `toFixedFen`），**前端不许猜**。

## 6 R129 判据（6 段 31 条 · 全部 fail-closed）

- **P 前置**：5 文件可读 / terms 支出大类有细项 / 细项名全集已构建
- **A 静默失效**（本守卫存在理由）：
  - `A-①` 🔴 **归属表每个名字必须真实存在于 terms 支出细项**（改名即转红）
  - `A-③` 🔴 归属表**不含 `manage`**（李老师 2026-09-24 拍板）
  - `A-④` 反向：`energy` 归属名恰好「水费/电费/燃气费」三项
- **B 页面零硬编码阈值**：引号感知剥注释后无「数字+%」/ 不引指标库 / 缺项走 `indMissing` / `has` 标记
- **C 出参契约 10 条**：调单源 `evaluateIndicators` / `m1IndicatorsOf` 过滤 / `indicators` / `indicator_scope` /
  **分母与 result 同源** / M1 口径恰 5 项不含 `manage` / 走 `sumByTag`+`toFixedFen` / 复用 M2 术语 / 三处同步
- **D 工具自证**：8 组正负样本互证（剥注释器 / `hasHardcodedPct` / `missingItemNames`）
- **E 下界**：断言数 ≥ 28（**实测 31**；⚠️ 初设 ≥22 是凭估，见 §9）

## 7 非假绿证明（变异回灌 `_mut_r129.py`）

**8/8 变异如期转红，且红的正是对应断言**：

| 变异 | 改回错误写法 | 期望转红 | 实测 |
|---|---|---|---|
| M1 | `rent: ['房租']` → `['租金']` | A-① | ✅ rc=1 |
| M2 | 加 `manage: ['管理费']` | A-③ | ✅ rc=1（同时带红 A-①） |
| M3 | `energy` 去掉「燃气费」 | A-④ | ✅ rc=1 |
| M4 | 结果页写死 `'低于 55%'` | B-① | ✅ rc=1 |
| M5 | wxml 去掉 `{{t.indMissing}}` | B-④ | ✅ rc=1 |
| M6 | getLedger 删 `indicators,` 出参 | C-③ | ✅ rc=1 |
| M7 | `revenueFen: incomeTotal` → `0` | C-⑤ | ✅ rc=1 |
| M8 | 去掉 `toFixedFen()` 调用 | C-⑦ | ✅ rc=1 |

还原后**逐字节 md5 全等**、守卫复绿 **31/0**。证据 `review/evidence/mut_r129_r115.txt`。

## 8 机器判据与部署

```
getLedger/selftest            57 通过 / 0 失败
saveShopSetting/selftest      35 通过 / 0 失败
check_indicator_ref           52 通过 / 0 失败
check_m1_indicator_view       31 通过 / 0 失败   ← 本轮新增
check_js_syntax / check_wxml_structure / check_page_terms / check_m2_no_cost_rate  全绿
verify_all                    102/102 套件通过 · RC=0
```

同步自证：`SUITES = 102 ≡ 头注 = 102 ≡ 重启键两处 = 102`（`check_suite_count_claims` 绿）；
断言数声明处 `check_m1_indicator_view` = **31**（`check_suite_assert_counts` 绿）；
terms 双副本 md5 一致。

部署（`-r` 必带 · 一次一个 · ENV 现读 `initDb/config.json`）：

```
_deploy_one.py getLedger        → success=true · filesCount=16 · packSize=36.7 KB · 17.5s
_deploy_one.py saveShopSetting  → success=true · filesCount=16 · packSize=31.7 KB · 17.2s
```

⚠️ **仅改前端页面**（`pages/month/result.*`）需在微信开发者工具里**上传体验版**才看得到，
云函数部署**不覆盖**前端。

## 9 本轮自踩的坑（已入 `PITFALLS`）

1. 🆕 **用可见文案当机器匹配键 = 静默失效**（新形态）—— 名字既是文案又是机器键时，
   改文案会静默改行为；必须并列**稳定机器键**。
2. 🆕 **`Number(null) === 0`** —— JS 里"没填"会被当成"填了 0"；凡"缺项应按缺项处理"处
   必须显式判 `null`/`undefined`/`''`。
3. **下界凭估（本仓第 3 次）** —— E-① 初设 `≥22` 是估的，真跑得 31；已按"真跑一次读末行取保守下沿"
   收到 **28**。（前两次：round114 `<input>` 估 8 实测 6；round108 同族。）

## 10 待李老师拍板 / 遗留

**A 组 · `PLAN_2026-09-24_M1结果页转型_指标对照与整改方向.md` §5 仍待拍板**：
1. 指标对照的**分母口径**（用月度录入的收入？还是允许自定义？）
2. **整改方向处方库**增删（草拟 6 行）
3. **时间窗** 5 类是否够
4. 是否同时做**趋势**（环同比）
5. 是否**并做 M1.6 四红线**（同一批改）

**B 组 · round111 遗留 4 条**：易耗品 / 净利率分档 / 水电燃气拆格 / 三项刚性。

**C 组 · 本轮遗留**：
- 前端页面**尚未上传体验版** ⇒ 真机还看不到对照块（**需李老师点一次**，云函数已上云）。
- 「术语键存在但值被掏空」缺口：R128 的 C-③ 只关掉了本处一条，**同类缺口在别处仍在**。

## 11 执行回执区（WorkBuddy 只追加）

- [2026-09-24 14:55] round115 功能+守卫已落 · 证据：`node verify_all.js` → `102/102 套件通过 RC=0`；
  `_mut_r129.py` → `8/8 变异转红 + 还原 md5 全等`；`_deploy_one.py getLedger/saveShopSetting` →
  `success=true · filesCount=16` · commit 见下条补录

- [2026-09-24 15:02] round115 已推 dev 并核验 · 证据：`git ls-remote origin refs/heads/dev` → `2d14424b68bf27fbc726f089dbb57fcd039e9266` == `git rev-parse HEAD` · commit `2d14424`
