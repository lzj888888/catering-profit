# R232 · gradeGate 双副本等价守卫（把 R231-4 从「建议」变成「在挂」）

> 触发：李老师「外卖那份不是菜品级…**这个数据还需要再等待一下，先做其他的吧**」（2026-10-06）
> 执行：WorkBuddy（巴迪）· 仓根 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`

---

## 一 一句话结论

**R231 登记的「建议守卫 R231-4」已提前落地** —— 新增 `tools/check_grade_gate_dual.js`（**12 断言**），
套件 **142 → 143**，门禁 **143/143 · RC=0 · 真 FAIL=0**。

**为什么是现在挂（而不是等本批实现）**：R231-4 守的是**既有**代码，而本批（M3.33 阶段②）**正要给
`platform` enum 加 `'pos'`（堂食渠道）** ⇒ 两份副本**改一处漏一处＝一侧放行、另一侧拒收，且全程静默**。
守卫挂晚了，正好错过唯一的漏接窗口。

---

## 二 缺口是什么（真缺口，非纸面演练）

| 项 | 事实 |
|---|---|
| 副本 A | `utils/gradeGate.js` —— 前端单源（`SALES_SCHEMA` + `checkGradeA`，批次 F 甲级门禁）|
| 副本 B | `cloudfunctions/importSalesBill/service.js` —— **云端内联副本**（云函数独立打包，**不能** require 小程序侧 `utils/`，内联是规范允许的）|
| 现状 | 两份之间 **零守卫**（`selftest_grade_gate.js` 只 require A 那份 ⇒ **B 漂移永远测不出**）|
| 后果 | 改 `platform` enum / `qty` 规则 / 任一字段属性，只改一侧 ⇒ **前端预览放行、云端拒收（或反之）且不报错** |

---

## 三 判据（12 条 · S/A/B/C 四组）

| 断言 | 判据要点 |
|---|---|
| S-① | 两份副本文件存在且非空（各自 > 800B）|
| S-② | 前端单源可加载，导出 `checkGradeA(function)` / `SALES_SCHEMA(object)` |
| S-③ | 云端副本可加载，同样导出二者 —— **`xlsx` 是云函数外部依赖（本地未装）⇒ 仅对 `require('xlsx')` 注入空桩，并在输出里明示「用的是桩」**（不静默替换被测物）|
| A-① | `SALES_SCHEMA` 字段名集合相等（缺 / 多都红）|
| A-② | 逐字段逐属性**值**等价（`pattern` 归一化为 `source+flags`、`enum` 逐值；**不比字面**）|
| A-③ | 关键锚点在场：`platform.enum ⊇ {taobao,meituan,eleme,other}` 且两份 `qty.integer === true`（防「两份一起被换成空壳」仍判绿）|
| B-① | **组合电池 882 组**（7 平台 × 9 行形态 × 4 合计 × 3 shopId 主面 ＋ 生产调用形态 `self`/`empty`）逐组比对 `{pass, level, failures}` 序列化结果 |
| B-② | 电池**有分辨力**：必须同时产出过 `pass=true`（16 组）与 `pass=false`（866 组）—— 否则「两份都恒 true」也会全等 |
| C-① | 电池样本数下界 ≥ 800（防组合嵌套被改小 ⇒ 覆盖面悄悄缩水）|
| C-② | schema 字段数下界 ≥ 9（防「两份一起被削成小 schema」仍判绿）|
| C-③ | 影子反例（结构面）：把副本 `platform.enum` 削一项 ⇒ 结构比较器**必须**报差异，且**差异落在 platform 字段** |
| C-④ | 影子反例（行为面）：一侧 `enum` 加 `pos`、另一侧没加（**真实漂移形态**）⇒ 行为比较器**必须**报差异，且**只报 `SCHEMA_PLATFORM` 判别**差异（117 组）|

### 3.1 关键设计取舍（三条）

1. **判行为不判字面**：两份文本本来就不逐字等价（云端把 `pattern` 提成局部变量 `pat`）⇒ 只比**值**与**行为**。
2. **自失效护栏是必需项**（上限/覆盖类判据先天假绿）：样本下界 + 字段数下界 + **两组影子反例** —— 覆盖（表 ⊇ 池）之外还要**内含**（关键锚点在池里）。
3. **🔴 影子必须「只差被测项」** —— 首版我用 `JSON.parse(JSON.stringify())` 克隆 schema，把 `RegExp` 退化成普通对象
   ⇒ C-④ **红在了无关原因**上（`fields.biz_date.pattern.test is not a function`）。
   这不是"守卫有分辨力"，是**影子太弱/方向不对**（与 `mutation-backfill` §10.6 同族）。
   ⇒ 改成**保留 RegExp 的深克隆**，并把判据加严成「差异**只**落在 `SCHEMA_PLATFORM`」；改后 C-④ 报 **117 组、全部落在 platform 判别**。

---

## 四 变异回灌 5/5（全部红在**目标断言名**上 · md5 全等还原）

| 变异 | 改什么 | 期望 | 实得 | 还原 |
|---|---|---|---|---|
| **M1** | 只改一侧：云端 `platform.enum` 删 `'other'`（真实漂移形态）| 红 **A-②** | rc=1 · 红 A-②,B-① | md5 ✅ |
| **M2** | 只改行为不改结构：云端 `checkGradeA` 去掉 `REQUIRED_SHOP_ID` 分支 | 红 **B-①** | rc=1 · 红 B-①（A 组全绿）| md5 ✅ |
| **M3** | 两侧同时删 `'other'`（结构仍等价，但锚点丢失）| 红 **A-③** | rc=1 · 红 A-③ | md5 ✅ |
| **M4** | 只改结构、**行为测不出**：云端 `source.enum` 删 `'manual'`（`checkGradeA` 不读 `source`）| 红 **A-②**，**B-① 保持绿** | rc=1 · 红 A-② / B-① 绿 | md5 ✅ |
| **M5** | 只改结构但**行为可测**：云端 `qty.min 0 → 1`（电池含 `qty=0` 边界样本）| 红 **A-② 且 B-①** | rc=1 · 红 A-②,B-① | md5 ✅ |

> **M4 最有价值**：它证明 **A 组（结构）不可被 B 组（行为电池）替代** —— 若只做行为等价，`source.enum` 这类
> 「实现根本没读的字段」的漂移会被静默放过。反过来 M2 证明 B 组也不可被 A 组替代。**两组互补，缺一不可。**
> 取证：`review/evidence/r232_gate/mut_r232.out.txt` · 脚本 `review/evidence/r232_gate/mutate_r232.py`

---

## 五 六处同步面（全绿 · 自查 + 守卫双证）

| # | 位置 | 改后 | 谁守 |
|---|---|---|---|
| ① | `verify_all.js::SUITES` 末尾 | `['grade-gate-dual', 'tools/check_grade_gate_dual.js']` | R92（真 git 判入库）|
| ② | `verify_all.js` 头注「串联：N 个套件」 | **142 → 143** | R59 `guardSuiteCount`（不改当场 exit 1）|
| ③ | `verify_all.js` 头注守卫说明段 | 补 R232 一段（根因/判据/自失效护栏）| 人读面 |
| ④ | 重启键 §1.1「一键校验入口」行 | **142 → 143** | `check_suite_count_claims` C2-② |
| ⑤ | 重启键「套件数会漂」行 ＋ **演进链尾部** | **143** ＋ `→ **143（R232：…）**` | C2-③（最易漏的一处）|
| ⑥ | 重启键「断言数口径」声明行 ＋ `check_suite_assert_counts.js::CASES` | `check_grade_gate_dual`=**12**；「五十三者」→「**五十四者**」 | A2 / A5-② |
| ⑦ | `tools/check_suite_assert_counts.js::CASES`（按需）| 加 `{ key: 'check_grade_gate_dual', rel: 'tools/check_grade_gate_dual.js' }` | A0/A2 |

⚠️ 写入方式：**一次脚本化写入 + 两阶段**（先校验 7 个锚点各命中 **1** 次，全通过才落盘）。
首轮锚点 3 **命中 0 次**（`verify_all.js` 的 SUITES 行实际是 **11 个空格**、我按 10 写）⇒ **脚本停手、零文件被写**（§3.3 的正收益）。
脚本：`%TEMP%\inscode\sync_r232.py`。

---

## 六 勘误与「已登记差异」

1. **规范 v1.6 §12 勘误**：本节原写「**本文件不提前挂**」（全表口径）。复核后确认 **R231-4 是例外**（守既有代码、且必须在加 `pos` 之前就位）
   ⇒ 表头改为「R231-1/2/3/5 随实现批次挂 · **R231-4 已提前挂**」，并逐项写明「本批不得重复创建」及其代价。
2. **投喂包 G §6 同步**：原表要求快马「新增 `tools/check_grade_gate_dual.js`」⇒ 现改为「✅ 已由门禁方 R232 提前挂好 · **本批不得重复创建**」，
   并补一句「**本批实际须新增的守卫 = R231-1 / 2 / 3 / 5 四条**」。
   🔴 **若不同步**：快马照旧包再建一份 ⇒ `check_suite_coverage` / `check_suite_count_claims` / `check_suite_assert_counts` **三条同时转红**（R230 已踩过「规范要新增 / 投喂包说不需」的同族矛盾）。
3. **R231 NOTE §3-4** 追加后续指针（**历史断言一字未改** —— 只加勘误注，符合「历史快照不动」纪律）。
4. 🔴 **已登记差异（R232 实测，不入判据）**：
   传**畸形 schema**（`fields.biz_date` 存在但缺 `pattern`）时，**前端那份会 `undefined.test` 抛错**，而**云端那份回落默认正则**。
   实测两份行为不同，但该路径**生产不可达**——两个调用点都只传 `SALES_SCHEMA`（`cloudfunctions/importSalesBill/index.js:67` 与自测）。
   ⇒ 按「已登记差异」留档（写进 v1.6 §12 勘误）；**若将来出现第三方 schema 调用点**，两侧须同时改成
   `(fields.biz_date && fields.biz_date.pattern) || DEF`。

---

## 七 顺带发现（**未改生产代码**，如实登记）

| # | 发现 | 处置 |
|---|---|---|
| 1 | `review/CHECKLIST_正式版发布前必做.md` §G 是**过期陈述**：它说「到期提醒**两条渠道全缺**」「G2 前端兜底提示条 = 我 待做」「G3 = 我 待做」，而**实测 G2 已落地**（`pages/month/index.wxml` + `result.wxml` 常驻渲染，样式 `result.wxss:2-4`，取值 `utils/entitlement.js::expireSoonDays`）、**G3 已接线**（`pages/month/result.js::onAskSubscribe` 调 `wx.requestSubscribeMessage`，但 **`tmplIds: []` 为空** ⇒ 实际仍推不了，仍卡 G1 模板 ID）| ✅ **本轮已更正**（`mutation-backfill` §15.5 同族：照「未挂」去补挂会**造出第二份**）|
| 2 | `cloudfunctions/payExpireNotify/index.js` 头注仍写「③ 前端无 `requestSubscribeMessage` 授权收集 ④ 前端无兜底提示条」—— **同属过期** | ⏸ **本轮不动**：改云函数文件会触发 A15「云函数逻辑零改动」登记 + 造成「云端包 ≠ 仓库」漂移，**收益（一句注释）不抵代价** ⇒ 登记待办，随下次该函数真改动时一并修 |

---

## 八 门禁与提交

| 项 | 值 |
|---|---|
| 门禁 | **143/143 通过 · RC=0 · 真 FAIL=0**（`review/evidence/r232_gate/gate_full.txt`）|
| 套件数 | **142 → 143**（本批**新增**守卫，六处同步面已改）|
| 证据 | `review/evidence/r232_gate/`（驱动 `run_gate8.py`、刷键脚本、`mutate_r232.py` + `mut_r232.out.txt`、`per_suite/` 143 件）|
| 环境 | 沙箱 **`spawnSync git EBUSY`**（探针实测）⇒ 走 Python 驱动逐套件真跑（技能 `gate-under-sandbox`）；**缓存按序刷新**：git 类 → 新套件键 → `mk_force` 全刷 → `mk_fix_py_keys` |
| 未动 | 引擎 / BOM 链 / 云函数代码 / 集合 / 索引 **一律零改动**；未部署 |

---

## 九 回执

- [2026-10-06] **R232 已落** ·
  - 新增 `tools/check_grade_gate_dual.js`（12 断言）· 六处同步（142 → 143）· 变异回灌 **5/5 全部红在目标断言 · md5 全等**
  - 勘误同步：v1.6 §12 · 投喂包 G §6 · R231 NOTE §3-4 · CHECKLIST §G
  - 门禁 **143/143 · RC=0 · 真 FAIL=0**（证据 `review/evidence/r232_gate/`）
  - 提交 = （回填）
