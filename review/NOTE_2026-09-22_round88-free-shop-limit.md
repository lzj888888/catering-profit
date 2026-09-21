# NOTE · 2026-09-22 round88 · 同族病第 21 例：免费店铺数口径「单源被绕过」

> 结论一句话：**「M1 免费 1 个账套」这个收钱口径，在代码侧有两个互不引用的硬编码点；
> R102 只把其中一个钉住，第二个长期零守卫。当前三处同值、零漂移（本守卫是防复发，不是救火）。**

---

## 1 发现路径（沿用 round82 的反向扫描，本轮**扩网**）

round82 第 20 例用的方法是「扫代码侧 `const [A-Z_]{4,} = <数字>` → 看有无 specs 声明 + 有无 tools 守卫」。
本轮把网扩到**对象字面量字段**与**默认参数**，共扫出 58 个常量，其中 **12 个双侧零提及**
（证据 `consts_scan.txt`）。按 round82 的过滤器（是不是对外契约 / 李老师会不会照它验收）逐个回源实读：

| 常量 | 位置 | 实读判定 |
|---|---|---|
| `FREE_SHOP_LIMIT = 1` | `getShopList/index.js:38` | 🔴 **真候选**：商业化收钱口径的第二硬编码点 |
| `GRACE_DAYS_MS = 7天` | `saveLedger/index.js:25` | 🟡 真候选（归档补录宽限期），**登记下轮**，本轮未做 |
| `REFRESH_WINDOW_MS = 24h` | `adminRefreshToken/index.js:14` | 🟡 真候选（token 刷新窗口），登记下轮 |
| `EXPORT_PAGE_SIZE` / `MAX_EXPORT_PAGES` / `SHOP_PAGE` / `SHOP_MAX_PAGES` | admin 侧 | 分页尺寸，按 round82 判据**不是口径** |
| `MAX_DEPTH` / `SCRYPT_KEYLEN` / `DAY_MS` / `YUAN` / `DIRECT_CONSUME_FEN` | — | 纯实现常量，不是口径 |

## 2 缺陷本体（回源实扫，不采信任何自述）

同一事实在代码侧有**两个互不引用的硬编码点**（不是副本关系，是各自 `const`）：

1. **单源（受 R102 守）**：`cloudfunctions/checkQuota/service.js:17`
   `const FREE_LIMIT = { shop: 1, cost_card: 3 };`
   —— 真正执行付费墙拦截的那一个。
2. **第二硬编码点（零守卫）**：`cloudfunctions/getShopList/index.js:38`
   `const FREE_SHOP_LIMIT = 1;`
   —— 直接产出 API 出参 `free_limit` / `hit_free_limit`（`core/10:171` 已登记的对外契约出参）。
3. 测试又抄了一份：`cloudfunctions/getShopList/selftest.js:11`。

**判「零守卫」的三条独立证据**：
- `grep -rn "FREE_SHOP_LIMIT" tools/ specs/dev-specs/prototype/` ⇒ **零命中**；
- `tools/check_quota_limits.js`（R102）的 `SRC_REL` **写死** `cloudfunctions/checkQuota/service.js` ⇒ 对第 2 点零覆盖；
- `checkQuota/service.js:11` 注释明写「常量定义于 Service（后端权威，**前端不硬编码**）」
  ⇒ 设计意图就是单源，第 2 点是**违反该意图的平行实现**。

**后果（比「文档抄错数」更硬）**：李老师按单源把免费店铺数 1 → 2，R102 会跟着绿（它只解析 checkQuota），
而 `getShopList` 仍是 1 ⇒ **列表接口返回的 `hit_free_limit` 在第 2 家就 true，可真正拦截的 checkQuota 却放行**
⇒ 展示与拦截分叉，门禁全绿、无人报警。反向同理。

**「缺守卫」与「已违规」必须分开说**（round55 纪律）：实扫三处当前同为 **1**，**零漂移**；
本守卫做的是**防复发**，不是修一个已发生的错误数据。

## 3 落地：R117 `tools/check_free_shop_limit.js`（SUITES 89 → **90**）

判据**只补 R102 覆盖不到的那一维**（「单源 ≡ 代码侧第二硬编码点」），不重复 R102 的文档腿
（R102 已守「文档声明 ≡ 单源」；两者靠传递闭合）：

- A1 扫描面 fail-closed（三份目标文件非空 + **前端逐根下界** pages 30 / utils 5 / miniprogram 2，坑㉛）
- A2 单源 `FREE_LIMIT.shop` 可解析（fail-closed）／A3 第二点 + 测试镜像可解析（fail-closed）
- **A4 核心穿透：单源 ≡ 第二点**（改任一侧即红）
- A5 测试镜像 ≡ 第二点
- A6 前端零硬编码（落实「后端权威」设计意图）+ 扫描面前提
- A7 出参契约完整性（`free_limit` / `hit_free_limit` 必须在 `ok({...})` 里）
- A8 前提：三份文件在扫描面内 + 单源「前端不硬编码」注释仍在（A6 的立论依据）
- W 弱面：明示代码侧其它 `FREE_*` 常量（只打印不判红）

## 4 双向变异：10 组 0 异常

| 组 | 变异 | 期望 | 实测 |
|---|---|---|---|
| M1 | 第二点 1→2（展示与拦截分叉） | 红 | rc=1 ✅ |
| M2 | 删掉第二点定义（fail-closed） | 红 | rc=1 ✅ |
| M3 | 单源 `shop` 1→2（反向穿透） | 红 | rc=1 ✅ |
| M4 | 测试镜像 1→2 | 红 | rc=1 ✅ |
| M5 | 前端硬编码该口径 | 红 | rc=1 ✅ |
| M6 | 正确实现换等价写法（去空格） | **绿** | rc=0 ✅（不错杀） |
| M7 | 前端扫描面根路径写错（扫空） | 红 | rc=1 ✅ |
| M8 | 前端加无关常量 | **绿** | rc=0 ✅（不错杀） |
| M9 | 删出参 `free_limit` | 红 | 首轮 **MISMATCH** → 加固后 rc=1 ✅ |
| clean | 还原 | 绿 18/18 | rc=0 ✅ |

**M9 抓出我方判据 bug（本轮最有价值的一条）**：A7-① 原本写裸 `free_limit\s*:`，
会被 `hit_free_limit:` 命中 ⇒ 把 `free_limit` 出参整行删掉**仍判绿（漏）**。
已加左边界 `(?:^|[^A-Za-z0-9_$])` 加固。与 round70 B4（`.scope-head` 裸子串匹配兄弟类 `.scope-head-x`）同族。

## 5 本轮踩到的三个坑（已回写技能）

- **㉝ `open(P,'wb')` 会先截断文件**：本轮同步重启键套件数时，write 的实参表达式抛 `TypeError`，
  文件已被 `open(...,'wb')` 清空为 0 字节（220KB → 0）。
  ⇒ **定式：先把最终字节算成一个变量，再单次写；或用 tmp + `os.replace` 原子替换**。
  已从 HEAD 还原并复验（`git diff HEAD` 空、220528B、三处已改）。
- **㉞ 重启键「套件数」是**三处**不是两处**：除「套件数会漂」行首与演进链末节外，
  **§1.1 一键校验入口行**的「串 **N** 个套件」也是一处，由 R97 的 `C2-②` 当场抓出（文档 89 / 实算 90）。
  ⇒ 坑㉕ 的「两个数字位」需再扩一处。
- **㉟ R66 的 banner 不能用 `=====`**：`SECTION_HEAD` 会把 `===== x =====` 当段标题并做「零断言即判红」；
  若 banner 后立刻开 `===== A1 ... =====` 子段 ⇒ banner 段零断言 ⇒ **假红**。
  ⇒ 要么 banner 后直接跟断言（如 R113），要么 banner 用纯文本不带 `=` 围栏（本轮取后者）。

## 6 队列状态（①~⑤ 逐条复验，非采信自述）

| # | 项 | 本轮判据 | 结论 |
|---|---|---|---|
| ① | A6b 代码层兜底 | 无新 commit；`defaultShopId()` 单源仍在 | 维持闭环 |
| ② | R91 F1/F2 UI 缺陷 | `selftest_ui_fix.js` **38/38** RC=0 | 维持闭环 |
| ③ | AD 适配 G1–G8 | `selftest_ad_gates.js` **24/24** RC=0 | 维持闭环 |
| ④ | R86 超时值 | **人工面**，本轮未实测 | 🟡 **存疑**（按 round50 三方一致结论不再回读） |
| ⑤ | 14 页真数据走查 | 无新 commit | 维持闭环 |

门禁 **90/90 RC=0**、A–L **RC=0**、AD **24/24**、UI **38/38**。

## 7 下轮待办（新增/沿用）

- 🟡 **第 21.5 例候选**：`GRACE_DAYS_MS = 7 天`（`saveLedger/index.js:25`，归档补录宽限期）——
  代码 + 用户可见文案「归档后 7 天内可补录」+ 4 份文档声明，`tools/` **零引用**。
- 🟡 `REFRESH_WINDOW_MS = 24h`（`adminRefreshToken/index.js:14`）同为双侧零提及。
- 🟡 沿用：R115 A2 只锁 hex 字面 / selftest_r85 A13 裸 includes 扫注释 / subsidyTotal 兜底零覆盖（均属裁决项，不代修）。
- 🟡 沿用：四红线代码侧零实现二选一、M3.7 配额指令二选一、建 prod 须重走 R86 定值、隐私政策按 6 处填。

---

## 回执

- [2026-09-22 06:3x] R88 已落 · 证据：`node verify_all.js` → 总览 **90/90 套件通过** RC=0 ·（本 commit）
- [2026-09-22 06:3x] R88 已落 · 证据：`node check_error_codes.js` → RC=0（A–L 全绿）
- [2026-09-22 06:3x] R88 已落 · 证据：`node tools/selftest_ad_gates.js` → **24/24** RC=0（队列③）
- [2026-09-22 06:3x] R88 已落 · 证据：`node tools/selftest_ui_fix.js` → **38/38** RC=0（队列②）
- [2026-09-22 06:3x] R88 已落 · 证据：`_scan_consts_r88.py` → TOTAL_CONST 58 / A 组（双侧零提及）12
- [2026-09-22 06:3x] R88 已落 · 证据：新守卫 `tools/check_free_shop_limit.js` 首跑 **18/18** RC=0
- [2026-09-22 06:3x] R88 已落 · 证据：`_mut_r88.py` → **10 组 0 异常**（M9 首轮 MISMATCH 已加固）
- [2026-09-22 06:3x] R88 已落 · 证据：探针 `probe_agents.py` → InsCode **idle**（msg 1671 持平 / idle≈3.8h）、dsh **missing** ⇒ 不投喂不投递
- [2026-09-22 06:3x] R88 已落 · 证据：停手四连（mtime 静止 >70min 且门禁后回读不变 / 进程两采 0-0 / HEAD `0f4f825` 无新 commit / `git diff HEAD` 空）⇒ 解锁写入
- [2026-09-22 06:3x] R88 **存疑** · 队列④ R86 超时值是人工面（需控制台手点），本轮未实测 · 沿用 round50 三方一致结论
- [2026-09-22 06:3x] R88 **未落** · 3 条判据强度缺口（R115 A2 / selftest_r85 A13 / subsidyTotal 兜底）属**范围裁决**，不代修
- [2026-09-22 06:3x] R88 **未落** · `GRACE_DAYS_MS` / `REFRESH_WINDOW_MS` 两个新候选，登记下轮
- [2026-09-22 06:3x] R88 已落（事故已复）· 证据：重启键文件曾被 `open(...,'wb')` 截断为 0 字节 → `git show HEAD:...` 还原，复验 220528B + `git diff HEAD` 空
