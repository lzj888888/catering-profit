# NOTE · round77 自驱动巡检 —— 独立复核 round75 / round76，并抓出一处判据强度缺口

- 时间：2026-09-21 15:23–15:5x
- 角色：我方（巴迪）= 门禁与复核方。**不采信任何自述，含 round75/76 两个 commit 自带的「7/7、4/4、5/5」**。
- 证据目录：`review/evidence/selfdrive_20260921_r77/`（6 个文件，已 `ls` 回读）

## 1. 探针与并发判据（四连）

| 项 | 结果 |
|---|---|
| InsCode | `inflight=0`、`message_count=1465`（**十九连持平**）、`idle_sec≈72h`、model `deepseek-v4-flash` ⇒ **idle** |
| dsh | 窗口最小化（`rect=-32000`）；**按李老师 2026-09-21 定：暂停参与本仓，本轮不探不投递** |
| 仓内进程 | 两次采样 **0 命中**（采样脚本排除自身 PID） |
| git | HEAD `c3b4604`，**无新 commit**；`git status` 无他人 `M` |
| mtime | 门禁跑完（2 次，各 ≈100s）后回读仍静止 |

⇒ **判停手四连通过**，恢复写入。（并发方遗留的 1000+ 过程 PNG 与 `_mut_r7*.py` 等未跟踪件**不代提交、不代删**。）

## 2. 本轮真正的活：两个未经我方复核的代码 commit

上轮我方记的 HEAD 是 `be93a24`（round74），本轮开局发现已推进到 `c3b4604`。按技能 §6「每轮先比对 HEAD」定式处理：

| commit | 名义 | 实到改动面（我方实读，非采信） |
|---|---|---|
| `9ddee3e`（round74 无 pathspec 的 docs commit） | 重启键回填 | **误带** 3 个源码件：`utils/ui.js`（新增 `recentMonths(n)` 滚动窗口）、`pages/month/index.js`（月份集合改三路并集）、`tools/selftest_ui_fix.js`（修 7 段 7 条） |
| `0bd2193`（round75） | 月份下拉 + R85 | `tools/check_stale_claims.js` +12（新增「月份只有两个=设计」短语）+ 文档/证据 |
| `0973a2c`（round76） | R109 新守卫 | `tools/check_stale_status.js`（188 行）+ `verify_all.js` SUITES 81→82 + 两处文档 |

🔴 **值得记一笔的归属事实**：round75 的**源码并不在自己的 commit 里**，而是被 round74 那个**没带 pathspec** 的 commit 顺带带走
（与 round74 我方总结的「暂存区不归任何一方」是同一个病，这次是**第二次实证**，且发生在他人身上）。
⇒ 教训复用：**判「某轮的改动落没落」不能只看该轮的 commit**，要 `git log --oneline -N -- <文件>` 回查。

## 3. 独立双向变异 10 组（`_mut_r77.py`，还原用二进制快照 byte-exact）

| 组 | 变异 | 期望 | 实测 |
|---|---|---|---|
| A1 | 月份集合退回旧实现（只有已建档 ∪ 当月） | RED | ✅ RED |
| A2 | 窗口函数步长改成跳月 | RED | ✅ RED |
| A3 | 窗口长度写成 1 | RED | ✅ RED |
| A4 | **正确实现**把 `recentMonths` 改名为 `rollingMonths` | GREEN | ✅ GREEN（行为判据不绑函数名，成立） |
| **A5** | **正确实现**换写法 `[...new Set(...)]` | GREEN | ❌ **RED（MISMATCH）** |
| B1 | 活文档里裸写「月份选择只有两个月份，这是设计不是 bug」 | RED | ✅ RED |
| B2 | 同一句带「曾」引述标记 | GREEN | ✅ GREEN |
| C1 | `core/13` §6 标题退回「下一批待修」 | RED | ✅ RED |
| C2 | specs/ 新增矛盾件（标题待修 + 正文已闭环） | RED | ✅ RED |
| C3 | specs/ 新增正常待办件（无闭环词） | GREEN | ✅ GREEN |

⇒ **9/10 如期，1 组 MISMATCH**。

## 4. A5 MISMATCH 挖出的判据强度缺口（本轮正事）

round75 那条判据是：

```js
/getMonthList/.test(mj) && /const months = Array\.from\(new Set\(/.test(mj)
```

它**绑死了具体写法** `Array.from(new Set(` —— 与 round55（`c24e0a2` 绑旧 key 名）、round59（设置页开关同族）**同一个病**：
「变异能转红」只证明守卫不是死代码，**证明不了它守得住意图**。正确实现换个写法就被**误杀**。

加固为**语义三条腿**（都不认具体写法）：

1. 必须并入已建档月份（`ml.list` / `getMonthList`）；
2. 必须真的调用窗口函数（由行为识别出的 `winFn`，不绑函数名）；
3. 必须有**真去重**（`new Set(` 或 `filter/reduce + indexOf|includes`）；
4. 赋值块拿不到 ⇒ fail-closed 判红。

🆕 **加固本身也被变异证伪了一次（A8，值得记）**：首版把 `.filter(Boolean)` 也算成去重 ⇒ 正确但**不去重**的实现被放过（GREEN），
而 `filter(Boolean)` 只是去空、不是去重 ⇒ 收窄为「`new Set(` 或 `filter/reduce` 且带 `indexOf|includes`」。
⇒ **自己的加固也要双向回灌，不能因为"是我写的"就免检。**

复验 6 组（`_mut_r77b.py`）**0 异常**：A1/A7/A8/A9 红（退回旧实现 · 换 const 声明的旧实现 · 不去重 · 不调窗口）、A5/A6 绿（展开写法 · `filter+indexOf` 写法）。

## 5. 门禁与套件

- `node verify_all.js` ⇒ **82/82 套件通过，RC=0**（加固前后各跑一次，两次都是 82/82）
- `node specs/dev-specs/prototype/check_error_codes.js` ⇒ **RC=0**（A–L 十二组全绿）
- `node tools/selftest_ui_fix.js` ⇒ **38 通过 / 0 失败**（加固后未变）
- 证据：`gate_82_before_r77fix.txt` / `gate_82_after_r77fix.txt` / `gate_AL_r77.txt` / `mutation_review_r75_r76_10.txt` / `mutation_strengthen_6.txt` / `uifix_38_after_fix.txt`

## 6. 队列复核（§6，逐条实跑，不采信上轮自述）

| 项 | 状态 |
|---|---|
| ① A6b 代码层兜底 | 无新 commit，维持闭环 |
| ② R91 UI 缺陷 | `selftest_ui_fix` **38/38** 实跑通过 |
| ③ AD 适配 G1–G8 | 随门禁 82/82 通过 |
| ④ R86 超时值（人工面） | **存疑 · 本轮未实测** —— 按 round46/50 三方一致 42/42 结论不再回读；建 prod 时须重走定值与回读 |
| ⑤ 14 页真数据走查 | 无新 commit，维持闭环 |

## 7. 回执

- [2026-09-21 15:47] R77 **已落** · 证据：`node verify_all.js` → 82/82 RC=0（前/后各一次）；`_mut_r77.py` 10 组 1 MISMATCH；`_mut_r77b.py` 6 组 0 异常 · commit `2aed5ad`
- [2026-09-21 15:47] R77 **未落** · ① dsh 复审 —— 李老师 09-21 已定暂停参与本仓，本轮不投递（理由充分，非遗漏）
- [2026-09-21 15:47] R77 **未落** · ② InsCode 投喂 —— idle 72h 但 8 批已收官、无「批次 8」；队列空时**不擅自造新批次**（越权）
- [2026-09-21 15:47] R77 **未落** · ③ 坑⑱ 的 4 份前轮守卫仍只扫 index（`check_collection_perms`/`check_quota_limits`/`check_suite_count_claims`/`check_suite_coverage`）—— 连续多轮挂待办待裁决，**本轮仍未代修**（避免抢写 + 扩大改动面）
- [2026-09-21 15:47] R77 **存疑** · ④ 零守卫引用的 6 份 core 文档（`01_架构总览`/`03_写码提示词`/`11_微信审核自查清单`/`12_云开发配额与成本测算`/`开发规范v1.0_M1`/`开发规范v1.0_M3`）—— 本轮按 round67 查法实扫，未在其中找到可机械比对的过期计数陈述 ⇒ **未据以造例**，挂待办给下轮精读

## 8. 给下轮的待办

1. 上表 ④ 的 6 份零引用文档**逐个精读**找「人工陈述面 ≡ 实然」的同族病（下轮若队列仍空，这是首选面）。
2. 坑⑱ 4 份前轮守卫的扫描面扩到工作树（待李老师裁决后一次做完）。
3. 并发方遗留的 1000+ 过程 PNG、`_mut_r7*.py` 等未跟踪件 —— 只增不删，等李老师定。
4. **`9ddee3e` 这个先例要防**：任一方不带 pathspec 提交都会带走他人在途件；下轮收口仍须 `git diff --cached --stat` 先看清再提交。
