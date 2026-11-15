# R745 · M3 全模块最严格交叉审计（收敛报告）

> 任务：李老师「核验 M3 各个页面、数据导入导出、表格鉴别能力、跨店跨月数据正确性、功能窗口描述与实际是否相符，以及其他该审计的方面；依旧用最严格的交叉审计，去 GitHub 寻找适合的 SKILL」。
> 轮次 R745。五路执行通道 + 一路规范通道，全部完成。本报告由 team-lead 收敛；**每一条进入决策清单前，我均亲自真跑复核，未采信任何一路自述（含我自己的历史结论）**。

---

## 0. 方法与证据门（本轮相对前 10 轮的升级）

### 0.1 双通道证据门（本轮首次真正落地）
| 通道 | 角色 | 隔离约束 | 产出 |
|---|---|---|---|
| **A · 纯规范** | 只读 `specs/dev-specs/`，**不读实现代码、不执行程序、不读任何 review 结论** | 与 B 互不可见 | `review/evidence/_r745_channelA_claims.md`：247 条 claims + 17 处规范冲突 |
| **B1 · UI** | 读码 + 真跑探针，`_r745_probeD1..D6.js` | 彼此隔离，均不读 A | 功能窗口描述 vs 实现 |
| **B2 · IO** | 读码 + 真 SheetJS 0.18.5 真跑，`_r745_probeE1/E2.js` | 同上 | 导入/导出/表格鉴别 |
| **B3 · ISO** | 内存假 db + 真跑 exports.main，`_r745_probeF1/F2_*.js` | 同上 | 跨店跨月隔离 |
| **B4 · NUM** | 60 万组/70 万组随机对拍，`_r745_probeG1/G2.js` | 同上 | 数字链路 + 元审计（假绿） |

**为什么这样分**：GitHub `rajib2k5/claude-staff-kit::evidence-gated-validation` 指出——多模型投票去相关极弱（9 个裁判 ≈ 2.2~2.5 有效票），真正去相关的是**证据来源**；且「告诉复审方代码没问题」会使检出率掉 93.5 个点。所以 A 只从规范出主张、B 只从代码出行为，各自书面裁决后才合并。I 作为 lead 未把历史结论喂给任何一路。

### 0.2 去 GitHub 找 SKILL 的结论（详见 `r745_github_skills.md`）
检索到 4 个对口仓库：`rajib2k5/claude-staff-kit`（证据门）、`AI-for-engineering-research/prashanth`（property-based testing）、`dagoSte/squadra`（perimetro 范围纪律）、`Zhen-Bo/smell-check`（证据强度分级）。

**裁决：只吸收纪律，不安装**。理由三条：① `SKILLS_INDEX.md:148` 已判通用 code-review 类与本机机器守卫职责重叠「装了也是第二套标准」；② 外部多为 Claude Code/Python+Hypothesis 栈，与仓内 Node + `verify_all.js` 不同构；③ `smell-check` 明令「不执行被测代码」，与本仓「一切数字来自生产引擎真实输出」直接冲突。

落地为**项目级** skill：`catering-profit/.workbuddy/skills/evidence-gated-audit/SKILL.md`（三条纪律：双通道 / 轮次范围 / 证据强度分级），已登记进 `~/.workbuddy/SKILLS_INDEX.md`。它不在用户级 48 个之内，不影响门禁。

### 0.3 team-lead 亲自复核记录（不采信自述）
| 复核项 | 命令 | 实测 |
|---|---|---|
| 噪音红是否真实 | `node tools/check_auto_queue.js` | `25 通过/3 失败`，N-③/④/⑥ 因 `NEXT=745` 与 `_r745_*` 撞车 ⇒ 坐实 |
| GAP-1 分叉是否真实 | `sed` 对比两档案 + `grep keepContains` | 生产 `service.js:141-146` 仍 `rowFilter eq:'外卖订单'`/`qtyRule:'perRow'`，无 keepContains/refund；自测 `utils/billParse.js:70-86` 已修 ⇒ 坐实 |
| G1 提审文案是否真实 | `grep ERR.FREE_LIMIT / quotaUsedUp` | `terms.js:4240` =「已达免费上限，开通后解锁」、`:2051` =「…下一道需升级」 ⇒ 坐实 |
| G3 双占位符是否真实 | `grep freeLimitCardBody` + `paywall.js:147` | 文案含 2 个 `{n}`，`raw.replace('{n}',…)` 只换首个 ⇒ 坐实 |

---

## 1. 结论总览（诚实评级，不为凑数报 P0）

| 级别 | 条数 | 代表性 | 当前是否可达/是否算错 |
|---|---|---|---|
| **P0（提审红线）** | 1 | G1 配额文案「开通后解锁」 | 文案当前直接 toast 给老板；提审期出现「去开通」踩虚拟支付红线 ⇒ 整包驳回风险 |
| **P1（会算错钱）** | 2 | GAP-1 账单解析生产/自测分叉（39.85 元/44%）；GAP-3 营收表缺列静默按 0（888.88 元） | GAP-3 当前可达；GAP-1 预览可达、落库被开关拦（恢复开关即 P0） |
| **P2（真缺口，当前多不可达）** | 6 | F-1 `da.get` 不带 shop_id；GAP-4 错误 msg 被覆盖；G3 双占位符；净料成本无数值对拍；P-⑥ 无效变异自证；5 守卫无下界保护 | 详见 §2 |
| **P3 / 防御性 / 风格** | 8+ | F-2 fail-open；GAP-5 固定列序；S1~S6；规范冲突 17 条 | 正常路径不可达或属口径待拍板 |
| **已核实无问题** | 大量 | 金额全程分整数、5 副本 60 万组 0 差异、导出同源、i18n 双副本无漂移、api.call 死入口差集为空 | 见 §4 |

**一句话**：M3 的主体（页面绑定、隔离、金额精度、引擎等价、导出保真）经反复修复已相当扎实；**真正值得动手的是 1 条提审红线 + 2 条会算错钱的解析缺口**，其余多为防御性/口径待拍板，不应混为一谈。

---

## 2. 真缺口（按「当前可达 × 后果」排序）

### 2.1 【P0 · 提审红线 + 死指路】G1 配额错误码文案漏出「开通/升级/解锁」 [B1-UI]
- **位置**：`miniprogram/i18n/terms.js:4240` `'ERR.FREE_LIMIT': '已达免费上限，开通后解锁'`；`:2051` `quotaUsedUp: '免费额度已用完 —— 这道菜已存好，下一道需升级'`。
- **触发链（已逐跳核实）**：`cloudfunctions/saveCostCard/index.js:337` `hit_free_limit → fail(FREE_LIMIT_EXCEEDED)` → `utils/api.js:60,69` `msg = msgOf(r.code)`（后端 `r.msg` 仅 console.warn，不进 UI）→ `terms.js:4283` 映射 → `card/edit.js:1977` `toastError` 直接 toast。
- **为什么是 P0**：`utils/featureFlags.js:47-48` 明写**提审期出现「去开通」即踩诱导线下支付／虚拟商品未接入虚拟支付 → 整包驳回**；而 `utils/paywall.js:59-62,145-158` 免费期对能力类一律 `showNotOpen()`「暂未开放」、对 saveLimit 走 `showFreeLimit()` 且**明禁价格/支付/开通/客服/续费/升级**。老板被提示「开通后解锁」却全站无开通入口 ⇒ R738 同族死指路 + 提审红线。
- **同源打架**：同一错误 `card/index.js:441-447` 列表预检走 `showFreeLimit` 给中性文案「已达当前版本上限」，保存路径却 toast「开通后解锁」。
- **漏网原因**：守卫 `check_paywall_coverage` L9-③ 只扫 `showNotOpen`/`showFreeLimit` 函数体，扫不到 `terms.js` 的 `ERR.*` 键。
- **建议修法**：把 `ERR.FREE_LIMIT` 与 `quotaUsedUp` 改为与 `showFreeLimit` 同源的中性表述（如「已达当前版本上限，你已填的内容都还在」），删「开通/升级/解锁」；i18n 双副本同步；把 L9-③ 扩到 `terms.js` 的 `ERR.*`/`card.quota*` 键（禁词：开通|升级|解锁|付费|会员|订阅）。

### 2.2 【P1 · 当前可达，静默算错 888.88 元】GAP-3 营收日报缺列按 0 [B2-IO]
- **位置**：`cloudfunctions/revenueDailyParse.js:34-42` COL_MAP 精确等名；`:150-165` 表型识别只要求 SIG 三列（日期/班次/现金），不校验其余 15 列；`:315` 缺列 `get()` 返回 null → `:108-116` `num(null)=0` → `:377-380` 营收求和缺列按 0；`:497-523` 有 `cols` 但 `index.js:230-273` payload 不回传前端 ⇒ 零报错。
- **可达性**：`subpkg/biz/revenue/index.js:245` 上传 xlsx（可达），表里「美团外卖」列改名/缺失即触发。
- **真跑复现**：完整表 `revenueM1=1188.88`；缺列后 `=300`，少算 **888.88**；而 `cashInflow.pass=true`、`mismatches=0`、`identityOk=true` —— 自检恒等式两边同减仍成立，验不出。
- **建议修法**：`detectRevenueDaily` 后校验 `cols` 覆盖 `M1_DINEIN_KEYS ∪ M1_TAKEAWAY_KEYS ∪ REVENUE_FORMULA`，缺列回 `ok:false` + 结构化 `missingCols`（沿用 R286 diagnosis 模式），禁止静默 0；前端回传 diagnosis。

### 2.3 【P1 · 恢复开关即 P0，会算错 39.85 元/44%】GAP-1 账单解析生产/自测分叉 [B2-IO]
- **位置**：生产 `cloudfunctions/importSalesBill/service.js:141-146` meituan 档案仍是旧版 `rowFilter:{col:'交易类型',eq:'外卖订单'}`、`qtyRule:'perRow'`、无 `orderType/refund/refundTypeContains`；`:317-342` `parseBillMatrix` 无 keepContains/isRefundType。自测 `utils/billParse.js:70-86,313-351` 已含 R695/R700 修正。
- **根因**：R695/R700 只修了 utils 侧；`tools/check_bill_realtables.js:22` 用 BP(utils)、`:91` B 组只调 `BP.parseBillMatrix`，`:252` 加载 SV(云端) 仅用于 G 组 detectDishShape ⇒ **全仓零断言调 `SV.parseBillMatrix`**；`selftest_bill_parse.js:86-92` 只查 4 个字面锚点，不比字段不跑行为。
- **真跑**：美团退款真表 `review/evidence/r700_realtables/meituan_bill.json` → 自测 9081 分/5 单/6 行，生产 13066 分/5 单/5 行，差 **3985 分**。
- **可达性（诚实）**：`BILL_IMPORT_ENABLED=false`（`service.js:445`、`utils/featureFlags.js:29`），`confirm=true` 落库被 `index.js:406-408` FORBIDDEN 拦 ⇒ **当前不写账**；但 `confirm=false` 预览经 `takeaway/index.js:858-865` 展示给老板且数字错 ⇒ 当前可达、恢复开关即 P0。定 P1。
- **建议修法**：把 utils 的 meituan 档案 + keepContains/refund 逻辑同步进 service.js（或抽 common 单源派生）；补**行为级**守卫真调 `SV.parseBillMatrix(美团退款真表)` 断言 9081 分；门禁改调生产函数（见 §2.6 GAP-2）。

### 2.4 【P2 · 当前可达，失败不可观测】GAP-4 后端 msg 被通用文案整条覆盖 [B2-IO]
- `utils/api.js:60/69` 把 `fail(code,msg)` 的 msg 整条覆盖成 `msgOf(code)`，原始 msg 只落 console.warn（`:66-68`）。实例：`importSalesBill/index.js:796` DSI-1 `fail(INVALID_PARAM, parsed.error)`，`parsed.error` 本含行号「销量或销售额不是数字（销量）：第 2 行『abc』」⇒ 老板只看到通用「参数有误」。同类 `:333-335/:359/:407/:695/:706`。
- 注释自述不实：`:795` 写「人话+行号原样透出」、`:404-405` 写「msg 会透传」，与实际相反。
- 对照：认不出表走 `ok.diagnosis`（`index.js:369-374` + `takeaway:754-783`）这条 R286/R631 已修；DSI-1 只回第一条错误、skipped 不回传。
- **建议修法**：这些 fail 改走 `ok({error_detail})` data 通道，或 `api.call` 对白名单 code 透传 `r.msg`。⚠️ 动 `api.js` 是全局面，风险大于前三条，需单独评估。

### 2.5 【P2 · 结构性，正常路径不可达】F-1 `da.get(coll, 业务主键)` 不带 shop_id [B3-ISO]
- `cloudfunctions/common/dataAdapter.js:82,85-101`：`get()` 兜底 `where({[field]:id}).limit(1).get()` **无 shop_id**，签名也不接收 shop_id。受害点：`saveMaterial/index.js:53,67`（→:56,:76 写）、`saveAsset/index.js:91,106`（→:101,:124 写）、`saveCostCard/index.js:175`、`syncCostCard/index.js:94,225`（BOM 读别店进价）。
- 真跑探针 F2：传自己的 `shop_B` + 别店 `mat_x` ⇒ SUCCESS 且 A 店原料 name/进价被改写。
- **不可达理由（诚实定级 P2 偏低）**：主键由 `genId`（时间戳 base36 + 6 位随机，`common/auth.js:18-20`）生成不可猜，本店读接口按 shop_id 过滤 ⇒ 需「已知/猜到别店 id 或主键碰撞」。R743 §4 已登记同型，本轮坐实并扩到 saveMaterial + 读侧 BOM。
- **建议修法**：`get(coll,id,shopId)` 加第三参 + where 拼 shop_id + `:99` 后加 `if(shopId&&doc.shop_id!==shopId) return null`；6 个调用点传 shopId；**改完必跑 `node tools/sync_common.js` 重派生 51 份 cx_dataAdapter.js**。或更省事：写路径改 `da.list(coll,{shop_id,id})` 取 `row._id` 再写（不动单源）。⇒ 牵动面大，本轮不动。

### 2.6 【P2 · 元审计：门禁本身有洞】GAP-2 + P-⑥ + 5 守卫无下界 [B2-IO + B4-NUM]
- **GAP-2 测试路径≠生产路径三处**：(a) `check_bill_realtables.js` 零断言调 SV.parseBillMatrix（见 §2.3）；(b) `selftest_bill_parse.js:86-92` 只查 4 个字面锚点，注释称「逐字节等价由 probe_cf_parity.js 证」但该只在一次性证据目录、**未登记 verify_all**；(c) `check_import_encoding.js:29-32` 用假 xlsx 桩（自己剥 BOM、裸切引号内逗号），`cloudfunctions/exportData/selftest.js:10-18` 又内联一份 CSV 函数且表头写「金额(分)」而生产是「金额(元)」。⇒ 「只修 utils/只修桩」全绿放行，正是 GAP-1 长期无人发现的机制。
- **P-⑥ 无效变异自证**：`check_card_live_cost.js:323-326` 只自证 `LOAD_BODY.replace(/Promise\.all/g,'serialFallback')` 字符串替换生效，**从未把 mutated 喂回 P-① 判据**；把 P-① 改成 `()=>true` 后 P-⑥ 仍绿。修法：用变异后源码重跑 P-①，断言 true→false（可用 skill `mutation-backfill`）。
- **5 个 M3 守卫未纳入断言数下界**：`check_m3_card_roundtrip`/`check_m3_margin_bands`/`check_m3_page_behavior`/`check_m3_storage_isolation`/`check_m3_chain_clarity` 不在 `check_suite_assert_counts.js` CASES，删一批断言后通过数仍 >0，A0-② 抓不到。
- **CI 缺口**：`.github/` 不存在、`.git/hooks/` 只有 sample ⇒ **无推送前强制门禁**；`verify_all.js:1963` execFileSync 无 timeout（挂死而非跳过，方向安全）。退出码本身扎实：`:1953-1994` `process.exit(failed?1:0)`、catch 不吞、R66/R69 即使 rc=0 也审断言。

### 2.7 【P2 · 覆盖缺口，当前不显形】净料成本快照前端/云端无数值对拍 [B4-NUM]
- 前端 `utils/units.js:170-175` `netUnitWanOf` 与云端 5 份 `netUnitCostWan`（`calcBom/service.js:47`、`saveCostCard/service.js:17`、`syncCostCard/service.js:9`、`saveMaterial/service.js:6`、`getMaterial/service.js:7`）是两处独立实现；`check_yield_rate_range` E 段只比云端 5 副本、`check_unit_family` L4 只守源码形状、`check_m3_engine_parity` 只比 calcCostCard ⇒ **无守卫做「前端快照 ≡ 云端重算」数值对拍**。
- 真跑：按 cf=1 正确折算，10 万组中 2 位小数日常输入 31042/100000（**31%**）数字不一致，3 位小数 93%（前端用完整元精度、云端路径 B 收整数分）；若误把「原单位分」喂 `netUnitCostWan(600,1,100)` 差 **600 倍**且零报错。
- **当前不显形理由**：主链路走路径 A（`edit.js:1883/1892` 送 net_unit_cost 快照），落库与页面同源；`validate.js:77` 二选一使「原单位分」误喂不可达。属**契约歧义 + 覆盖缺口**，非当前错钱。
- **建议修法**：钉死「该走哪条」+ 加一条参数化对拍（见 §5 省力建议）。

### 2.8 【P2/P3 · 不可达或口径待拍板】其余
- **F-2 fail-open**：`getDishReview/service.js:224-228`、`getSalesBills/index.js:50-55` 缺区间不过滤。当前 4 个生产调用点全传区间（`dishreview/index.js:495-497`、`recon/index.js:113-116`、`result.js:751,1064`），守卫 `check_dishreview_engine.js:812-825` 14-⑤/14-⑦ 盯住 ⇒ 不可致错。R719 §6 P2 已登记待拍板。
- **GAP-5 固定列序**：形态 A `service.js:463-470,747-761` 按 `r[c.colX-1]` 取数不按列名；列序变动即静默 0。依赖美团收银 POS 列序稳定 ⇒ 非 P0。
- **S 系列（能力/风格）**：CSV 能力闲置（云端支持 GBK/UTF-8/UTF-16LE CSV，两上传入口 `takeaway/index.js:736`/`revenue/index.js:245` 限死 xlsx）；导出「保留 2 位小数」无 numFmt；明细表大类/细项/合计平铺同列（SUM 会重复计）；`adminExport` 表头 `amount_fen` 实取 `r.amount`；recommit 二次确认丢 diagnosis。
- **审计噪音红（本轮已修并复验）**：`ROUND_INDEX NEXT:745` 与本轮 `_r745_*` 探针撞车 ⇒ 修前 `check_auto_queue` **25/3**、`check_suite_assert_counts` **134/2**，工作树跑 verify_all 会 exit 1。已将 `NEXT:745 → 746`（未删任何证据件），复跑 `check_auto_queue` **28/0**、`check_suite_assert_counts` **RC=0（全绿）**，确认噪音红是唯一根因。

---

## 3. Channel A：规范主张清单与规范冲突（高价值）

247 条 claims（编号 C-01…C-247 连续），按后果：A=160（可致账目错）/B=55/C=32。完整表在 `_r745_channelA_claims.md`（402 行）。

**17 处规范自相矛盾（K-1…K-17），建议在后续拍板轮逐条裁决**，其中影响面最大的：
| 编号 | 冲突 | 影响 |
|---|---|---|
| K-1 | 免费成本卡额度 **3/5/20 三值并存**（M3v10:277、M3v11:26、BIZ:27/31/44 等），且 C01 同文件 163=20 与 172/189=5 自相矛盾 | 直接决定 G1 文案里的数字，也决定配额行为 |
| K-3 | 配额维度 user_id 跨店 vs shop_id（C13 同段 L30/L32 自相矛盾） | 跨店配额隔离口径 |
| K-4 | 去重字段 card_id vs card_code（M3v11:166-167 自认待裁决） | 版本去重 |
| K-5 | is_latest 翻转 vs 不写不翻转按 version 最大（M3v11:574/605-608 明写「按 is_latest 过滤真云会静默取空」） | 取最新版本 |
| K-8 | per100g「coef 全 1 ⇒ 差异只在展示层」被同节 R547 更正推翻，旧表述未删 | 成本口径 |
| K-9 | 导入「销售额」口径：DSI1:44-55 定义标价且「实收别用」 vs M3v16:145-149 取收入 | 与 GAP-1 同族，会算错钱 |
| K-10 | 小数销量保留原始 vs Math.round 落库 | 与 GAP-5 相关 |
| K-14 | 导出能力 15 项列在功能表（未附付费条件）vs 免费全禁仅付费解锁 | 与 G1 同一提审红线族 |

> 通道声明：A 通道未读任何实现代码、未执行任何程序、未读任何既有审计结论。规范内嵌的「现状描述」仅当文本读取，未当判断依据。

---

## 4. 已核实无问题（逐项带证据，不为凑数报缺陷）

1. **金额全程「分」整数**：calcCostCard 出参 6 字段皆整数分/百分数；唯一小数金额 `net_unit_cost` 是「万分之一元」整数快照；落库 `total_cost=unit_cost_fen` 整数分。**无重复 /100 或 ×100**（[B4] 抽查）。
2. **引擎换算 ≡ 单源**：`Math.round(Number((x*100).toFixed(10)))`（calcBom/service.js:113/118/123）≡ `common/money.js:13-17 yuanToFen`，10 万组 0 差异。
3. **多副本等价**：5 份 netUnitCostWan 60 万组逐点一致；3 份 calcCostCard 70 万组（含小数用量/半步/损耗 99.99%）0 差异；`check_m3_engine_parity` 实跑 25/0 含 S3 锚点 + 反恒真 D 段。
4. **导出同源（R737/R743 同族）**：`exportData/index.js:494` listAll 分页取全、`:508` 读真库 `c.total_cost` ↔ `getCostCard/service.js:27` 同读 `doc.total_cost`；`:213-215` `value_fen` 优先、`total_value` 旧数据回落已修。
5. **导出↔导入「零交集」是设计不是 bug**：真 xlsx（5 sheet/35744 字节/PK 魔数）能被 `bufferToMatrix` 完整回读保真，但 detectDishMatrix/detectPlatformInMatrix/营收签名全不中 ⇒ 导出件是「给人复核/存档」、不是交换格式。仓内 `check_export_roundtrip.js:8-16` 自己已改判为「可回读 + 内容保真」并覆盖。⚠️ 与第 4 条不冲突：**同源 = 值来自同一库；零交集 = 表头不能当导入源**，两个维度。
6. **格式鉴别靠 magic bytes + 编码嗅探**，不靠扩展名（`service.js:75-92,97-110`）：GBK 无 BOM→gbk、UTF-8→utf8、UTF-16LE→utf16le、PK/OLE→null；R94 GBK 阻断已修；UTF-8 BOM 由真 SheetJS 自动剥掉；CSV 引号内逗号真库切对。
7. **金额精度历史坑已修**：20 万点三位小数穷举，`common/money.js:17`、`utils/api.js:84`、`cx_money.js:17`、service 6 处内联式、`revenueDailyParse.js:120` 逐点 0 分歧。
8. **跨店跨月隔离主体扎实**：41 个 storage 调用全量复核无残留裸业务 key；所有云函数 `da.list/listAll` 读点带 shop_id；33 个写函数全调 `assertShopOwner`（`common/auth.js:169-212`，探针 FORBIDDEN 实证）；`importSalesBill` 的 `_id=SALE_<shop_id>_...` 含店号天然隔离；软删 `is_deleted:false` 强制放最后不接受覆盖；归档月 M1 只读（saveLedger:82-90 等）。
9. **页面描述↔实现绝大多数吻合**：api.call 死入口差集为空（34 个字面量调用全命中 61 个云函数目录）；i18n 双副本 md5 相同 `e7f27cba…`；「导出 Excel」端到端真做；R738「去设置页填」已修无残留；7 个 hub 入口全绑定且已注册；「还能撑几个月」闭环真实（`cx_diagnosisEngine.js:219` → `diag/result.wxml:71`）。
10. **11 个 M3/金额守卫抽查未发现恒真/空数组/空扫描面/错字段名 fixture**（`check_m3_engine_parity` 25/0、`check_card_live_cost` 85/0、`check_unit_family` 76/0 等）——唯一确凿假绿是 P-⑥ 一条。

---

## 5. 决策清单（请李老师拍板，我不擅自改产品代码）

按 `perimetro` 纪律：**本轮是审计轮，只收「核验」这一件事**；过程中发现的问题，除「阻塞本轮收口」者外，一律登记延期项（owner / 触发条件 / 验收判据），下一轮才开任务。本轮唯一当场处理的是阻塞收口的噪音红（已修）。

### A. 建议下一轮立即修（按此顺序）
| 序 | 项 | 为什么 | 验收判据 | 影响面 |
|---|---|---|---|---|
| 1 | **G1 提审红线文案** | 提审期「去开通」可致整包驳回；修法明确、不改金额 | 禁词扫描扩到 terms.js 后全绿；免费期限额 toast 为中性文案；真机看超限提示无「开通/升级/解锁」 | i18n 双副本 + 1 守卫 |
| 2 | **GAP-3 营收缺列 fail-closed** | 当前可达、静默错 888.88 元 | 缺「美团外卖」列表上传 → `ok:false` + `missingCols`，不再算 300 | 解析云函数 + 前端 diagnosis 回传 |
| 3 | **GAP-1 账单解析同步** | 恢复展示开关即 P0，当前预览已错 39.85 元 | 行为级守卫真调 `SV.parseBillMatrix(美团退款真表)` 断言 9081 分 | 云函数 service.js + 门禁（+ 部署） |

### B. 建议修但低风险（可与 A 合并）
- **G3**：`utils/paywall.js:147` 改 `raw.replace(/\{n\}/g, String(n))`；验收：双 `{n}` 全部替换成数字。
- **P-⑥**：`check_card_live_cost.js:323-326` 把 mutated 喂回 P-①，断言 true→false；验收：把 P-① 改恒真后 P-⑥ 必须红。
- **5 守卫下界**：纳入 `check_suite_assert_counts.js` CASES + 声明行。

### C. 登记待办，本轮不动（理由如实）
| 项 | 不动的理由 |
|---|---|
| F-1 `da.get` 不带 shop_id（P2 偏低） | 改 `common/dataAdapter.js` 触发**51 份 cx_ 重派生** + 12 个云函数写入契约；正常路径不可达（id 不可猜）。需单独一轮 + 会诊 |
| GAP-4 msg 覆盖 | 动 `api.js` 是全局面，风险大于 A 组三项 |
| F-2 fail-open | 需先定产品口径（fail-closed / 默认本月 / 保持全返），R719 §6 已登记待拍板 |
| GAP-5 固定列序 | 依赖 POS 列序稳定，非当前错钱 |
| 净料成本前端/云端对拍 | 主链路走前端快照当前不显形；属契约歧义，需先定「该走哪条」 |
| 规范冲突 K-1…K-17 | 产品口径层面，尤其 K-1（额度 3/5/20）直接决定 G1 文案数字，需李老师拍板后统一 |
| 「老板选择留置」分支 / R743 P2/P3 | M3 产品口径 + 新 UI，未经讨论不实装（延续 R744 裁决） |

### D. 体系优化（省力建议，供选而非承诺）
- **一个参数化对拍器**取代每引擎一份 3000 组循环：副本清单 + 签名函数 + 确定性种子 + 样本数 + 反恒真变体。B4 用单个探针复核了 5 副本 60 万组 + 3 副本 70 万组，比 10 份专用守卫更省力且样本大 100 倍。
- **把证据件命名/轮次号从守卫扫描面解耦**（或 NEXT 由机器推进），避免「写个合规探针就连锁红」——本轮已经踩到一次。
- 可用现成 skill：`mutation-backfill`（修 P-⑥）、`keep-latest-cleanup`（滚动证据件只留最新 N）、`engine-truth-audit`、`gate-suite-checklist`、`preflight-no-false-start`。

---

## 6. 本轮产出物
- 报告：本文件 `r745_m3_cross_audit.md`
- GitHub skill 检索裁决：`review/evidence/r745_github_skills.md`
- 项目级 skill：`.workbuddy/skills/evidence-gated-audit/SKILL.md`（+ `~/.workbuddy/SKILLS_INDEX.md` 登记）
- 规范 claims：`review/evidence/_r745_channelA_claims.md`（247 条 + 17 冲突）
- 执行探针：`_r745_probeD1..D6.js`、`_r745_probeE1/E2.js`、`_r745_probeF1/F2_*.js`、`_r745_probeG1/G2.js`
- 轮次推进：`review/ROUND_INDEX.md NEXT 745 → 746`（消除噪音红，`check_auto_queue` 28/0）

> 诚实提示：本轮**未改任何产品代码**，因此也**未部署、未出新真机码**。所有真缺口处于「已取证、待拍板」状态。
