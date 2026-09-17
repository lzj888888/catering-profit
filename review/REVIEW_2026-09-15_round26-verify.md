# REVIEW_2026-09-15 round26 · R60/R61 复核 + R48/R53 点名复核（附 R62/R63）+ `refs/remotes` 静默不落地实证

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 26 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round25-verify.md`（含其 §3 回执）；本轮对象 = `8603cd4` → `0611db9`，HEAD `0611db9`。
> 本轮**申请了三次放行**（git/node 子进程 + `.git` 探针写入）⇒ 下面结论绝大多数是 **①档：我独立复跑**。

---

## §0 结论

**R60 / R61 复核通过**，**R48 / R53 我点名复核后判：两条都是真加固，均 ①档通过**，但各带一条待补（🟡 R62 / 🔵 R63）。
**`refs/remotes/**` 静默不落地：现象 ①档确证、机制仍未定论**（我排除了 4 个假说，实验矩阵见 §4），**你方把"已推"判据由三方降为两方——判定正确，我采纳**。
**我另有 3 处自己的登记**（§5：一条判据缺陷、一条操作失误、一条残留），其中**操作失误是我销毁了证据样本**，如实报告。

| 独立复核项 | 档 | 我的结果 |
|---|---|---|
| HEAD / 工作树 | ① | ✅ `0611db9`；`git status --porcelain` = **0 行**（含我探针清理后） |
| 远端（两方差） | ① | ✅ `git ls-remote origin dev` = `0611db926a02…` = `git rev-parse HEAD` |
| `@{u}` | ① | ✅ **确认不可信**：`git branch -vv` = `* dev 0611db9 [origin/dev: gone]`；`rev-parse @{u}` → `fatal: Needed a single revision` |
| 门禁 / 全闸 | ① | ✅ `GATE=0`；`总览：52/52 套件通过`，`VERIFYALL=0` |
| R60（README §6 两档） | ① | ✅ 我全仓 grep `跑不了\|核不了\|不可核`：**`review/README.md` 命中 0**；`§6.2`（`:113`）为两档表，`:72` 第 6 条同步；其余命中全在**历史 REVIEW / 回执引述**（按判据不改写） |
| R60 附带的"活文档不写死计数" | ① | ✅ `review/README.md:21` 立判据；重启键 `:113` 已改为指向可复现命令 |
| R61（§3 落点） | ① | ✅ §3 区**已被使用**（收到 9 行回执 + 1 行澄清）；`review/README.md:31` 记录了"round25 起固定留 §3" |
| 我方 round25 正文未被改 | ① | ✅ **我自己算**（不信你给的 md5）：两侧第 1–83 行 SHA256 **完全一致** = `bfc3ceb3793f38ea…`；文件 102 → 112 行（差异全在 §3 之后） |
| R48 | ① | ✅ **通过**（我复跑 `adminLogin/selftest.js` **33/0**；`check_admincore.js` 11 副本 ≡ 单源；通读单源三条 fail-closed 分支；**11 个 admin 函数全覆盖，含最易漏的 `adminRefreshToken`**）—— 但见 🟡 R62 |
| R53 | ① | ✅ **通过**（我复跑 `adminQueryUser/selftest.js` **12/0**；通读 `service.js` 的 20/100/500 三个边界）—— 但见 🔵 R63 |
| 你方三条"诚实登记" | ① | ✅ 全部与我的核验一致（R48 五例俱全；同文件 Edit 与 round8 记载重复踩坑；中文目录已改 ASCII） |

---

## §1 R60 / R61 复核（逐条）

**1.1 R60 ✅**：`review/README.md` 现为 `### 6.2 沙箱边界：两档`，**且原文的无条件绝对句已消失**（我独立 grep：该文件 0 命中）。这条比我提的时候做得更彻底 —— 你把「为什么改」的历史引述也改成了概念表述，避免了自动 grep 误命中，这是我在提 R60 时没想到的收尾。
**处置的连带收益**：你顺手修了自己 `MEMORY.md` 里的同类错误（"`verify_all` 不能端到端跑"）—— **同类查全做到了"跨仓库层级"**，我记一笔。

**1.2 R61 ✅**：回执已写在 §3 区（9 行 + 1 行澄清），且**给了我可直接复现的正文边界证法**。我做了两件独立动作：① 我自己算第 1–83 行哈希（两侧一致）；② 探针清理后确认 `git status` = 0。⇒ **"正文未改一字"这句我不再只是采信，而是①档确认。**

**1.3 一处提醒**：你把「写了不取」断点从两次更正为**三次**（round2 / round4 / round24-25）—— 这个更正在我看来**偏严**：round24-25 那次回执确实写了（写在 `evidence/batch7_feed/_README.md §6.18`），只是**落点不在取件规则射程内**；性质是"落点错"而非"没写"。**建议表述为「3 次取件异常（2 次未回执 + 1 次落点错）」**，以免将来有人按"三轮都没写"去改流程，改错方向。判为 🔵 措辞级，改不改都行。

---

## §2 R48 / R53 点名复核（你方邀请我找反例，我找了）

### 2.1 R48 判定：**真加固，①档通过**；覆盖面比我预期更完整

- 我独立核了**覆盖面**（这是点名包没让我核、但我认为最该核的一点）：`grep requireAuth` → **11 个 admin 函数全部经过单源中间件**，含 `adminRefreshToken`（这类"刷新即续命"的路径最容易被漏；未漏 ✅）。
- 单源 `_adminCore/adminAuth.js:95-125` 三条 fail-closed 分支我逐行看过：会话读异常 → 拒；`!adminRow` → 拒；`status !== ADMIN_STATUS_ACTIVE` → 拒（`:120`）。**:78-79 的注释与代码一致**（"任何非此值 → fail-closed"），不是"注释写得比代码狠"。
- `check_admincore.js` 我复跑：11 份副本 ≡ 单源（179 行 / 指纹 `7b90bc56`）✅ ⇒ 单源断言结构性覆盖全部 11 个函数，你这条判断成立。

### 🟡 R62（新）：同一语义两处判据不一致 —— `adminLogin` 用字面量 `'disabled'`，单源用 `!== ADMIN_STATUS_ACTIVE`

- **证据**：`cloudfunctions/adminLogin/index.js:52` = `if (admin.status === 'disabled') { … }`；而单源 `cloudfunctions/_adminCore/adminAuth.js:79` 定义 `ADMIN_STATUS_ACTIVE = 'active'`、`:120` 判 `adminRow.status !== ADMIN_STATUS_ACTIVE`。
- **后果**（都不含提权，故不是 🔴）：
  1. **登录判据与中间件判据不等价**：`status` 为**未知值**（如 `pending_review`、将来新增的 `suspended`、或历史脏数据/字段缺失但非空串）时 ——**登录会成功**并签发 token、审计写 `result:'success'` + `last_login_at`；而该 token 在**每一个** admin 调用上都被 `requireAuth` 拒。
  2. 于是出现**"登录成功但什么都做不了"**（用户体验/排查成本）与**审计里出现失败账号的成功登录记录**（与 R48"禁用必须立即生效"的语义相冲突）。
  3. **防御纵深**：`requireAuth` 今天兜住了，但这意味着**"登录闸门"事实上不设防**——将来若有新端点忘了接 `requireAuth`，未知状态的账号就从"被兜住"变成"真进得去"。
- **同源一致性旁证**：单源自己的注释（`:78`）写的就是"**取不到记录 / 任何非此值 → fail-closed**"；`adminLogin` 的 `=== 'disabled'` 恰好是"只堵一个已知值"的写法 —— 与同一份文件里的语义相反。
- **修法**（单源化，三行内）：
  ```js
  // cloudfunctions/adminLogin/index.js 顶部：与中间件共用同一常量（单源派生守卫已保证副本一致）
  const { parseBearer, verifyPassword, genToken, TOKEN_TTL_MS, ADMIN_STATUS_ACTIVE } = require('./adminAuth');
  // :52 改为
  if (admin.status !== ADMIN_STATUS_ACTIVE) {
    await writeLoginLog(admin.admin_id, 'fail', { reason: 'not_active' });
    return fail(ERROR_CODES.ADMIN_AUTH_FAILED, '账号已停用');   // 复用既有错误码，不新增
  }
  ```
  （理由：`reason` 由 `'disabled'` 泛化为 `'not_active'`，日志更能解释真实原因；文案保留"账号已停用"避免暴露内部状态机。）
- **验收 + 变异方向**：
  - 新增断言（`adminLogin/selftest.js`，与现有 R48 五例同区）：`status:'pending_review'` 与 `status:''`/缺字段两种输入 → **必须返回 `ADMIN_AUTH_FAILED` 且不签发 token**（现有 33 例未覆盖"未知状态登录"，这是与中间件 ⑤ 例不对称的地方）。
  - 变异：把 `!== ADMIN_STATUS_ACTIVE` 退回 `=== 'disabled'` → 新断言必须转红（证明它有鉴别力）。
- **同类查全**：全仓 `'disabled'` 字面量仅此 1 处（`index.js:52-53`；`selftest.js:81` 是测试数据）✅ 不需要多点同修。

### 2.2 R53 判定：**真加固，①档通过**

- `service.js:16-30` 三个边界我逐一推过：20（旧 `limit(20)` 恰好取尽）、150（第 2 页 50 条 → `break`）、500（第 5 页满 → **抛 `HARD_CAP_EXCEEDED`**）；`fetchChunk` 返回非数组时归一为 `[]` 也正确（不会 `push.apply` 炸）。
- 我在点名包之外**多核了一处**：全仓同类实现 —— `adminExport/service.js:35-53`（R49 的 `fetchAllPages`）与它是**同源写法**，所以你这次的加固行为在导出侧也覆盖到了 ✅（见 🔵 R63 的共同前提）。

### 🔵 R63（新）：R49/R53 的"取尽"判据建立在两个未验证前提上，前提不成立时静默截断会以新形态回归

- **前提①"平台如实返回所请求条数"**：两处都用 `if (arr.length < pageSize) break;`（`adminQueryUser/service.js:22`、`adminExport/service.js:49`）。**若平台对 `limit` 有更低上限**（或某些条件下少返回），首页就会 `break` ⇒ **静默少显示/静默少导出**，与 R53 要修的原始病**同族**。
  > 你在点名包 §2「已知边界」已主动承认了这条（"⑧ 只证注入式 `fetchChunk` 逻辑正确，不证平台 `.skip().limit()` 契约"）—— **这条诚实登记我确认有效**，R63 是把它从"边界说明"升级为"可关闭的缺口"。
- **前提②"返回形态恒为 `{ data: [...] }`"**：`adminExport/service.js:69` = `return (res && res.data) || [];` ⇒ 形态漂移时**静默返回空数组**，会被解释成"取尽了"，于是**导出成功但为空**。这正是本仓已栽过的形态事故类型（单源 `adminAuth.js:92-93` 亲自记着 `doc().get()` 被当文档本体用的教训）。
- **修法（两处同改，成本极小）**：
  ```js
  // ① 形态守卫（只查首页，避免每页开销）——把"静默空"变成"响亮失败"
  const res = await q.get();
  if (page === 0 && (res == null || !Array.isArray(res.data))) {
    const e = new Error('查询返回形态异常（期望 {data:[]}）'); e.code = 'INVALID_RESPONSE';
    throw e;                                  // 复用/新增错误码由你们按 core/09 口径定
  }
  // ② 取尽判据补一次"探针页"：短页 ≠ 一定耗尽
  if (arr.length < pageSize) {
    const probe = await fetchChunk(all.length, 1);
    if (!Array.isArray(probe) || probe.length === 0) break;   // 确证耗尽才停
    all.push.apply(all, probe);                                // 否则继续下一页
  }
  ```
- **判级说明（我自己标档）**：这是 **🔵 建议级，不是 🔴**。理由：前提①②在你的注入式测试下都不成立、真云未出现反例；但**它俩恰好是 R53 原始病（静默截断）赖以复发的两个入口**，而这个项目已经为"静默少数据"付过代价，所以我建议关掉它俩，而不是留作边界说明。

---

## §3 执行回执区（WorkBuddy 只追加）

> 本区归 WorkBuddy：**只追加、不改上文**。格式：`- [YYYY-MM-DD HH:MM] R<n> 已落/未落/存疑 · 证据：<命令> → <输出摘要> · commit <sha>`；存疑项写「存疑 + 理由」。

（暂无 —— 待本份被取件后追加）

---

## §4 `refs/remotes/**` 静默不落地：现象确证、机制未定论

### 4.1 我独立复现的实验矩阵（全部在放行档下跑）

| 写入目标 | `rc` | 落盘 | 说明 |
|---|---|---|---|
| `git update-ref refs/remotes/origin/dev <HEAD>` | **0** | ❌ **不存在** | 与你方一致 |
| `git update-ref refs/remotes/origin/dev2 <HEAD>` | **0** | ❌ | **换 ref 名也失败** |
| `git update-ref refs/remotes/other/dev <HEAD>` | **0** | ❌ | **换 remote 名也失败** |
| `git update-ref refs/tags/probe_tag <HEAD>` | 0 | ✅ | 同一次命令内、同一进程 |
| `git update-ref refs/heads/probe_branch <HEAD>` | 0 | ✅ | 同上 |
| `New-Item .git\refs\remotes\origin`（建目录） | — | ✅ 成功 | 目录**可以**创建 |
| `Set-Content .git\refs\remotes\origin\plain_test`（裸文件） | — | ✅ 成功 | 该目录**可以**写普通文件 |
| `logs/refs/remotes/origin/dev`（reflog） | — | ✅ 17202 B，末尾 4 条 `000…→sha update by push` | **reflog 却写了** |

### 4.2 由此**排除**的假说（各自的证伪证据）

1. **权限/ACL 不对称**：`.git\refs`、`.git\refs\remotes`、`.git\refs\heads` 三处 ACL **完全相同**（`SYSTEM`/`Administrators`/`李志杰\lzj` 均 FullControl）。
2. **父目录缺失**：我**手工建好** `refs\remotes\origin` 后重试 `update-ref` —— **仍然 rc=0 且不落盘**。
3. **钩子拦截**：`.git\hooks` 下**无**任何非 `.sample` 文件，`core.hooksPath` 为空。
4. **"某次 `git fetch --prune` / `update-ref -d` 删掉了它"**：删除会**写 reflog**（旧值→全 0 的删除条目），而你那份 17202 B reflog **最后 4 条全是"创建"式（旧值全 0）**且**无删除条目**。⇒ 引用不是被 git 正常删除的。

### 4.3 结论与判据

- **确证的**：本机存在一个**只作用于 `refs/remotes/**` 命名空间**的静默写入不落地；`refs/heads/**`、`refs/tags/**`、同目录裸文件、以及 `logs/refs/remotes/**` 全部正常。**git 报 `rc=0`、不报错、reflog 照写** ⇒ **这是"看起来成功了"的失败**，比报错危险得多。
- **未定论的**：**机制不明**。我已排除了权限/父目录/钩子/正常删除四条，剩下最像的解释是"**某个环境级过滤器/重定向只匹配该路径**"——但那属于**你侧运行环境**，我这一侧看不到，**我不做没有证据的断言**。
- **判据（我完全采纳你的更正）**：
  - ✅ **"已推" = `git ls-remote origin dev` == `git rev-parse HEAD`（两方）**；本轮 = `0611db926a02…`。
  - 🚫 **任何**基于 `@{u}` / `refs/remotes/**` / `origin/dev` 的结论**一律无效**（含"本地=远端"这类三方表述）。
  - 📌 建议把这条**写进你的提交前自检清单**（`review/README.md §7` 第 5 条现为 `git rev-parse HEAD origin/dev` —— **该命令恰好依赖失效的引用**，应改为两方命令）。这是我在你这份更正之上**新看出的一处**：`§7` 第 5 条的示例命令本身就是踩在那个坑上的。

### 4.5 我自己的三处登记（两处是我的问题）

1. **判据缺陷（我的）**：round25 我写"三方一致"—— 但我 08:56 读到的 `refs/remotes/origin/dev` **当时确实存在**（引用确实被建过），只是**不持久**。⇒ 我的观测没错，**但我把"当时可读"当成了"持久可信"**，这是判据设计缺陷，采纳你的两方更正。
2. **操作失误（我的，如实报告）**：我在实验清理步骤里用了 `git update-ref -d refs/remotes/origin/dev`，它**连带删除了 `logs/refs/remotes/origin/dev`（17.2 KB reflog）** —— 也就是**我刚引用的那份关键证据被我自己的清理动作销毁了**。原文末尾 4 行我在删除前已读取并留档在本 §4.1（`000…→05b54d3 / 1af3d1e / bdfa2cc / 0611db9`，均 `update by push`）。⇒ 纪律新增（我自己）：**变异/探针的"还原"动作必须先确认它不会破坏证据**：删 ref 用 `Remove-Item` 删文件（只动 ref 文件）、**不要用 `update-ref -d`**（它连 reflog 一起删）。
3. **残留**：探针在 `logs/refs/remotes/` 下留下了 `origin/dev`（追加了几条我的条目）与 `other/dev`、`origin/dev2` 三个 reflog 文件；后两个我已清理，**`origin/dev` 我保留**（它现在混有我的探针条目，但删掉会再次销毁证据）。`refs/heads/dev` 完好、`git status` = 0、所有探针 ref 已删除。

---

## §5 队列

| 类别 | 内容 |
|---|---|
| **待执行侧** | ① 🟡 **R62** `adminLogin/index.js:52` 判据单源化（`!== ADMIN_STATUS_ACTIVE`）+ 补"未知状态不得登录"断言 + 变异回验 ② 🔵 **R63** 分页两处补"形态守卫 + 探针页"（`adminQueryUser/service.js:22`、`adminExport/service.js:49/69`）③ 🔵 **`review/README.md §7` 第 5 条**：`git rev-parse HEAD origin/dev` 改为两方命令（`ls-remote` + `rev-parse HEAD`）④ 🔵（措辞级）「写了不取」表述建议改为「3 次取件异常（2 次未回执 + 1 次落点错）」 |
| **待人工** | ① wechatide client 授权 → **先补 39 条索引**（线上 1/39）→ 真云三验 ② `ADMIN_SETUP_TOKEN` 的**值** ③ 上线三项（隐私政策 URL【硬阻塞】/ 审核测试账号 / 营业执照商户号）④ **R45** iOS 过滤（套餐 UI 前置） |
| **下一步（条件式）** | **若 `git log -1` 仍是 `0611db9`**（且 `ls-remote` 与之相等），我下一轮从「R54/R56/R57 复跑留痕」与「R41/R42/R44/R50/R51 的守卫类复核」中挑一件；**若 HEAD 已前进**，以新 HEAD 为准并重跑全闸 + 复跑本轮两条点名套件。 |
