# R183 · 规范承诺守卫对账 + M3.31「每100g」缺口 · 取证

> 目录用途：为 `review/NOTE_2026-10-01_规范承诺守卫与M3.31缺口审计.md` 提供**可复现的机器证据**。
> 做法：**不动仓库任何文件**，只用脚本读源码/规范并把结论打印成可复核的输出。

## 一 本目录文件

| 文件 | 说明 |
|---|---|
| `probe_r183_gap_audit.py` | 审计探针（纯读；A~E 五段；可带仓库根作参数，默认指向本仓） |
| `probe_r183_gap_audit.out.txt` | 探针输出留档（与本次提交的工作树对应） |
| `gate_183_1.txt` | 本目录成文后、**编号纠正前**的全量门禁输出（123/123 · RC=0） |
| `gate_183_2.txt` | **编号纠正 + 路线单补「两份账单已核」之后**的全量门禁输出（123/123 · RC=0） |
| `_commit_msg.txt` / `_commit_msg_renumber.txt` | 两次提交的 message 留档 |
| `README.md` | 本文件 |

复现命令：

```bash
python review/evidence/r183_m331_gap/probe_r183_gap_audit.py
node verify_all.js          # 期望末行「总览：123/123 套件通过」· RC=0
```

### 两点笔误更正（如实登记，不改写历史）

- 本目录原名 `r182_m331_gap/` —— 🔴 **`R182` 已被 `tools/check_pack_size.js`（打包体积守卫）占用**，属**同号两名**。
  已单独提交 `2ed3077` 用 `git mv` 改回 `r183_`（引用打包守卫的那两处 `R182` **一字未动**）。教训见技能 `gate-suite-checklist` §15.1。
- 探针**初版**用过 `wouldCreateCycle`（当 R134 的针）/ `purchase_price`（当 R138 的针），**两者均 False** ——
  那是**针选错了**（不是没覆盖）。已改用真实断言名（`COMBO_NEST_NOT_ALLOWED` / `全表无价格类键`）。教训见 §15.2。

## 二 结论一：承诺的 9 条守卫，**8 条实际有覆盖**（落点文件名与规范写的不一致）

规范（v1.1 §M3.27 / v1.2 §M3.37）写下 10 个守卫**文件名**，仓库里**只有 1 个同名存在**：

```
R131  tools/check_m3_engine_parity.js                  存在
R132  tools/check_spec_derive_identity.js              不存在
R133  tools/check_takeaway_commission_base.js          不存在
R134  tools/check_combo_no_nest.js                     不存在
R135  tools/check_m3_no_m1_write.js                    不存在
R138  tools/check_template_no_price.js                 不存在
R140  tools/check_material_category_enum.js            不存在
R141  tools/check_spec_per100g_identity.js             不存在
R142  tools/check_takeaway_subsidy_split.js            不存在
R143  tools/check_commission_mode.js                   不存在
```

⚠️ **但"文件名不存在" ≠ "零覆盖"** —— 按**内容**找，6 条已在别处落地（探针 E 段逐条打印 True / False）：

| 编号 | 实际落点 | 命中的断言 |
|---|---|---|
| R132 | `tools/check_spec_derive.js` | 24 断言，含 **L5-② 键集比对** |
| R133 | `tools/selftest_m3_takeaway.js` | `T-a 基数不含打包费（商品总价 2500 而非含打包费的 2700）` |
| R134 | `tools/selftest_m3_combo.js` | `A-c 套餐引用套餐 ⇒ COMBO_NEST_NOT_ALLOWED` |
| R138 | `tools/selftest_m3_lexicon.js` | `L-f 全表无价格类键` / `L-g 返回行不含 price/unit_cost/cost 键` |
| R140 | `tools/check_dish_category_free.js` | L4 段（文件头明写「R140 把守」） |
| R142 / R143 | `tools/selftest_m3_takeaway.js` | `T-f 承担方未选 ⇒ 不计入` / `T-d fixed 模式下保底 min 不生效` |

**另有 2 条确有缺口**：

- **R135**（M3 云函数不得写 M1 集合）：**无**。现只有 `selftest_m3_takeaway.js` 的 `T-g 输出对象不含任何 M1 月度字段` ——
  管的是**派生层出参形状**，**不是云函数层的写库面**。探针 E 段最后一行以 `tools/` 下搜 M1 集合名**零命中**作反证。
- **R141**（`per100g` 系数全 1）：**无从挂** —— 被测对象不存在（见下）。

## 三 结论二：M3.31「每100g」计价 —— 定案「做」，实际零代码

探针 B / C / D 三段给出的事实：

| 检查 | 结果 |
|---|---|
| 服务端 `SPEC_PRESETS` 的 `spec_key` | `['half', 'small']` —— **无 `per100g`** |
| 前端 `miniprogram/i18n/terms.js::specLabel` | `{ half: '半份', small: '小份' }` —— 同上 |
| 前端副本 `specs/dev-specs/i18n/terms.js` | 与上者 **md5 相同**（`47e8f67852d5b67d1fdeb40c51324ca4`，均 80286 B） |
| 全仓 `.js` 里 `per100g` | **0 命中** |
| 全仓 `.js` 里 `commission_base` | **0 命中**（佣金基数规则以 `goodsTotalFen` 参数实现，规范里的这个字段名只是**描述用**） |

判定依据（完整论证见审计件 §2.3）：`review/PLAN_2026-09-26_M3整体搭建方案_按入口反推.md` 的同一张缺口表里，
`combo` / `specs_json` / `s_user·s_merchant` 三项后来都补上了，**只有 `per100g` 被落下**，且 `review/` 下**没有任何"延后/不做"的登记**。

## 四 本目录**不**包含什么（如实标注）

- **不含**任何部署、写库、改配置的动作记录（本目录全部是读取类探针的输出）。
- **不含**真云验证：本对账只在**仓内静态判据**层面成立，未在真云上复核这些守卫的实际拦截效果。
- **不含** R135 的修复方案 —— 它需要先定"哪些算 M3 云函数"的稳定清单，本轮只登记、不擅定。
