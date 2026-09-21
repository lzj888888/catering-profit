# round79 · 自驱动巡检 + 防回潮扫描（2026-09-21 19:33–20:0x）

## 0. 一句话结论

**两个外部代理都无活**（InsCode idle、dsh 窗口缺失）⇒ 不投喂不投递；**无并发写入方**（停手四连通过）。
门禁 **83/83 RC=0** + A–L RC=0 + UI **38/38** + AD **24/24**，队列 §6 ①~⑤ 逐项复验**仍全部闭环**。
队列空 ⇒ 本轮做**防回潮扫描**：**证伪 5 个疑似分叉**（均非漂移），**发现 1 处真实冲突**
（写码基线 M3.7 的配额实现指令与权威单源不一致）⇒ **按"不代选方案"原则只登记为待裁决，未代修**。

---

## 1. 探针（唯一入口，非采信自述）

`probe_agents.py` → `inscode.verdict=idle`（`inflight=0`、`message_count=1465` **二十一连持平**、`idle_sec≈275226`≈76.5h）、
`dsh.verdict=missing`（无标题含 `DeepSeek Harness` 的窗口）。

⇒ 按技能 §2 决策表：InsCode idle 且**无未审产出** ⇒ 不投喂；dsh 缺失（且李老师 09-21 已定暂停参与本仓）⇒ 不投递。

## 2. 并发写入方判定（停手四连，缺一不可）

| 判据 | 结果 |
|---|---|
| ① 跨分钟 mtime | `terms.js` 18:22:56、`verify_all.js` 18:12:31（均为 round78 我方自改），19:35 与 19:38 两次采样**无变化** |
| ② 进程采样（.py 文件跑 + 排除自身 PID） | 19:35:51 `CONCURRENT_HITS 0`；19:38:35 `CONCURRENT_HITS 0` |
| ③ 门禁跑完回读 mtime | 门禁 1m29s 跑完（19:37:58）后 `stat` 复核，**仍无变化** |
| ④ `git log` 无新 commit | HEAD `800bd93` ≡ round78 收口 commit |

`git status`：tracked `M` **0**、staged **0**（1061 个 `??` 全为历史过程件：r86 PNG / 我方 round60-78 的 `_mut_*`·`_proc_scan_*` 脚本）。

⇒ **恢复写入**（前两轮曾因并发方降级只读）。

## 3. 门禁与队列复验（实跑，非采信自述）

| 项 | 命令 | 结果 |
|---|---|---|
| 主门禁 | `node verify_all.js` | **83/83 套件通过**，RC=0 |
| A–L | `node specs/dev-specs/prototype/check_error_codes.js` | RC=0 |
| R91 UI | `node tools/selftest_ui_fix.js` | **38 通过 / 0 失败** |
| AD G1–G8 | `node tools/selftest_ad_gates.js` | **24 通过 / 0 失败** |

队列 §6 逐项：①A6b / ④R86 / ⑤14 页走查 —— **无新 commit ⇒ 维持 round78 结论，不重跑**
（④R86 按 round50 三方一致结论**不再回读**，本轮**未实测**，记**存疑**）；②R91 / ③AD 由上面两组实跑复验通过。

## 4. 防回潮扫描（本轮正事）

方法沿用 round67 教训：**先数「每份 spec 文档被 `tools/` + `prototype/` 引用的次数」，零引用者优先扫**。

### 4.1 🔴 扫描面自查（本轮先踩到，先记）

首轮只扫了 `specs/dev-specs/core/` + `specs/dev-specs/*.md` ⇒ **漏掉 `specs/` 根目录的 `PRODUCT_PLAN.md`**（它同样是 0 引用）。
扩到 `find specs -name "*.md"`（30 份）后才是完整面。与 round56「判据扫错了层」/ round61「CJK 被静默跳过」同族：**扫窄 = 零覆盖**。

完整 0 引用清单（7 份）：`11_微信审核自查清单`、`BRANCH_STRATEGY`、`PRODUCT_PLAN`、
`开发规范v1.0_ModuleM1_月度盈利核算`、`开发规范v1.0_ModuleM3_菜品成本卡`、`OBSOLETE_商业化方案_v1.1_融合版`（已声明作废）。

### 4.2 证伪（5 个疑似分叉，实读后判定**不是漂移**）

| # | 疑似点 | 实读/实算判据 | 结论 |
|---|---|---|---|
| 1 | `PRODUCT_PLAN:110-112` 警戒线「人工占比 18–25% / >25% 预警」vs 开发规范 M1.6 四红线「人工 ≤20%」 | `PRODUCT_PLAN:109` 自写「**警戒线（监控用，区别于 PRD 的"4 红线诊断"）**」 | **两份不同清单，自述已区分** ⇒ 非漂移（同 round73「硬红线 6 vs 勾选 11」） |
| 2 | 开发规范 M3.7 标题「15 项」 | 表格实算 **15 行**，序号 1–15 连续 | 一致 |
| 3 | 开发规范 M3 §3.11.6「S3 全部 8 项」 | 复选框实算 **8 条** | 一致 |
| 4 | M3.12 Schema 表名是否都在建库单源 | `shop_material` / `shop_cost_card` / `shop_cost_card_line` 逐个 `COLLECTIONS.includes()` ⇒ **全部 IN**（单源实算 25） | 一致 |
| 5 | 费用字典是否也像收入那样前后端分叉（round78 第 16 例的对称面） | 前端 `terms.js::...expense` = 运营 7 / 人工 5 / 营销 6 / 其他 2 = **20**；后端 `SEED_EXPENSE_ITEMS` = 运营 7 / 人工 5 / 营销 6 / 其他 2 = **20**，名称逐个比对一致 | **无分叉**（分叉只发生在收入侧） |

另：`core/09_统一错误码表` 文档 32 行 ≡ `common/errors.js::ERROR_CODES` 实算 **32**（已有 `check_requires.js` / `selftest_batch8c.js` 引用）；
集合 25 / 索引 40 由 R74 `check_schema_sync` S4 守。均非缺口。

### 4.3 🟡 真实发现（1 处）—— 已登记待裁决，**未代修**

写码基线 `开发规范v1.0_ModuleM3_菜品成本卡.md` §M3.7「配额限制」立了一条铁律：

> 上限数值**禁硬编码进业务逻辑，必须读 `subscription_plan`**；……按 `card_id` 去重

而权威实现 `cloudfunctions/checkQuota/service.js` 把额度以常量定义在 Service 层（`FREE_LIMIT` / `HARD_LIMIT`），
**不读任何配置集合**；建库单源 `collections.js` 的 `subscription_plan` 种子**没有任何额度类字段**
（只有 plan_id / name / price / days / type / enabled / sort），去重用的是 `card_code`。

⇒ 基线的「必须读 `subscription_plan`」在**当前数据模型下不可执行**；「按 `card_id` 去重」与实现字段不同名。

- **是否已有错误数据**：**没有**。额度计数由 `check_quota_limits.js`（R102）守在 `checkQuota` 常量上，
  任一侧单方面改动都会当场判红 ⇒ **不会静默算错**。真实代价 = **写码方照基线改造时白费一轮并与守卫对撞**。
- **为何不代修**：「保留常量、只改基线措辞」vs「给 `subscription_plan` 加额度字段并改造 `checkQuota`」
  属**口径裁决**；按团队约定（禁止代选方案）只拆解罗列，等李老师二选一。
- **落位**：已作为 `🟡 待裁决` 一节写入 `core/13_上线前查缺补漏_决策与待办总览.md`（与 round78 的渠道字典分歧同页同形态）。

## 5. 自伤 / 坑位

- 本轮**未跑变异**（没有新增判据，无需回灌）⇒ 未触发坑⑨⑩⑰⑳等行尾类问题。
- Edit 后已核行尾：`core/13` **CRLF 275 / LF 275**（相等）⇒ 未触发坑⑰。
- 门禁与套件输出**全部落 `review/evidence/selfdrive_20260921_r79/`**，未落仓库根 ⇒ 未触发坑㉔。

## 6. 回执

- [2026-09-21 20:0x] R79 已落 · 证据：`probe_agents.py` → InsCode idle(msg 1465 二十一连)/dsh missing；
  `node verify_all.js` → 83/83 RC=0；`check_error_codes.js` → RC=0；`selftest_ui_fix.js` → 38/38；
  `selftest_ad_gates.js` → 24/24；停手四连全过 · commit <本件 sha>
- [2026-09-21 20:0x] R79 **未落** · ②R86 超时值：按 round50 三方一致结论不再回读，**本轮未实测** ⇒ 记**存疑**（人工面）
- [2026-09-21 20:0x] R79 **未代修** · M3.7 配额指令冲突：属口径裁决，已登记 `core/13` 待李老师二选一
