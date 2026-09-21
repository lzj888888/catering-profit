# NOTE · round87 自驱动巡检：坑⑱ 补面收官（3 份前轮守卫）+ 元守卫纳入断言数下界保护

- 轮次：round87（2026-09-22 05:14–05:xx，无人值守自动化）
- 探针：`probe_agents.py` → InsCode **idle**（`message_count=1671` 与 round86 持平、`idle_sec≈8737`、`inflight=0`）、
  dsh **missing** ⇒ 不投喂、不投递。
- 停手四连：① 跨分钟 mtime 静止（最新 `04:03:35`，静止 ≥72min）② 进程两采 **0-0**（`wmic` 采样，排除自身 PID）
  ③ 门禁跑完后回读 mtime 未变 ④ `git log` 未见新 commit（HEAD 仍 `56bbfaa`）⇒ **解锁写入**。
- 门禁：基线 `89/89 RC=0`；改动后 `89/89 RC=0`；`check_error_codes.js` RC=0。
- 队列复验：AD `24/24`、UI `38/38`（记忆旧值 31 已漂，以实跑为准）、R86 超时值**未实测**（人工面，记存疑）。

## 1. 本轮正事：坑⑱ 最后 3 份「仅扫 index」守卫补工作树扫描面

### 1.1 实扫名单（不采信 round85/86 自述，回源重扫）

- `grep -ln "ls-files" tools/check_*.js` ⇒ **14 份**命中；
- 与 `grep -ln "readdirSync" tools/check_*.js`（交集 10 份）做差 ⇒ 余 4 份；
- 其中 `check_waimai_spec_sync.js` **只在注释里写了坑⑱**，实现是 `fs.readFileSync(path.join(ROOT, rel))` 按固定相对路径直读，
  不依赖索引 ⇒ **排除成立**（与 round86 结论一致）；
- ⇒ 真 INDEX-ONLY = **3 份**：`check_collection_perms.js` / `check_quota_limits.js` / `check_suite_count_claims.js`。

### 1.2 改法（沿用 round86 在 `check_suite_coverage.js` 上的模板）

每份内联 `worktreeFace(idxFiles)`，补面后 `files = files.concat(wt.add)`，并加**两条前提守卫**：

| 断言 | 作用 | 为什么必须 |
|---|---|---|
| ① 逐根下界 | 补面被扫空即转红 | 只加 `concat` 不校验 ⇒ 根路径写错时补面恒空、**静默失明**（坑㉛：必须逐根下界，总计下界会放过单根写错） |
| ② 回环：index 面 ⊆ 工作树扫描集合 | 根路径写错即转红 | ① 只能防"全空"，防不了"扫到别的目录去了" |

- 下界表**键用固定 `key`、不用可变路径**（坑㉚ ⇒ 否则路径一改键跟着改，下界查不到取 0，断言恒真）。
- 下界取实测保守值：`specs` 实测 30（md）/56（全文件）取 20/30，`tools` 48 取 30，`miniprogram` 2 取 1，仓根 md 8 取 4。
- **不补 `review/evidence/`**（上千取证件会被各守卫的"不扩散/序号/额度"强面全判违规）—— 与 round86 同一取舍。
- 断言数：`check_collection_perms` 20→**22**、`check_quota_limits` 13→**15**、`check_suite_count_claims` 9→**11**。套件数仍 **89**。

### 1.3 双向变异（15 组，0 异常）— 证据 `review/evidence/selfdrive_20260922_r87/mutation_r87.txt`

每份 5 组：`BASE`(绿) / `M1 根路径写错`(红) / `M2 未入库新 md 写合法内容`(绿·不错杀) /
`M3 未入库新 md 写错误内容`(红) / **`M3b 切断 concat 再放同一错误内容`(绿·漏)**。

- **M3 红的都是预期那条断言**（逐个复现确认，不是别处误红）：
  `P9 唯一声明处不扩散` / `L5 当前态免费额陈述 ≡ 单源实算` / `C3 面内「第 N 套件」序号声明`。
- **M3b 是本轮最关键的一组**：切断补面后同一个错误探针**判绿** ⇒ 反证「补面是这三类回归的唯一抓手」，
  即这 3 份守卫此前对这些回归**零覆盖**，修复有真实收益，不是给守卫加装饰。
- 还原一律用**变异前字节快照回写**（round80 定式）⇒ 3 份文件 `[RESTORE] 字节一致 OK`，行尾全部保持 CRLF（CRLF==LF）。
- 探针文件 `specs/dev-specs/__mut_r87_probe.md` 跑完已删并 `ls` 确认零残留。

## 2. 第二件：SUITES 覆盖守卫本身纳入断言数下界保护（R107 扩面）

- 缺口来源：round86 把 `check_suite_coverage.js` 断言数 8→10，而 `check_suite_assert_counts.js` 的受守集合**不含它**
  ⇒ 元守卫自己的断言数无人校验（与第 13/15 例同族：**数字被写低 = 下界保护失效**，删一条断言静默通过）。
- 改两处（必须同步，否则 `A2` 缺 key / `A5-②` 多余 key 立刻红）：
  ① `tools/check_suite_assert_counts.js` 的 `CASES` 新增 `{ key: 'check_suite_coverage', rel: ... }`；
  ② 重启键声明行新增该项并把「八者均」改为「九者均」。
- 实跑：`17 通过 / 0 失败`；双向变异 3 组 0 异常（`mutation_r87b.txt`）：
  `M-A` 声明值 10→9 ⇒ 红；**`M-B` 短路掉元守卫的一条断言（10→9）⇒ 红**（证明下界保护对新纳入的守卫真生效）；`BASE` 绿。

## 3. 待办 / 存疑（不代修、不代裁决）

- 🟡 **R86 超时值**：人工面，本轮**未实测**（沿用 round50 三方一致结论），记**存疑**。
- 🟡 **3 条判据强度缺口**（round86 登记、属裁决项，本轮仍未动）：R115 A2 只锁 hex 字面（`rgba()` 等价写法判绿＝漏）、
  `selftest_r85` A13 裸 `includes` 扫注释（误杀）、`subsidyTotal` 的 `||0` 兜底零覆盖。
- 🟡 **UI 套件断言数 31→38**：记忆里仍写 31，实跑 38 ⇒ 声明行已由 R107 自动守住（A2 通过），无需人工跟。
- ⚠️ 工作区仓库根的 1000+ 历史取证 `.py`/PNG（`??` 未跟踪）**未代提交、未代删**，等李老师定。

## 4. 回执

- [2026-09-22 05:16] R87 已落 · 探针：`probe_agents.py` → InsCode idle（msg 1671 持平 / inflight 0）、dsh missing · commit 待填
- [2026-09-22 05:1x] R87 已落 · 停手四连：mtime≥72min 静止 + 进程两采 0-0 + 门禁后回读未变 + HEAD `56bbfaa` 无新 commit
- [2026-09-22 05:1x] R87 已落 · 门禁基线：`node verify_all.js` → 89/89 RC=0
- [2026-09-22 05:2x] R87 已落 · 实扫 INDEX-ONLY 名单：ls-files 14 份 − readdirSync 交集 10 份 − 注释型 1 份 = 3 份
- [2026-09-22 05:3x] R87 已落 · 3 份补工作树扫描面 + 6 条前提守卫：单跑 22/0、15/0、11/0
- [2026-09-22 05:3x] R87 已落 · 双向变异 15 组 0 异常（含 M3b 反证补面是唯一抓手）
- [2026-09-22 05:4x] R87 已落 · R107 纳入 SUITES 覆盖守卫（10 条）+ 双向变异 3 组 0 异常
- [2026-09-22 05:4x] R87 已落 · 门禁终值 89/89 RC=0 + `check_error_codes.js` RC=0 + AD 24/24 + UI 38/38
- [2026-09-22 05:4x] R87 存疑 · R86 超时值属人工面，本轮未实测
