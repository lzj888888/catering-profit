# NOTE · 2026-09-23 round110 仓库卫生整理 + 三重备份（李老师指令）

> **快照时刻**：2026-09-23 19:0x（GMT+8）
> **现状（已落）**：commit `d20eab2`（整理）+ `df1eac5`（补漏项）已推 `dev`；门禁 **99/99 RC=0**；工作区**完全干净**
> **触发**：李老师「在保证数据安全、不会丢失现在已经搭建的小程序的情况下，你处理这些吧，一定要保证不丢上下文、不丢已经做好的数据，该备份备份」
> **执行**：WorkBuddy（巴迪）

---

## §0 一句话结论

**先备份、再动手，且全程零删除。** 1103 条悬挂项 → 0；实际只做两件事：
① 把一条**早已存在的决定**（r86 过程截图不入仓库）从「靠人记得」变成 `.gitignore` 机械保证；
② 把 72 条**历史留证**（回灌脚本 / 门禁输出 / 变异备份）**纳管入库**（此前只在本机、随磁盘风险）。
**一字节未删、一文件未改名、一文件未移动。**

---

## §1 备份：三重，且在动手之前

| # | 形态 | 位置 | 体量 | 自证 |
|---|---|---|---|---|
| ① | **原始形态 zip**（整理**前** 1950 文件） | `<Claw>\<b>_archive</b>\catering-profit_review_backup_2026-09-23_r110.zip` | 104.97 MB | **CRC 全通过** + 解压体积逐字节一致（126.36 MB）+ 5 件 md5 抽验一致 |
| ② | **清单**（每文件字节数 + 归档路径） | 同目录 `.list.txt` | 0.13 MB | 1950 行 |
| ③ | **全仓 git bundle**（完整历史，可独立克隆） | 同目录 `.bundle` | 24.57 MB | `git bundle verify` → "The bundle records a **complete history**"，8 refs（dev/main/origin·dev/4 tags/HEAD） |

> **备份绝对路径**（R77：引用必须可解析）
> `C:\Users\lzj\WorkBuddy\Claw\_archive\` ← ⚠️ **仓库同级、不在仓内**（所以不会被任何仓内操作波及）
> **不含**：`.git/` 已被 bundle 覆盖；已跟踪文件的当前内容由 git + GitHub 承载。

**顺序纪律**：zip 先落地并自证 → 才做第一个整理动作。任一环节出问题，zip 就是回退源。

---

## §2 做了什么（动作 A：r86 过程截图 → 机械排除）

### 依据不是我的判断，是**已入库的历史决定**

`review/evidence/r86_timeout_20260919/README.md`（**已跟踪**）第 30 行原话：

> （过程调试截图 1033 张留在工作区 `_gui/`，**不入仓库**。）

**旁证**（证明这不是"事后追认"）：`review/evidence/selfdrive_20260919_r44/concurrency_samples.txt:6` 里
早已记着 `?? review/evidence/r86_timeout_20260919/` —— 该批次**自 round44 起一直是未跟踪**。

### 问题：决定只在说明文字里，**没有任何机制保证**

⇒ 任何人都可能在一次 `git add -A` 里误把它们（86 MB）灌进仓库。本轮把它机械化：

```
/review/evidence/r86_timeout_20260919/*.png
!/review/evidence/r86_timeout_20260919/evidence_*.png
```

**双向实证**（不是推断）：

| 样本 | 期望 | 实测（`git check-ignore -v`） |
|---|---|---|
| `adv_adminInit_1_0.png` | 排除 | 命中 `.gitignore:25` ✅ |
| `vp_saveAsset_1_1.png.crop.png` | 排除 | 命中 `.gitignore:25` ✅ |
| `filt_x_1_0.png` | 排除 | 命中 `.gitignore:25` ✅ |
| `evidence_新判据_模拟.png`（反排除腿） | **不**排除 | 命中 `.gitignore:26`（`!` 规则）✅ |

**为什么反排除行是必要的**：该目录 1036 张 png 中，未跟踪的 1033 张命名族为
`adv_/back_/cfg_/chk_/dlg_/filt_/ide_/manual_/reset_/search*/test_/typed_/vp_`，
**无一张**以 `evidence_` 开头；而**已入库的 3 张判据截图全部**是 `evidence_` 开头。
⇒ 排 `*.png` + 反排除 `evidence_*.png` = 零误伤，且**将来新增的判据截图仍会被纳入**。

### 零副作用的证明

- **零移动 / 零改名 / 零删除**：1033 张**仍在磁盘原位**（只是不再出现在 `git status` 里），且**已进 ① 号 zip**。
- `concurrency_samples.txt` 等历史快照里记的旧路径**依然解析得到**（文件没动）。
- 已入库的核心证据（README + 3 张判据截图 + `ground_truth_42.json` 等）**不受影响** —— gitignore 只作用于未跟踪件。

---

## §3 做了什么（动作 B：历史留证纳管 72 条 / ~1.2 MB）

| 面 | 条数 | 说明 |
|---|---|---|
| 仓根一次性脚本 | 21 | `_mut_r7*.py` / `_proc_scan_*` / `_scan_*` / `_restore_r72.js` / `_tmp_commit_*` |
| `_bak_r70/` | 6 | 变异回灌前的原文件备份（`MUT_VA` 等） |
| `review/evidence/` 散落判据证据 | 42 | 门禁输出 txt（`gate_*.txt` / `verify_all.txt`）+ 回灌脚本 py |
| `review/_write_note_r81.py` | 1 | round81 写笔记脚本（**补漏**，见 §4） |
| `.gitignore` | 1 | 动作 A 的规则 |
| **合计** | **71 + 1** | 零 PNG、零 >200 KB |

**为什么纳管是对的**：重启键 §3 有 **3 处**把它们当回灌证据引用
（`:509 _mut_r72.py` / `:538 _mut_r73.py` / `:634 _mut_r74b.py`）——
**被引用的证据只存在本机磁盘上**，是真实的丢失风险（本仓已有前例：2026-09-13「只落盘未入库 → 跨回合文件消失」）。

### 动手前先排掉一个真实风险

仓根 `_restore_r72.js`（.js）纳管后会不会被 **R122**（`tools/check_js_syntax.js`）判红？

- 读判据 ⇒ R122 用 **`fs.readdirSync` 遍历文件系统**（第 61-78 行），**不是 `git ls-files`**
  ⇒ 该文件**此前已在扫描面内**，纳管**不改变任何判据**。
- 预编译：`node --check _restore_r72.js` → **通过**。

---

## §4 过程中的两次自查（都如实记账）

### 4.1 漏项：git pathspec 不跨目录匹配

首条提交 `d20eab2` 用的 pathspec 是 `_*.py`，我**以为**它会匹配任意层级。
**实测只收了仓根 21 个**，漏了 `review/_write_note_r81.py`。

> **根因**：git pathspec 不含 `/` 时，按 **FNM_PATHNAME** 语义对「相对路径**整串**」匹配，
> 星号**吃不到斜杠** ⇒ `_*.py` 匹配不到 `review/_write_note_r81.py`。

⇒ 补提交 `df1eac5`（1 file / 148 insertions）。

### 4.2 一个**看起来像并发写入**的假警报（已排除）

补提交前发现 `review/_write_note_r81.py` 是 `??`，而它在**备份时点的统计里没出现过**
⇒ 一度疑为并发方写入。**回源证伪**：

- 该文件 **就在本轮备份 zip 内**，`zip 内 md5 7a782a05…` **≡** `磁盘 md5`（逐字节一致）；
- `mtime` / `ctime` **均为 `2026-09-21`**（round81 当轮），不是刚创建；
- 我此前的统计用了 `byTop` **前两级聚合 + `slice(0,20)`** ⇒ 而「数量=1」的项有 28 个，
  **被截断在后 8 项里**，所以它没出现在那张表上。

⇒ **非并发**，是我自己的统计口径截断。此条一并作为「**统计输出被 slice 截断 ≠ 事实不存在**」的实例记录。

### 4.3 提交信息被 shell 吃掉三处（已 amend 修正）

`df1eac5` 首版 message 里写了反引号包围的 `_*.py` / `/` / `*`。
`node -e "…"` 的**双引号内反引号在 bash 中仍触发命令替换**
⇒ 三处被替换成空串（stderr 留证：`bash: _fix_r77.py: command not found`）。

⇒ 改用 `git commit --amend -F <文件>`（**绕开 shell**），并以
`--force-with-lease=refs/heads/dev:<旧sha>` 强推（**先核实远端现值 == expect 才推**，脚本内有此门）。
`76a79b3 → df1eac5`，**`git diff 76a79b3 HEAD --stat` 为空**（树逐字节一致，仅 message 变）。

> 与既有坑「`node execSync` 走 cmd 吞 `^`」**同族**：shell 元字符。
> 定式：**凡 message / 正则 / 路径含 shell 元字符 ⇒ 写文件 + `-F` / 读文件，别塞进 `-e "…"`。**

---

## §5 判据（可复现）

| # | 判据 | 命令 | 期望 |
|---|---|---|---|
| 1 | 门禁全绿 | `node verify_all.js` | `99/99` + `RC=0`（证据 `review/evidence/gate_99_r110_hygiene.txt`） |
| 2 | 套件已入库 | 门禁 `[suite-tracked]` | `99 个套件文件全部已入库` |
| 3 | 工作区干净 | `git status --porcelain -uall` | **0 行** |
| 4 | 未跟踪降噪 | 同上（整理前） | 1103 → **0** |
| 5 | 备份完整 | zip `testzip()` + 体积和 | CRC 无坏、126.36 MB 一致 |
| 6 | bundle 完整 | `git bundle verify <f>` | `complete history` |
| 7 | 已推 | `git ls-remote origin refs/heads/dev` == `git rev-parse HEAD` | `df1eac5…` 两侧一致 |

---

## §6 明确**没做**的事（留待李老师定）

| 项 | 为什么没做 |
|---|---|
| **不把 1033 张过程截图移走 / 删除** | 老证据「留在工作区 `_gui/`」是**当时的决定**，我没有权限替历史改归档位置；且移动会打断 1076 处历史文本对这些路径的引用。⇒ 只做**排除**，不动文件 |
| **仓根 21 个 `_*` 脚本未归档进 `tools/`** | `review/README §1` 确有「测试脚本一律放 `tools/`」的约定，但那会**改变路径** ⇒ 触及重启键 §3 那 3 处引用的可解析性（R77）。本轮以**零风险**为优先，只纳管不搬。建议下轮单独评估 |
| **不清理 `review/evidence/` 的历史大文件** | 用户要求「不丢数据」⇒ 一律保留。若将来要瘦身 git 历史，须走 `git filter-repo` 类操作，**不在本轮授权范围** |
| **未压缩工作区 `MEMORY.md`（4982 > 3000 字符）** | 见 §7 |

## §7 待办（下一轮）

- 🔴 **工作区 `MEMORY.md` 超限**：`C:\Users\lzj\WorkBuddy\2026-09-08-22-08-11\.workbuddy\memory\MEMORY.md`
  实测 **4982 字符**（上限 3000，**非本轮造成**，编辑前已约 4.5k）⇒ 需一次**下沉压缩**：
  细则搬 `PITFALLS.md`，`MEMORY.md` 只留「索引 + 红线」。
- 🟡 仓根 21 个 `_*` 脚本是否归档进 `tools/mutations/`（需同步重启键 3 处引用）。
- 🟡 `.gitignore` 是否再收紧：**根目录一次性脚本**（`/_*.py` 之类）—— 但会与"纳管历史留证"冲突，需先定策。

---

## §8 给复审方的可核点

1. `.gitignore:17-26` 的规则与注释（尤其**反排除腿**的理由是否成立：需核"未跟踪 1033 张无 `evidence_` 前缀"）。
2. `review/evidence/r86_timeout_20260919/README.md:30` 是否真如本节引述（**逐字**）。
3. `git show d20eab2 --stat` / `git show df1eac5 --stat` 的实际改动面。
4. `git diff 76a79b3 df1eac5 --stat` 应为**空**（证明 amend 未动树）。
5. 备份三件的实际存在与自证（路径在 §1，**不在仓内**，需按绝对路径直读）。
6. **反向核**：`git status --porcelain -uall` 应仅 0 行；若复审方看到 1033 条 `??` 回来，
   说明 `.gitignore` 未生效（前提件：`core.excludesfile` 未被覆盖）。
