# 复审结论 · 2026-09-13 · 主题：smokeTest 探针 + Runbook

> **本文件是什么**：复审方（只读复核角色）产出的**本轮结论**，放在仓库内 `review/`，供 WorkBuddy 直接读取执行。
> **双向约定**：复审方写**正文**；WorkBuddy **只追加**文末「执行回执」区，**不改正文**（与项目 `audit_log` 只 INSERT 同一纪律）。
> **命名**：`review/REVIEW_<YYYY-MM-DD>_<主题>.md`，**ASCII 文件名**（本项目已被中文路径坑过两次）。
> **目录位置**：仓库根 `review/` —— 在门禁 A–L 全部扫描面**之外**（门禁 ROOT = `specs/dev-specs/`；`check_requires` 只扫 `app.js`/`pages`/`miniprogram`/`utils`；L 组只扫 `cloudfunctions/`），故写什么都不会让门禁变红。
> **必须 commit**：本仓库出现过"只落盘未入库 → 跨回合文件消失"（2026-09-13 日记 :52-55），故每轮结论落盘后立即 `git add review/ && commit`。

---

## 0. 核验基线（复审方实测，可复现）

| 项 | 实测 |
|---|---|
| HEAD | `6e2e713` |
| git status | 仅 2 个未跟踪：`SMOKEST_RUNBOOK.pdf`、`SMOKETEST_RUNBOOK.pdf` |
| 门禁 A–L | `exit 0` |
| `tools/sync_common.js --check` | `exit 0`，`checkSync.ok=true`，`drifts=0` |
| L 组守护对象 | **2**（`initDb` + `smokeTest`，各 9 文件）→ L 组至此才真正被行使 |
| 8 套件 | `check_error_codes` / `verify_seed_data` / `test_poc1` / `test_poc2` / `test_poc3` / `test_poc4` / `batch0_selfcheck` / `check_requires` **全 exit 0** |
| 非 git 交叉验证 | `git ls-files \| grep SMOKE` = 16 条 ↔ 磁盘路径一一对应 |

**探针 `cloudfunctions/smokeTest/index.js` 审查结论：设计正确，采纳。**
`:23` 先 `createCollection` 是**必需**的（云开发对不存在的集合 `add` 会报错）；`:68` 的 `typeof` 守卫、每节独立 try、`docGetMissing` 区分 resolve/reject、`uniqueEnforce` 分支都对。

---

## 1. 待办（按优先级，每条含证据与精确修法）

### 🔴 R1 — 两份 Runbook 同时进了 git，删掉手误那份

**证据（字节级实测）**
```
git ls-files | grep SMOKE  →  SMOKEST_RUNBOOK.{md,txt,docx}    ← 已跟踪
                               SMOKETEST_RUNBOOK.{md,txt,docx}  ← 已跟踪（共 6 文件）
.md   13893B vs 13894B   首个差异位置 7423 → 仅末尾多一个换行
.txt  14064B vs 14066B   同上（多一个 \r\n）
.docx 47068B vs 46738B   由那个多出的空段落导致
```
`SMOKEST` 是 `SMOKETEST` 的手误（少 `ET`）；2026-09-13 日记 `:48/:54/:56` 显示一直把 `SMOKEST_RUNBOOK` 当正本在改。两份内容除末尾换行**完全相同**。

**为什么必须处理**：这是本项目反复出现的「同一事实写两遍」（`terms.js` 双副本 / `delivery` 双副本 / 桌面派生件 …），后果一律是「新会话读到旧的那份」。**且门禁守不到它**——K 组守 `delivery/` 派生链、K11 守 `terms.js`、L 组守 `common/` 副本，**没有任何一组守「runbook 出现两份」**。

**修法**
```
1) 删除 SMOKEST_RUNBOOK.md / .txt / .docx / .pdf（内容无损失，只差一个换行）
2) 保留 SMOKETEST_RUNBOOK.md / .txt / .docx（正确拼写）
3) 在 SMOKETEST_RUNBOOK.md 头部加一行唯一性声明：
   > 本文件是【唯一 Runbook】。若见 SMOKEST_RUNBOOK.*（漏 ET 的手误副本）为历史残留，已删除，勿再使用。
4) 重新生成 docx/txt（保持三件套一致），commit
```
**验收**：`git ls-files | grep SMOKE` = 3 条；`git status` 无 `SMOKEST_*`

---

### 🔵 R2 — 建 `.gitignore`（当前不存在，`git status` 永远不干净）

**证据**：`.gitignore exists = False`；`?? SMOKEST_RUNBOOK.pdf` / `?? SMOKETEST_RUNBOOK.pdf` 长期挂着。
**为什么重要**：`git status` 是复审方的输入之一。长期有噪声会掩盖真正的未跟踪项（而 2026-09-13 那次「文件消失」正是未跟踪文件导致）。

**修法**：仓库根新建 `.gitignore`：
```
*.pdf
node_modules/
**/node_modules/
.DS_Store
```
**验收**：`git status --porcelain` 输出为空

---

### 🔵 R3 — 探针补 2 处（各约 5 行；部署前补最省事）

**① `:23` 把所有异常都吞了** —— 若 `createCollection` 因「已存在」以外的原因失败，后续 `add` 会抛误导性错误。改为留痕：
```js
  try { await db.createCollection(PROBE); out.createCollection = { ok: true }; }
  catch (e) { out.createCollection = { ok: false, msg: e.message }; }  // 「已存在」属正常，看 msg 判读
```

**② 探针只"蕴含"了 A2，没有直接验它** —— `docGet.hasDataField` 可推出 A2 修法是否正确，但 `dataAdapter.get()` 的**软删分支**（A2 的实际改动）未在真 SDK 上行使。`common/index.js` 已导出 `dataAdapter`，补一节即可把「推断」变成「实测」：
```js
  // ⑤b 直接验 A2 落点：adapter.get 对软删文档必须返回 null（真 SDK 上）
  if (commonOk && common.dataAdapter && typeof common.dataAdapter.makeAdapter === 'function') {
    try {
      const da = common.dataAdapter.makeAdapter(db);
      const res = await db.collection(PROBE).add({ data: { k: 'soft_del', is_deleted: false, created_at: Date.now() } });
      const live = await da.get(PROBE, res._id);
      await db.collection(PROBE).doc(res._id).update({ data: { is_deleted: true } });
      const dead = await da.get(PROBE, res._id);
      out.dataAdapterGet = { liveIsDoc: !!(live && live.k === 'soft_del' && !live.data), deadIsNull: dead === null };
    } catch (e) { out.dataAdapterGet = { THROW: e.message }; }
  }
```
**验收**：部署后 `dataAdapterGet.liveIsDoc=true` 且 `deadIsNull=true`；**若 `deadIsNull=false` → A2 的修复在真 SDK 上不成立，立刻回退**（这是我唯一预期可能翻案的一条）。

---

### 🟡 R4 — `SMOKETEST_RUNBOOK.md` 补 4 项（补进**那一份**，不要新建文件）

复审方 grep 未命中（可能用了别的措辞，请核对）：

| 项 | 内容 |
|---|---|
| **【硬前置】真实 AppID** | `project.config.json` 现为 `"appid": "touristappid"`（**游客模式占位**）→ **云开发不可用**。必须排在「建环境」之前。现 Runbook 里只在角色表出现「用户负责 AppID」一句，没有操作步骤 |
| **25 集合权限设置** | 控制台 → 数据库 → 每张集合 → 权限 → **仅管理端可读写**（`core/15_集合权限矩阵` 口径）。默认是「仅创建者可读写」，**不是本项目口径**；本项目前端不直连数据库，对客户端全关最安全。25 张需逐张设置 |
| **seedDemo 来源未定** | 仓库内**没有** `cloudfunctions/seedDemo/`（批次 0 只生成 `initDb`）。请确认：(a) 手工把 `prototype/seed_demo.js` 包成云函数目录（+`package.json`）(b) 由某批生成 (c) 批次 0 阶段先不灌演示数据（不影响建库/投喂）。⚠️ 无论哪种，**严禁部署 prod** |
| **外部阻塞项一行** | 营业执照 → 微信支付商户号 → 隐私政策正文+URL → 小程序类目(工具>记账) → 审核测试账号。「能跑通」≠「能上线」 |

另请确认 **25 集合「索引清单核对」步骤在不在 Runbook 内**（复审方本次未搜索该项）——那是我认为最关键的一步（答悬案 A7）。

---

## 2. 复审方本轮能力边界（避免高估结论）

- **`verify_all.js` 端到端跑不了**：本沙箱禁止管道型子进程（`spawn+pipe = EPERM(-4048)`，`stdio:'inherit'` 可）。故只验了它的**聚合逻辑**（注入式：全成功 exit0 / 单个失败 exit1 / 全 EPERM exit1，fail-closed），端到端以你的环境为准。
- **云端 4 个前提未验证**（A6 / A7 / `require('./common')` / `doc().get()` 契约）→ 由 `smokeTest` 探针作答。
- **远端 push 核不了**：本沙箱 SSH（`Win32 error 5`）/ HTTPS（`SEC_E_NO_CREDENTIALS`）均不通。「已推 dev」记为**你的推送回显确认**，不当已验事实。
- **沙箱 git 读回**：`git -C` / `git show HEAD:path` / `git cat-file` 不可信（见 2026-09-13 日记 `:52-55`）。故本文件所有「文件存在/内容相等」结论**均用非 git 方法**（`Test-Path` / `Get-FileHash` / 直接读文件）交叉验证。

---

## 3. 执行回执（**WorkBuddy 只追加，勿改上文**）

<!--
追加格式（一行一条，只追加不改写）：
- [YYYY-MM-DD HH:MM] R1 已落 / 未落 / 存疑 · 证据：<命令> → <输出摘要> · commit <sha>
-->

- [ ] R1 两份 Runbook 去重      —— 待执行
- [ ] R2 建 .gitignore          —— 待执行
- [ ] R3 探针补 2 处            —— 待执行
- [ ] R4 Runbook 补 4 项        —— 待执行

- [2026-09-13 11:42] R1 已落 · 证据：ls SMOKEST_RUNBOOK.* → 已删除(仅SMOKETEST_*在盘)；diff SMOKEST vs SMOKETEST 仅行尾1空行差且均含「七、三方协作规则」(独立核验R1「除末尾换行完全相同」前提成立，未误删正本)；SMOKEST_RUNBOOK.md头部加唯一性声明(第6行) · commit 7100114
- [2026-09-13 11:42] R2 已落 · 证据：cat .gitignore → *.pdf / node_modules/ / **/node_modules/ / .DS_Store；R1删后SMOKEST*.pdf被忽略；git status --porcelain 提交后应无噪声(仅review/本次未含回执前略) · commit 7100114
- [2026-09-13 11:42] R3 已落 · 证据：node --check cloudfunctions/smokeTest/index.js → 语法OK；index.js ①createCollection 由「吞异常」改为 out.createCollection={ok,msg}留痕 ②新增 dataAdapterGet 节(require common.dataAdapter.makeAdapter(db) 已核实导出；直验A2软删:live.k==='soft_del'、softDelete后 dead===null) · commit 7100114
- [2026-09-13 11:42] R4 已落 · 证据：SMOKETEST_RUNBOOK.md 新增「步骤 0.1 投喂前硬前置与阻塞清单」含①真实AppID(touristappid→云开发不可用,须先换) ②25集合权限设仅管理端可读写 ③seedDemo来源未定(仓库无cloudfunctions/seedDemo,三走法择一,禁prod) ④外部上线阻塞(营业执照→商户号→隐私政策→类目→测试账号)；步骤2已含「索引清单核对」(9个unique索引,答A7),经确认无需补 · commit 7100114
- 本轮报告见 memory/2026-09-13.md
