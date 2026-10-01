# R185 · M3.31「每100g」补做包 —— 投喂 + 五件套验收取证

**日期**：2026-10-01　**批次**：M3v1.2_B（v1.2 §0 **D21** 定案「做」 · §M3.31 / §M3.38 属批次 B「含 per100g」）
**交付方**：快马 InsCode（模型 `deepseek-v4-pro`，turn 35，16 分钟，`Stopped` 非报错）
**门禁方**：WorkBuddy（登记 + 验收 + 变异回灌）

---

## 一 为什么有这一批（缺口的定性）

v1.2 §0 缺口表的**同一张表**里有四项：`combo`（套餐）/ `specs_json`（多规格）/ `s_user·s_merchant`（补贴承担方）/ `per100g`。
**前三项后来都补了，只有 `per100g` 没补** —— 且 `review/` 里**没有任何「延后 / 不做」的登记** ⇒ 定性为 **静默漏做**，不是「决定不做」。

补做包（可直接投喂）在 `specs/dev-specs/delivery/批次M3v1.2_B补_每100g计价_提示词_可直接复制.txt`。

---

## 二 投喂证据（三条独立判据，缺一不可）

| 判据 | 实测 |
|---|---|
| 余额探针 | `pros[0].api_key` + `https://api.taotoken.net/v1` ⇒ **HTTP 200** |
| InsCode 空闲 | `DB inflight_turn = 0`；上轮 `stop_reason = Stopped`（非 429 / 欠费） |
| 粘贴生效 | **像素 diff = 5826**；`inflight` **0 → 1**；User **23 → 24** |
| 送达逐字校验 | 末条 User 消息 == payload（`5852 = 5853 − 1`，尾部换行被 trim） ⇒ **未重复投** |

截图：`s1_pre.png` / `s1_pasted.png` / `s2_box.png` / `s3_sent.png` / `s4_sent16.png`（另 `e0_base.png`、`e1*cleared.png` 为清屏过程）。

---

## 三 验收（**不采信交付方自述**，逐条实测）

### ① 改动面（引擎红线）

| 项 | 判据 | 实测 |
|---|---|---|
| `cloudfunctions/common/` 单源 | 只允许 `specDerive.js` | ✅ 仅 `specDerive.js`（+7/−1） |
| 引擎零改动 | 四个引擎函数不得出现 | ✅ 改动文件仅 7 个：`specDerive.js` / 双 `terms.js` / `pages/card/edit.{js,wxml}` / 两个新 `tools/` |
| 派生副本 | `sync_common --check` | ✅ **43 个云函数目录 ≡ 单源派生** |
| 文案双副本 md5 | 两处 `terms.js` | ✅ 同为 `1faa6b7cea0dcd58099ad76d911f5d92` |

⚠️ 交付方报「共 50 文件 +433/−47」，其中 **43 个是 `cx_specDerive.js` 派生副本**（由 `sync_common` 生成），不是手写改动。

### ② 锚点**真值复算**（门禁方独立脚本，不复用交付方自测）

脚本：`_r185_truth.js`（仓外；直接 `require` 生产单源 `cloudfunctions/common/specDerive.js` + 生产引擎 `cloudfunctions/calcBom/service.js`）

| 项 | 期望 | 实测 |
|---|---|---|
| 全份基线（不经 derive） | — | `unit_cost_fen=975` / `material_total_fen=876` |
| per100g 恒等（全 1 系数） | 与全份**逐字节相同** | `975` / `876` ✅ |
| 恒等语义（per100g ≡ 全份） | 成立 | ✅ |
| 反例 `coef.main=0.5` | ≠ 975 | **624** ✅（派生确实生效） |

`SPEC_PRESETS` 现为三项：`half`(0.5/0.7/1/0.5/1) · `small`(0.7/0.85/1/0.7/1) · **`per100g`(全 1, `unit_label='100g'`)**。

### ③ **双向变异回灌**（证明守卫不是假绿）

脚本：`_r185_mutation.py`（仓外；改源码 → 跑守卫 → 还原）

| 变异 | 期望 | 实测 | 非崩溃 |
|---|---|---|---|
| M1 `coef.main` 1 → 0.9 | 红在 **P2** | ❌ P2（1 条） | ✅ 同时有 ✅ 输出 |
| M2 删除整条 `per100g` | 红在 **P1** | ❌ P1 + P2 + P4（3 条） | ✅ |
| M3 `unit_label` → `kg` | 红在 **P4** | ❌ P4（1 条） | ✅ |
| M4 自测锚点（M1 同一改坏） | 红在 **975/876** | ❌ `unit_cost_fen = 975 (got 905)` + `material_total_fen` | ✅ |

**4/4 全部命中目标断言名**（崩溃红 / 顺序红不算数）；**还原后双绿**（`6 通过 / 0 失败` · `7 通过 / 0 失败`）；**还原完整性校验通过**（源码 ≡ 备份）。

---

## 四 门禁方登记（六处同步面 · 123 → **125**）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `verify_all.js::SUITES` 末尾 | 追加 `['m3-per100g', …]` + `['spec-per100g-identity', …]`（同时把「末位套件」注释去掉「末位」二字，避免文档撒谎） |
| 2 | `verify_all.js` 头注 | `// 串联：123 个套件` → **125** |
| 3 | `verify_all.js` 头注守卫说明段 | 补 R141 一条（根因 / 判据 / 反恒真） |
| 4 | 重启键 §1.1 一键校验入口行 | `串 **123**` → **125** + 追加守卫说明 |
| 5 | 重启键「套件数会漂」行 | `（现 **123**；` → **125** + 演进链尾部追加 `→ **125（round185：…）**` |
| 6 | 重启键「套件断言数口径」声明行 | 追加 `selftest_m3_per100g`=7 / `check_spec_per100g_identity`=6；**三十九者 → 四十一者** |
| 7（按需） | `tools/check_suite_assert_counts.js::CASES` | 追加两条 |

### 本轮踩到的两个坑（都已修正并留档）

1. 🔴 **声明行 key 不能含连字符** —— 解析正则是 `` `?([A-Za-z0-9_]+)`?\s*=\s*(\d+) ``，连字符会被当分隔符。
   我初版用了 SUITES 的 display-name（`m3-per100g`）⇒ `A2` 报「缺少 key」、`A5-②` 报「多余 key：per100g, identity」。
   ⇒ **CASES / 声明行的 key 必须用下划线形式**（与文件名同形），**与 SUITES 的连字符 display-name 不是同一个东西**。
2. 🔴 **断言式脚本先拦住了我自己的判据错** —— 我断言「重启键 `**125**` 出现 ≥3 次」，而演进链格式是 `**125（round185：…）**`（**不含** `**125**`）⇒ 实际只有 2 次。
   是**我的判据错**，不是文件错 ⇒ 改为分别断言三处。

---

## 五 判据与结论

- 全量门禁（沙箱通道）：见 `gate/gate_185_1.txt`（提交前）与 `gate/gate_185_2_postcommit.txt`（提交后）；
- ⚠️ **本机原生通道不可用**：`git / cmd / where / node 自身` 全部 `EBUSY`（沙箱禁 node 派生子进程），走 `gate-under-sandbox` 技能的 Python 侧真跑通道。

---

## 六 本目录**不**包含什么（如实标注）

- **未做真机端到端**（per100g 规格行「（元/100g）」与说明句的实际渲染）—— 本地无小程序运行时；靠 `check_wxml_structure` + `check_page_terms` 覆盖，属**未实测**。
- **未上云**：`specDerive.js` 改动后尚未重新部署云函数（43 个函数目录受影响）⇒ 真云上仍是旧版。
- 截图仅用于**证明送达**，不用于取数。
