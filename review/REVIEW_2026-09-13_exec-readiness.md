# 复审结论 · 2026-09-13 · 主题：执行前就绪核验（R1–R7 关闭 + 执行缺口）

> 取件规则：取 `review/` 下 **mtime 最新**的 `REVIEW_*.md`。上一份：`REVIEW_2026-09-13_r4-verify.md`（勿改其正文）。

---

## 0. 核验基线（复审方实测）

| 项 | 实测 |
|---|---|
| HEAD | `d0b175b`（`docs: 新增《新手上云操作手册》纯小白版(md/docx/txt, 6页已打印) + tools/md2docx_portrait.py`） |
| git status | **空** ✅ |
| 门禁 A–L / `sync --check` | 全 `exit 0` ✅ |
| R1–R7 | **全部关闭** ✅（R5 内容逐字忠实 + 五条验收 grep 与我独立跑出的 `2/3/2/1/1` 完全一致；`f0c626f` = `207 insertions(+), 0 deletions(-)` 纯追加） |

**R6 已见效**：上一轮回执写的是描述（"已新增含①②③④"），本轮写的是 `grep -c → 2/3/2/1/1`（真实输出），**且与复审方独立结果一致** ⇒ 同作者同事项，格式一换即可对账。

---

## 1. 待办（**执行前必须处理 R8/R9**）

### 🔴 R8 — `新手上云操作手册.md` 缺「A7 索引清单核对」步骤

用 mtime 与 grep 双向确认：手册的「5.2 核对数据库」(`:119-122`) 只有 **25 集合数 + 权限设置**，**没有索引核对**；全文件 `索引` 仅 `:165` 出现一次（在「常见报错速查」里，属**被动**提示，不是执行步骤）。

**后果**：用户按手册走完 ①–⑥，**A7 无答案** —— 而 A7 是探针四大前提之一，且决定 A6（首建档非原子）是「偶发失败一次」还是「可能重复账号」。

**修法**：在手册 `:123`（5.2 之后、5.3 之前）插入：

```markdown
### 5.2b 核对索引清单（答 A7 —— **别跳过这步**）
- 控制台 →「**数据库**」→ 逐张集合 →「**索引**」。
- 重点核对 `cloudfunctions/initDb/collections.js` 里声明的 **9 个 unique（唯一）索引**是否都建上了：
  `user.openid` / `user.user_id` / `shop_entitlement.user_id` / `shop_monthly_account.(shop_id,month)` /
  `shop_cost_card.card_code` / `shop_switch.(shop_id,switch_key)` / `admin_user.username` /
  `shop_payment_flow.order_no` / `order_refund.order_id`
- **全部都在** → A7 成立（`createIndex` 可用），A6 风险低。
- **有缺失** → 截图发我：A7 判定为「`createIndex` 不可用」，索引须控制台手工建，
  且 A6 **升级**为「可能产生重复账号」（需给首建档加 unique 冲突重试）。
```

**验收**：`grep -c "5.2b" 新手上云操作手册.md → 1`；`grep -c "unique" 新手上云操作手册.md → ≥2`

---

### 🔴 R9 — Runbook 三份派生件**落后**于 `.md`，且**没有守卫**

用 **mtime**（不靠 grep —— `.docx` 是 ZIP、`.pdf` 是压缩流，grep 对它们无效）：

```
SMOKETEST_RUNBOOK.md    17:17  16765B   ← 唯一源（含步骤 0.1）
SMOKETEST_RUNBOOK.txt   11:42  14220B   ← 落后 5.5h，缺整个步骤 0.1
SMOKETEST_RUNBOOK.docx  11:41  47206B   ← 落后
SMOKETEST_RUNBOOK.pdf   10:13  398883B  ← 落后 7h（打印版！）
```
`.txt` 另经内容确认：`grep -c 步骤\ 0.1 → 0`、`grep -c touristappid → 0` ⇒ **确系旧版**。

**后果**：若照着**打印版/文本版**执行，会漏掉步骤 0.1 全部四项（真实 AppID 硬前置／25 集合权限／seedDemo／**A7 索引核对**）。这正是 D4/D7 那一类「改 MD 忘重跑生成器」。

**修法**
1. `.md` 若有任何改动 → **重跑生成器**再生 `.txt` / `.docx`；**重新打印**（若打印件用于操作）。
2. **加守卫（结构修复，别只修这一份）**：本仓已为 `delivery/` 派生链建了 K 组、为 `terms.js` 双副本建了 K11、为 `common/` 副本建了 L 组 —— **Runbook 的 docx/txt 目前无人守**。建议在 K 组或 `verify_all.js` 增一条：
   `SMOKETEST_RUNBOOK.txt`（CRLF 归一）≡ `SMOKETEST_RUNBOOK.md`，不一致即 fail。
   `新手上云操作手册.txt` 同理。**优先守 `.txt`**（可逐字比对）；`.docx` 是二进制，退而记录生成时间或直接不守。

**验收**：`SMOKETEST_RUNBOOK.txt` 的 mtime **晚于** `.md`；`grep -c touristappid SMOKETEST_RUNBOOK.txt → ≥1`

---

### 🟡 R10 — 两份"上云操作"文档并存，**未声明主从**

`SMOKETEST_RUNBOOK.md`（203 行，权威流程）与 `新手上云操作手册.md`（182 行，小白版）**都描述同一件事**，且**各自都没声明与对方的关系**（grep `唯一源|权威|本手册` → 无主从声明）。这正是本项目反复吃亏的「同一事实写两遍」——两份会各自漂移（R8/R9 就是证据）。

**修法**：两侧各加一行声明
- `SMOKETEST_RUNBOOK.md` 头部（`:6` 附近）：
```markdown
> 本文件是【**权威操作流程**】。`新手上云操作手册.md` 是同一流程的**小白友好版**（面向没用过开发者工具的人）；
> 两者若冲突，**以本文件为准**。
```
- `新手上云操作手册.md` 头部（`:5` 附近）：
```markdown
> 本手册是 `SMOKETEST_RUNBOOK.md` 的**小白友好改编版**；两者若冲突，**以 SMOKETEST_RUNBOOK.md 为准**（权威流程）。
```

**验收**：两份文件各 `grep -c "权威" → ≥1`

---

### 🟡 R11 — `步骤 5` 判读表缺 2 行（探针实际返回 9 个字段，表里只列 7）

探针权威字段（`index.js` 的 `out` 初始化 + 赋值）：`env` / `requireCommon` / `createCollection` / `createIndex` / `docGet` / `docGetMissing` / `uniqueEnforce` / `assertShopOwner` / **`dataAdapterGet`**。
判读表（`:85-94`）**缺 `createCollection` 与 `dataAdapterGet`** —— 后者正是 R3 专为**直验 A2** 加的字段。漏在表外 ⇒ 用户可能只回报表里的字段，**A2 的真云验证丢失**。

**修法**：在 `:94` 之后补两行
```markdown
| `createCollection` | `{ok:true}`，或 `ok:false` 且 msg 含「已存在」 | 其余 msg → 建集合失败，先修环境/权限再重跑 |
| `dataAdapterGet` | `liveIsDoc:true` **且** `deadIsNull:true` | `deadIsNull:false` → **A2 在真 SDK 上不成立，须回退**；`THROW` → adapter 契约待议 |
```

**验收**：`grep -c dataAdapterGet SMOKETEST_RUNBOOK.md → ≥2`

---

### 🔵 R12 — 手册补 2 项（低优先，可与 R8 同批）

1. **`__probe` 清理**（Runbook 步骤 8 有、手册无）：探针跑完 → 控制台 → 数据库 → 删 `__probe` 集合（SDK 不能 drop，只能手工）。
2. **seedDemo 来源**（Runbook 0.1.3 有、手册无）：仓库无 `cloudfunctions/seedDemo/`，三选一（手工包／某批生成／本阶段不灌），**严禁 prod**。

---

## 2. 复审方能力边界（不变）

- `verify_all.js` 端到端跑不了（`spawn+pipe = EPERM(-4048)`；`stdio:'inherit'` 可）→ 只验聚合逻辑（fail-closed）。
- 远端 push 核不了（SSH `Win32 error 5` / HTTPS `SEC_E_NO_CREDENTIALS`）→「已推 dev」记为推送方回显确认。
- 云端四前提（A6/A7/`require('./common')`/`doc().get()`）须靠 `smokeTest` 探针作答。
- 沙箱 git 读回不可信（`git -C`/`git show HEAD:path`/`git cat-file`）→ 「存在/相等」一律用非 git 方法交叉验证。
- **新增（2026-09-13）**：`Get-Content | Measure-Object` 数行数**不可信**（对同一文件数出 65，node 数出 102）→ **行数/内容一律以 `node` 为准**。

---

## 3. 执行回执（**WorkBuddy 只追加，勿改上文**）

<!--
追加格式：- [YYYY-MM-DD HH:MM] R<n> 已落/未落/存疑 · 证据：<命令> → <真实输出> · commit <sha>
⚠️ 证据必须是命令 + 真实输出（见 README §2），不要只写描述。
-->

- [ ] R8 手册补「5.2b A7 索引清单核对」        —— 待执行
- [ ] R9 重生 Runbook 派生件 + 加派生件守卫      —— 待执行
- [ ] R10 两份文档互相声明主从                  —— 待执行
- [ ] R11 判读表补 `dataAdapterGet`/`createCollection` —— 待执行
- [ ] R12 手册补 `__probe` 清理 + seedDemo 决定  —— 待执行

<!-- ===== WorkBuddy 执行回执（2026-09-13 19:44）===== -->
- [2026-09-13 19:44] R8 已落 · 证据：`grep -c "5.2b" 新手上云操作手册.md → 1`；`grep -c "unique" 新手上云操作手册.md → 2`（手册 5.2 后新增 5.2b「核对索引清单（答 A7）」：9 个 unique 索引清单 + 两分支判读）· commit 5c92ee6
- [2026-09-13 19:44] R9 已落 · 证据：`ls --time-style=full-iso` SMOKETEST_RUNBOOK.md=19:28:10 → .txt=19:43:05（**.txt 晚于 .md**）；`grep -c "touristappid" SMOKETEST_RUNBOOK.txt → 2`（旧版为 0，确系重生非旧版）。门禁 K 组新增 **K12/K13**（Runbook/手册 的 .txt ≡ .md，剥 BOM+CRLF 归一，与 K11/L 同构；仓库根文档本不在 A–K 其余扫描面内）。**变异验证（同序列）**：`printf DRIFT >> 手册.txt` → gate `exit=1` 且点名 `[K13] …不一致（派生件落后）`；同序列还原后 `exit=0`（✅全部断言通过），`grep -c DRIFT-INJECTED → 0` · commit 5c92ee6
- [2026-09-13 19:44] R10 已落 · 证据：`grep -c "权威" SMOKETEST_RUNBOOK.md → 2`；`grep -c "权威" 新手上云操作手册.md → 1`（两侧各加主从声明：Runbook=权威流程、手册=小白友好改编版，冲突以 Runbook 为准）· commit 5c92ee6
- [2026-09-13 19:44] R11 已落 · 证据：`grep -c "dataAdapterGet" SMOKETEST_RUNBOOK.md → 2`（判读表补 `createCollection` + `dataAdapterGet` 两行；附录补 ⑥ dataAdapterGet 直验 A2 软删分支）· commit 5c92ee6
- [2026-09-13 19:44] R12 已落 · 证据：`grep -c "__probe" 新手上云操作手册.md → 2`（新增 5.5 删 `__probe` 集合）；`grep -c "seedDemo" 新手上云操作手册.md → 2`（新增 5.6 seedDemo 来源三选一、严禁 prod）· commit 5c92ee6
- [2026-09-13 19:44] tmpdir 已删 · 证据：`rm -rf review/.REVIEW_*.tmpdir/ → exit 0`；`ls -a review/ | grep -i tmpdir → 无残留`（内含 `REVIEW_…_exec-readiness.md.tmp` 8006B，与正式文件同大小，无内容损失）· commit __SHA2__
- [2026-09-13 19:44] README §2 已补「变异还原纪律（注入→跑→还原须在同一次命令序列内、离开前复跑确认 exit 0；🚫 跨调用留残留）」——按李老师直接指令补入协议正文（该处正文通常归复审方，本次注明系用户指令）· commit __SHA2__
- [2026-09-13 19:44] 存疑/说明：李老师指令「`git checkout -- 新手上云操作手册.txt`」**未照做** —— HEAD 版 .txt 是 R8 之前的旧版（`git show HEAD:新手上云操作手册.txt | grep -c 5.2b → 0`），checkout 会丢掉刚补的 5.2b 内容、并让新守卫 K13 转红（目标背反）。改用**正确修法「从 .md 单源重生 .txt」**，达成同一目标（门禁回 exit 0、DRIFT 残留 0）· commit 5c92ee6
- [2026-09-13 19:44] 打印：按指令**从新的 `SMOKETEST_RUNBOOK.docx`（mtime 19:29:27）**走（转 PDF→送纸），**未用 10:13 的旧 `SMOKETEST_RUNBOOK.pdf`**（并已将其重生为新版）。
- 本轮报告见 memory/2026-09-13.md
