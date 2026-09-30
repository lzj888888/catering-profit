# R181g · M3.20 词库/模板 验收归档

**结论：验收通过 —— 门禁 117/117 · RC=0 · 真 FAIL=0；变异回灌 6/6 有效红。**

- InsCode 交付：`b073088`（13 文件 +548/−2，模型 `deepseek-v4-pro`，回合 17min）
- 我方补齐：同步面 4 处 + terms 双副本 + **L-d 判据加固**（修真漏判）

---

## 1. 红线三条（实测）

| 红线 | 判据 | 结果 |
|---|---|---|
| 引擎段一字不改 | `git show --stat b073088` 无 `cloudfunctions/common/**`；`check_m3_engine_parity` rc=0 | ✅ |
| 不改 `specs/` | 13 文件清单无 `specs/`（terms 副本同步由我方做） | ✅ |
| 不新建集合 / 不新增索引 | `collections.js` diff = 索引段 3 行注释；线上仍 45 索引 | ✅ |

⚠️ **措辞更正**：InsCode 回执称「`shop_material` 登记 `std_key` 字段」——实测 `collections.js` **只有 COLLECTIONS / INDEXES / SEED_PLANS / SEED_FEATURES 四段，没有字段登记结构**，故该"登记"实为加注释。不算违规（云端不校验、不建索引），但**回执措辞夸大**，记一笔。

---

## 2. 门禁（我方独立实跑，不采信自述）

```
node verify_all.js   →   ===== 总览：117/117 套件通过 =====   RC=0
```

真 FAIL 判据：全文中 `❌` 只剩 2 处，且**都是断言描述里的字面量**
（`✅ D6 输出内零 ❌`、`✅ D-① 断言数 ≥ 12（累计 ✅ 13 条 / ❌ 0 条）`）⇒ **零真失败**。

关键守卫逐项：

| 守卫 / 套件 | 结果 |
|---|---|
| `m3-lexicon`（L-a~L-g） | **21/0**（我方实跑复算，非抄自述） |
| `check_suite_assert_counts`（A0 实跑 33 套件 + A2 声明≡实跑） | 41/0 |
| `check_suite_count_claims`（套件数口径） | 11/0 |
| `check_terms_forbidden`（T1b 双副本） | 13/0 ✅ 转绿 |
| `check_m2_no_cost_rate`（A-③ 双副本） | 17/0 ✅ 转绿 |
| `selftest_batch8b`（K11 双副本） | rc=0 ✅ 转绿 |
| `check_suite_coverage`（S6） | 10/0 |
| `check_page_terms`（R124） | 8/0 |
| `check_paywall_coverage`（R159） | 13/0 |
| `check_selftest_shape` / `check_wxml_structure` / `check_m3_engine_parity` | rc=0 |

---

## 3. 我方补齐 5 处

| # | 改动 | 为什么 |
|---|---|---|
| 1 | `specs/dev-specs/i18n/terms.js` ← `cp -f miniprogram/i18n/terms.js` | InsCode 守红线不改 `specs/`，新增 4 键（`matLexiconHint` / `templateFrom` / `templatePickPh` / `templateHint`）⇒ T1b/A-③/K11 三处「双副本逐字一致」预期内红。同步后 md5 全等（`306ddf24…`）⇒ 三处转绿 |
| 2 | 重启键 §1.1 套件数 `116`→`117` | 同步面（被 `check_suite_count_claims` 强制） |
| 3 | 重启键「套件数会漂」段 `现 **116**`→`117` | 同上 |
| 4 | 重启键「套件断言数口径（唯一声明处）」追加 `selftest_m3_lexicon`=21，三十二者→**三十三者**；`check_suite_assert_counts.js::CASES` 纳入该套件 | 同上（断言数下界保护） |
| 5 | 🔴 **`tools/selftest_m3_lexicon.js` L-d 判据加固** | 变异回灌 M5 实测**漏判**，见下 |

---

## 4. 变异回灌（6 条，判据＝硬：必须红在「目标断言名」上）

脚本：`mut_m320.py`（M2/M4）+ `mut_m320b.py`（M1/M3/M5/M6）。每条独立、可还原、还原后 md5 逐字节校验。

| 变异 | 手法 | 红在 | 判定 |
|---|---|---|---|
| M1 词库条目混价格键 | potato 行加 `price: 3` | `L-a` | ✅ 有效红 |
| M2 模板行混价格键 | 某行加 `price: 0` | `L-f` | ✅ 有效红 |
| M3 导出自动替换（带冒号） | `autoReplace: suggestByName` | `L-d` | ✅ 有效红 |
| **M5 导出自动替换（简写）** | `function autoReplace(){}` + 简写导出 | `L-d` | **❌ 漏判 → 已加固 → ✅** |
| M6 源码塞 `setData` | 加 `// this.setData({})` | `L-d` | ✅ 有效红 |
| M4 词库缩到 3 条 | 只留 3 条 | `L-a` `L-b` | ✅ 有效红 |

### M5 详情（本轮唯一真发现）

原判据：`/\b(auto|replace|apply|normalize)[A-Za-z0-9_]*\s*[:]/`
—— 只认 `name:` **带冒号**形式。而 JS 的**简写属性** `module.exports = { LEXICON, suggestByName, getByKey, autoReplace }` **不带冒号** ⇒ 静默漏判，rc 仍 0。

加固后：`/\b(auto|replace|apply|normalize)[A-Za-z0-9_]*\s*(?::|[,}])/`（带冒号 **或** 后跟 `,`/`}`）。
复验：M5 转 **✅ 有效红**，基线仍 **21/0 绿**（现有导出名 `LEXICON`/`suggestByName`/`getByKey` 均不以这四个前缀开头，无误杀）。

> 首次变异时我把 M3 写成**简写**形式（`autoReplaceName` 未定义）⇒ `ReferenceError` ⇒ **崩溃红**（rc=1 但零 ❌ 行）。这正是记忆里那条铁律：**只红 RC 不算数，必须红在目标断言名上**。

---

## 5. 交付内容（InsCode 实现摘要）

- `utils/materialLexicon.js`（新增）：67 条词库，每条 4 键 `{std_key, std_name, aliases, default_unit}`；导出 `LEXICON` / `suggestByName(name, limit=5)` / `getByKey(key)`；**纯读、绝不自动改写**。
- `utils/dishTemplates.js`（新增）：20 道模板 `{tpl_key, dish_name, lines:[{line_name,qty,unit}]}`；`getTemplate` / `applyTemplate`；**不预填价格**。
- 云函数：`saveMaterial/{validate,index}.js` + `getMaterial/service.js` → `std_key` 原样接收/返回（不新增错误码）。
- 前端：`pages/material/edit.*` 名称框下建议 chips（点 chip 才填）；`pages/card/edit.*` 新建态「从模板新建」picker（价格留空）。
- `tools/selftest_m3_lexicon.js`（新增 21 断言）+ `verify_all.js` SUITES 挂 `m3-lexicon`（116→117）。

---

## 6. 未覆盖 / 存疑

1. **真机端到端**：chips 展示、模板 picker 交互本地无小程序运行时，靠 R123/R124/js-syntax 覆盖，未实机验证。
2. **`std_key` 无云端校验**：设计如此（词库只在前端、不制造第二份单源），副作用是「同 std_key 不同名」的提示只能前端做。
3. ROADMAP 弱面提示 `正文 "已落地"`（不判红），本轮已顺手把 B 线序 4 标完成、序 5 改为 **M3.17 外卖单均（下一个可投喂）**。

---

## 7. 文件清单

- `gate_full.txt` / `gate_full2.txt` —— 全量门禁输出（加固前 / 加固后，均 117/117 RC=0）
- `sync_faces.py` —— 同步面补齐脚本（含回读校验）
- `mut_m320.py` / `mut_m320b.py` —— 变异回灌
- `_bak/` —— 变异前基线备份
