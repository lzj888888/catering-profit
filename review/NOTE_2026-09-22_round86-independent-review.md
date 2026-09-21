# NOTE · 2026-09-22 round86 巡检（独立复核 + 元守卫补面）

> 我方 = WorkBuddy（本会话）。本轮**不采信任何自述**（含作者同为 WorkBuddy 的并发会话与我方上一轮），
> 一切以实跑门禁 + 读源码 + 独立变异回灌为准。

## 1. 探针状态（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight=0`、`message_count=1671`（与 03:47/03:50 两采持平）、`idle_sec≈3733`、`model=deepseek-v4-flash` | **idle** ⇒ 不投喂 |
| dsh | 无标题含 `DeepSeek Harness` 的窗口 | **missing** ⇒ 不投递 |

## 2. 并发写入方判定（停手四连，全过后才动笔）

| 判据 | 结果 |
|---|---|
| ① 跨分钟 mtime 无变化 | 最新 `verify_all.js` 03:32:30，03:51 复采未变（静止 19 min）✅ |
| ② 仓内进程采样（脚本落 .py 再跑，排除自身 PID） | 03:50:19 / 03:51:36 两采 **hits=0** ✅ |
| ③ 门禁跑完后回读 mtime | 门禁 03:49–03:51 跑完，回读无变化 ✅ |
| ④ `git log` 未见新 commit | HEAD 仍 `8d40a32`（03:36）✅ |
| ⑤ tracked `M`（用 `git diff HEAD --stat`，不用 `grep "^(M|M )"` —— 坑㉘） | **0** ✅ |

⇒ 判定**无并发写入方**，本轮可写。
（`git status` 另有 1079 个未跟踪件：1058 在 `review/`、21 在仓库根、1 个 `_bak_r70/`，均为历史取证件/调试脚本，
按纪律**不 `git add -A`、不代提交、不代删**，等李老师定。）

## 3. 独立复核：4 个我方未复核的 commit

| commit | 内容 | 我方独立复核结论 |
|---|---|---|
| `80f83a1` | R85 外卖段（前端；`utils/takeaway.js` 新增 202 行 + `pages/month/input.js` +347 + `terms.js` 双副本 +67 + `tools/selftest_r85.js` 新增） | **通过**（读源码 + 5 组变异，见 §4） |
| `958959d` | R115 主题色守卫 `tools/check_theme_color.js` 落成（SUITES 88→89）+ 修 `input.wxss` 旧橘黄回流 | **通过**（7 组变异，见 §4） |
| `4dcc2c7` | 补 `gate_88_final.txt` 证据 | 纯证据件，无需复核 |
| `8d40a32` | R115 扩面 A5 深色模式退役 + **撤回 R116 误判** | **通过，且 R116 撤回经我方独立核验成立**（见 §3.1） |

### 3.1 R116 撤回：我方独立核验**成立**（不是自说自话）

并发方自述「420 份派生件零门禁覆盖」是**误判**，随后自行撤回。我方独立复核其撤回依据：

- `specs/dev-specs/prototype/check_error_codes.js:575` 确有
  `const { checkSync } = require(path.join(REPOROOT,'tools','sync_common.js'));`
- `tools/sync_common.js:149` 确有 `function checkSync()`，`:582` 会 `fails.push('[L1] ...')` ⇒ 漂移即红。

⇒ 派生件覆盖**早已由门禁 A–L 的 L1 组承担**，撤回正确，套件数保持 **89**。
**值得记一笔**：这是「新判据写了却没被跑」这一族病里，第一次由**起草方自己变异证伪并撤回**的，
说明「先证伪再登记」的纪律已经被对方内化。

## 4. 我方独立双向变异回灌（13 组 + 1 组定点复验）

脚本 `review/evidence/selfdrive_20260922_r86/_mut_r86.py`（**字节快照还原**，不用 `git checkout` —— 坑⑳）。

### R115 主题色守卫（`tools/check_theme_color.js`）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| T1 | 旧橘黄回流到 `input.wxss` 生效样式 | 红 | **红** ✅ |
| T2 | `app.wxss` 加生效 `@media (prefers-color-scheme: dark)` | 红 | **红** ✅ |
| T3 | 删 `app.wxss:75` 深色模式退役声明 | 红（fail-closed） | **红** ✅ |
| T4 | `EXTS` 缩水删掉 `.wxss` | 红（A3-③） | **红** ✅ |
| T5 | 注释里出现旧橘黄 / `prefers-color-scheme` | 绿（不误报） | **绿** ✅ |
| T6 | 页面注释里出现合法 `dark` | 绿（不误杀） | **绿** ✅ |
| T7 | 【探漏】旧橘黄的 **rgba 等价写法** `rgba(255,107,53,1)` | — | **绿 = 真漏** ⚠️ |

### r85 外卖段自测（`tools/selftest_r85.js`）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| W1 | `firstNumber` 退回截断版（≥4 位只取前 3 位） | 红 | **红** ✅ |
| W2 | `stripNonMoney` 去掉账期/日期剔除 | 红 | **红** ✅ |
| W3 | 补贴带出退回「回读旧值≠合计即加锁」误判 | 红 | **红** ✅ |
| W4 | 【探误杀】工具**注释**里合法提及平台名 | — | **红 = 真误杀** ⚠️ |
| W5 | `firstNumber` 换等价写法 | 绿（不错杀） | **绿** ✅ |
| W6 | `subsidyTotal` 去掉 `\|\|0` 兜底 | 红 | **绿 = 变异打偏**（见 §4.1） |

### 4.1 W6 的 MISMATCH：变异打偏，**不是守卫失效**（附定点复验）

`_probe_w6b.py` 实跑：

```
原实现      : sampleAsInSelftest=35.5 ; nonNumericInput=10
去掉 ||0 后 : sampleAsInSelftest=35.5 ; nonNumericInput=NaN
```

⇒ 自测样本里 `{subsidy:''}` 的 `Number('')` = **0 不是 NaN**，故我选的改动对该样本**等价**，判绿是**正确**的。
但同一次实跑也证明：差异**真实存在**（非数字输入下 10 → NaN）⇒ 自测**没覆盖这条路径**（覆盖缺口，见 §5-③）。

## 5. 本轮真发现（3 条，**全部不代修**，登记待裁决）

1. 🟡 **R115 A2 强度缺口（漏）**：判据只锁 hex 字面 `#ff6b35`（且以 `['#ff6','b35'].join('')` 拼接书写），
   等价的 `rgba(255,107,53,1)` / `#FF6B35` 之外的任何表现形式**不命中**（T7 实证）。
   与 round55 `c24e0a2`、round59 设置页开关、round58 E1 同族 —— **「变异转红」证明不了「守得住意图」**。
2. 🟡 **`selftest_r85` A13 强度缺口（误杀）**：`allSrc.includes(p)` 裸扫 `input.wxml + input.js + takeaway.js`
   **全文本含注释** ⇒ 在工具注释里合法说明「平台名一律不在此处写死」也会被判红（W4 实证）。
   坑⑭「裸扫关键词必误报」第 N 次印证。修法方向：**只扫用户可见文案**（去注释/去标签后），与 round56 同手法。
3. 🟡 **`subsidyTotal` 覆盖缺口**：`||0` 兜底只在**非数字输入**时才有意义，而 A8 样本只有 `''`（=0）
   ⇒ 该兜底**零覆盖**（§4.1 实跑为证）。掉兜底后非数字补贴会让费用侧带出 `NaN`。

> 三条均属**并发方产出**，按「不抢写」纪律只评审、不代改；是否修、怎么修由李老师/起草方定。

## 6. 本轮落地：坑⑱ 元守卫补面（`tools/check_suite_coverage.js`）

### 6.1 先更正一处**我方自己的误报**

按 `grep -ln "ls-files" tools/check_*.js` 粗扫得到 5 份「仅扫 index」，实读后
**`tools/check_waimai_spec_sync.js` 是误报** —— 它只在**注释里**写了坑⑱ 的说明，实际按固定相对路径直读、不依赖索引。
⇒ **真 INDEX-ONLY = 4 份**（与 round85 名单一致）：
`check_collection_perms.js` / `check_quota_limits.js` / `check_suite_count_claims.js` / `check_suite_coverage.js`。
（**裸扫关键词必误报**，这次误的是我自己 —— 与 §5-② 同族，如实记录。）

### 6.2 修了最该修的那一份：防复发元守卫本身

`check_suite_coverage.js` 的面 A = `git ls-files`（**只扫 index**）⇒ 未 `git add` 的新判据不在扫描面，
元守卫**暂时失明**（round70 实证：并发方写了判据却没挂 SUITES，add 之前一声不吭）。
本轮为面 A 补**工作树扫描**（只补 `tools/` `specs/dev-specs/prototype/` `cloudfunctions/**/selftest.js`，
**不补 `review/evidence/`** —— 那里躺着上千个取证件，一并补面会把每轮临时脚本都判成「未登记豁免」，反而制造误报）。

断言 8 → **10**（新增 S1-② 逐根下界、S1-③ 并集明示）。套件数**仍 89**（未新增套件）。

### 6.3 我自己踩了两次「恒真断言」，都被变异抓出（如实记录）

| 版本 | 问题 | 变异结果 |
|---|---|---|
| 首版 `S1-② … wtAdd.length >= 0` | 恒真（`>= 0` 永真） | — |
| 二版 总计下界 `wtAll.length >= 30` | 把 `tools` 根写错成 `tools_typo` 后总量 103→**55 仍过 30** ⇒ **仍恒真** | M-C **rc=0（应红却绿）** |
| 三版 逐根下界但**用 dir 字符串做键** | dir 改错时「键跟着改」⇒ 下界查不到 ⇒ 恒真 | M-Cb **rc=0（应红却绿）** |
| **终版 逐根下界 + 固定 `key`** | 下界按 `key` 取，`key` 不随 `dir` 变；`key` 在面 A 里缺失也判红 | M-Cc **rc=1 ✅** |

⇒ **与 round61「锚点命中引用行而非定义行」同族**：判据的键若与「被判对象」一起变，断言就恒真。
**定式：下界/锚点表一律用固定身份键（`key`），可变路径只作值。**

### 6.4 终版双向变异 4 组，0 异常

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| M-A | 新增未入库判据 `tools/check_zzz_probe_r86.js` | 红 | **红**（`S5 … 未挂 SUITES: tools/check_zzz_probe_r86.js`）✅ |
| M-B | 新增非判据命名 `tools/helper_zzz_r86.js` | 绿（不错杀） | **绿** ✅ |
| M-Cc | 面 A 根路径 `tools` → `tools_typo` | 红（证 S1-② 非恒真） | **红**（`低于下界：tools(0<40)`）✅ |
| clean | 还原后 | 绿 | **10 通过 / 0 失败** ✅ |

（M-A 在**修复前**会判绿 ⇒ 这次补面确实把「未入库判据失明」这个洞堵上了，不是空转。）

## 7. 队列 ①~⑤ 复验（门禁 89/89 已覆盖）

- 门禁：`node verify_all.js` → **89/89 套件通过，RC=0**（证据 `gate_baseline.txt` / `gate_final.txt`）
- `node specs/dev-specs/prototype/check_error_codes.js` → RC=0（由门禁 A–L 承担并随 89/89 通过）
- AD `selftest_ad_gates` / UI `selftest_ui_fix` 随门禁全绿
- ①A6b / ②R91 F1·F2 / ③AD G1–G8 / ⑤14 页真数据走查：**无新 commit 触及** ⇒ 维持既有闭环结论，不重跑
- ④**R86 超时值（人工面）：本轮未实测**，记**存疑** —— 按 round45/46/50 三方一致结论不再回读；
  真要判须李老师控制台手点或 `cli cloud functions info`（`cli` 单通道，本轮无并发方本可跑，但属人工面，不擅自开工）

## 8. 待办（本轮新增 / 结转）

新增：
1. 4 份仅扫 index 的守卫补工作树面 —— 本轮只修了元守卫 1 份，**余 3 份未动**（见 §6.2 的「不补 review/」约束同样适用于它们，需按各自语义选目录，属范围裁决）
2. 3 条判据/覆盖缺口（§5 ①②③）
3. **`check_suite_assert_counts.js` 的受守集合只有 6 项，不含 `suite-coverage`** ⇒ 本轮把它 8 条→10 条，该守卫一声不吭（覆盖观察，非漂移）

结转（未决）：四红线/红绿灯代码侧零实现二选一 · M3.7 配额指令二选一 · R106 `CAT` 补「小时/秒」 ·
dsh 方案 D · 建 prod 须重走 R86 定值 · 隐私政策 6 处 · 堂食渠道 5 vs 7 拉齐 · 仓库根 1000+ 取证件去留。

## 9. 回执（round86）

- [2026-09-22 03:50] R86 已落 · 证据：`probe_agents.py` → InsCode `inflight=0 / msg=1671 / idle≈3733s`、dsh `missing` ⇒ 不投喂不投递 · commit aa4197f
- [2026-09-22 03:51] R86 已落 · 证据：`_proc_scan_r86.py` 两采 03:50:19 / 03:51:36 均 `hits=0`；`verify_all.js` mtime 03:32:30 静止 19min；`git diff HEAD --stat` 空 ⇒ 停手四连通过 · commit aa4197f
- [2026-09-22 03:51] R86 已落 · 证据：`node verify_all.js` → 「总览：89/89 套件通过」RC=0（`gate_baseline.txt`）· commit aa4197f
- [2026-09-22 03:56] R86 已落 · 证据：`_mut_r86.py` 13 组双向变异 → T1-T4/W1-W3 转红、T5/T6/W5 仍绿、T7/W4 判出强度缺口、W6 变异打偏（已由 `_probe_w6b.py` 定点复验）· commit aa4197f
- [2026-09-22 03:52] R86 已落 · 证据：独立核验 R116 撤回 → `check_error_codes.js:575` require `sync_common.js::checkSync` 属实 ⇒ 派生件覆盖早由 A–L 的 L1 承担 · commit aa4197f
- [2026-09-22 04:06] R86 已落 · 证据：坑⑱ 元守卫补面 → `check_suite_coverage.js` 断言 8→10，M-A 红 / M-B 绿 / M-Cc 红 / clean 绿（4 组 0 异常），全量门禁 `gate_final.txt` 89/89 RC=0 · commit aa4197f
- [2026-09-22 04:06] R86 存疑 · ④R86 云函数超时值**本轮未实测**（人工面，须控制台手点或 cli 单通道）· 理由：按 round45/46/50 三方一致结论不再回读，且无人值守轮次不擅自动人工面 · commit aa4197f
- [2026-09-22 04:06] R86 未落 · 3 条判据/覆盖缺口（§5 ①②③）+ 余 3 份仅扫 index 守卫 · 理由：均属并发方产出或范围裁决，按「不代修 / 不代选方案」纪律登记待办 · commit aa4197f
