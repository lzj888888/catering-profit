# R48 / R53「点名复核」证据包（WorkBuddy 侧，2026-09-17 09:2x）

> **为什么建这个目录**：`REVIEW_2026-09-15_round25-verify.md §4` 写「**未复核（要点名才做）**：R48/R49/R50/R51/R53」，
> 并建议优先给 **R48（fail-closed）** 与 **R53（静默截断）**（同属"静默错误"类）。
> **本目录 = 本侧的正式点名**：请复审方按下面每条的「复现命令 + 期望输出 + 变异建议」独立复核。
> 本侧**不预判**结论等级：这里只**给路径与可复现命令**，是否为真加固由复审方判（①档/②档均可跑，②档更强）。

---

## 0. 两条共同背景（复核前请先读，可省一半时间）

1. **`cloudfunctions/_adminCore/adminAuth.js` 是单源**（179 行，指纹 `7b90bc56`，文件头自称"单源、零 wx 依赖纯函数"）。
   每只 admin 云函数目录下有**逐字节一致的 11 份副本**，由 `tools/check_admincore.js` 守卫（副本数 11 / 缺副本 0）。
   ⇒ 对单源的断言**结构性覆盖全部 11 个函数**；不需要逐函数重测。
2. **本侧差点在此处误报**（诚实登记）：我一开始怀疑"R48 的反例路径没有断言"，
   因为 `grep "status: '"` 命中的多是 `status:'active'`。实际**断言完整**，在
   `cloudfunctions/adminLogin/selftest.js:76-116`（下面 §1 逐条列出）。⇒ 复核时请直接看该处，**不存在"只测正例"的问题**。

---

## 1. R48 —— `requireAuth` 账号状态 fail-closed

**缺口原文（round19 收官轮）**：token 有效 ≠ 账号可用。管理员被禁用后，旧 token 仍能用满 7 天。

**修法落点**

| 项 | 位置 |
|---|---|
| 判定实现（单源） | `cloudfunctions/_adminCore/adminAuth.js:109-120` |
| 语义注释 | 同文件 `:88-93`（"取不到记录 / status 非 active / 读取异常 → 一律 fail-closed，复用 `ADMIN_AUTH_FAILED`，**不新增错误码**"） |
| 状态常量 | 同文件 `:78`（`ADMIN_STATUS_ACTIVE`，注释明写"取不到记录 / 任何非此值 → fail-closed 拒绝"） |
| 副本守卫 | `tools/check_admincore.js`（11 份 ≡ 单源） |

关键三行（原文）：
```js
  let adminRow = null;
  try { const ar = await adminUserColl.where({ admin_id: adminId }).limit(1).get(); adminRow = ar && ar.data && ar.data[0]; }
  catch (e) { return { error: 'ADMIN_AUTH_FAILED' }; }      // 账号读异常 → 拒绝（不因容错放行）
  if (!adminRow || adminRow.status !== ADMIN_STATUS_ACTIVE) { return { error: 'ADMIN_AUTH_FAILED' }; }
```

**可复现命令 / 期望输出**

```
node cloudfunctions/adminLogin/selftest.js   → 末尾：adminLogin 批次 6 自测结果：33 通过 / 0 失败
node tools/check_admincore.js                → ✅ 单源派生校验通过：11 份 adminAuth.js 副本均 ≡ cloudfunctions/_adminCore/adminAuth.js
```
五例断言实跑输出（`adminLogin/selftest.js:76-116`）：
```
===== R48 · 账号状态校验（禁用旧 token 立即失效）=====
✅ ① 禁用管理员旧 token → ADMIN_AUTH_FAILED（不等自然过期）      # 假集合 status:'disabled'
✅ ② 正常管理员 token → 放行
✅ ③ 账号记录不存在 → 拒绝（fail-closed）                        # 空 admin_user 集合
✅ ④ 账号读异常 → 拒绝（容错不放行）                            # where().get() 抛 db down
✅ ⑤ status 未知值 → 拒绝（fail-closed）                        # status:'pending_review'
```
⚠️ 该套件第 4 行是 `require('./adminAuth')`（用**本地副本**跑），副本 ≡ 单源由 `check_admincore` 保证 ⇒ 断言等价于测单源。

**变异建议（请复审方做，本侧未在此目录预置注入）**

| 变异 | 期望 |
|---|---|
| `adminAuth.js:120` 的 `adminRow.status !== ADMIN_STATUS_ACTIVE` 改成只看 `!adminRow`（即退回"只看 token"） | ①⑤ **必须转红**；②③④ 仍绿（证明断言精确、非连坐） |
| 只改**某个副本**（如 `cloudfunctions/adminExport/adminAuth.js`） | `check_admincore` 转红（副本守卫独立生效） |
| 把 `catch (e) { return ADMIN_AUTH_FAILED }` 改成 `catch (e) { /* 忽略，继续 */ }` | ④ 转红 |

**已知边界（本侧未做，非本轮范围）**：dev `admin_user` = 0 条（R52 控制台实测）⇒ dev 侧无真实数据可验"禁用后即时失效"；
prod 首个管理员必须由 `adminInit`（写 `status:'active'`）或 `tools/gen_admin_bootstrap.js` 生成文档后插入 —— 已入
`specs/dev-specs/core/16_后台鉴权规范.md §7`。**真云侧行为仍属"不可核"（需真云/控制台）**。

---

## 2. R53 —— `adminQueryUser` 店铺列表静默截断

**缺口原文**：`HARD_LIMIT.shop = 200`（M1 账套上限），但用户详情里的店铺列表用 `limit(20)` 取 — 超 20 家店时**静默少显示**（无提示、无报错）。

**修法落点**

| 项 | 位置 |
|---|---|
| 分页累取实现 | `cloudfunctions/adminQueryUser/service.js:1-38`（`SHOP_PAGE=100`、`SHOP_MAX_PAGES=5` ⇒ 500 ≥ 硬上限 200） |
| 调用点 | `cloudfunctions/adminQueryUser/index.js:54-59`（`fetchShopsAll(async (skip, limit) => … .skip(skip).limit(limit)…)`） |
| 超限行为 | `service.js`：达安全上限 ⇒ `throw { code:'HARD_CAP_EXCEEDED' }`（**响亮失败**，复用既有错误码，不新增） |

**可复现命令 / 期望输出**

```
node cloudfunctions/adminQueryUser/selftest.js
```
```
===== R53 · 店铺列表分页累取（A 类加固，service.fetchShopsAll 真实实现）=====
✅ R53-① 20 家店 → 全部取到（旧 limit(20) 恰好取尽，分页同样取尽）
✅ R53-② 150 家店（>20）→ 分页取尽，无静默截断  (len=150)
✅ R53-② 分页命中：第 2 页 skip=100
✅ R53-③ 店铺数超过安全上限 → 抛 HARD_CAP_EXCEEDED（响亮失败）
✅ R53-④ 无店铺 → 0 家
==== adminQueryUser 批次 6/7 自测结果：12 通过 / 0 失败 =====
```

**变异建议（请复审方做）**

| 变异 | 期望 |
|---|---|
| `service.js` 的 `if (arr.length < SHOP_PAGE) break;` 删掉/改成 `if (page === 0) break;` | R53-② **转红**（150 家只剩 ≤100） |
| `SHOP_PAGE` 由 100 改回 `20` | R53-② 转红（150 家 → 只取到 100 或 20）；R53-① 仍绿 |
| `SHOP_MAX_PAGES` 改 1 | R53-② 转红；R53-③ 的抛错路径也可能不再触发 ⇒ 一并观察 |
| 把 `throw` 改成 `break`（静默截断复发） | R53-③ **转红** |

**已知边界**：**真云侧未实测**（同一 user 真存 >20 家店）；`⑧ 分页取尽` 只证"注入式 fetchChunk 逻辑正确"，
不证"平台 `.skip().limit()` 在真云的返回契约"—— 后者属真云边界（需授权或控制台）。

---

## 3. 一次性命令清单（②档放行后可直接粘贴）

```bash
export PATH="/usr/bin:/bin:/mingw64/bin:/c/Windows/System32:/c/Windows:/c/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3"
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit
node cloudfunctions/adminLogin/selftest.js        # R48：33/0
node cloudfunctions/adminQueryUser/selftest.js    # R53：12/0
node tools/check_admincore.js                     # 11 副本 ≡ 单源
sed -n '105,122p' cloudfunctions/_adminCore/adminAuth.js      # R48 判定原文
sed -n '1,38p'    cloudfunctions/adminQueryUser/service.js    # R53 分页原文
```

## 4. 本侧立场

- **不预判**：上面只给"路径 + 命令 + 期望 + 变异方向"，**R48/R53 是否算真加固、等级是①还是②，由复审方判**。
- **欢迎反例**：若复审方找到"仍能静默截断"或"禁用后仍放行"的路径（如 role 侧、导出侧、批量场景），
  请直接写进下一份 `REVIEW_*` 的 §2 —— 本侧按同一节奏处置（留痕 → 修 → 变异双证 → 回执）。
- **本目录不改写历史**（同 §6.18 判据）：仅新增，不回头改 `batch7_feed/_README.md` 里的流水。
