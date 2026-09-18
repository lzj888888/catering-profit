# NOTE 2026-09-19 · round39 · A6b 闭环：`shop` 无唯一索引 ⇒ 代码层确定性 id 兜底

> **归属（R96）**：本件是**执行方（WorkBuddy）的分析件**，前缀 `NOTE_`（`REVIEW_*` 归复审方）。
> **时点**：2026-09-19 01:40–02:20。

## 0. 一句话结论

`shop.idx_shop_user` **真云实测非 unique**（同一 `user_id` 连插两次**都成功**，E11000 都没触发）；
而 `resolveAuth` 是**每个云函数的必经路径**，且它 + `getShopContext` **两处**都会「先查后建」默认店铺
⇒ 并发/重试下同一 user 能建出**两个店**。已改为**确定性 `_id`（`shop_<user_id>`）+ 撞键容错回读**：
幂等**由构造保证**，不依赖索引、不依赖时序。

## 1. 证据链（真云，非推断）

| 项 | 判据 | 真云结果 | 出处 |
|---|---|---|---|
| A6b | 同 `user_id` 往 `shop` 连插两次 | **两次都成功** ⇒ 无唯一兜底 | `review/evidence/uniq_probe_result.json` |
| A6a | 同 `openid` 往 `user` 连插两次 | 第二次 **被拒**（`E11000 … index: idx_openid`）⇒ 已兜底 | 同上 |
| §3 | `(shop_id, card_code, version)` 重复三元组 | 第二次 **被拒**（`E11000 … index: idx_card_code_version`）⇒ 索引真生效 | 同上 |

> 判读纪律：写入「成功」= 该键**没有**唯一兜底；写入「被拒」= 唯一约束**真生效**。
> 这三条此前只能靠**控制台 GUI 手工插重复三元组**（人工面）；本轮改成
> `smokeTest` 的 `{ uniq: 'cc' | 'user' | 'shop' }` 入参触发，**程序化 + 自带清理**。

## 2. 两处建店点（同一语义两份实现 —— 本次一并收）

1. `cloudfunctions/common/auth.js::resolveAuth`（首次进入自动建档）—— **每个函数必经**，风险面最大。
2. `cloudfunctions/getShopContext/index.js` 建店分支（用户已存在但无店）。

## 3. 改法

- **单源新增**（`cloudfunctions/common/auth.js`）：
  · `defaultShopId(userId)` = `'shop_' + userId`，`defaultEntitlementId(userId)` = `'ent_' + userId`
    —— **键格式单源在此，调用点禁止自拼**（R72 纪律）。
  · `autoProvision(ctx, db, audit)` 抽出建档逻辑，顺序**不可换**：
    **先抢 `user`（`idx_openid` unique 是权威）→ 撞键则回读并采用赢家的 `user_id` → 再建 shop/entitlement**。
    反过来（先建店）会给自己的临时 `user_id` 建出一间**孤儿店**。
  · 撞键判定 `isDuplicateKeyError(e)`（`common/errors.js` 单源）：认 `E11000|duplicate key` 或 `errCode=-502001`。
- **容错而非硬失败**：旧代码在并发首进时第二个请求会**直接抛库错**（`idx_openid` 拒绝），
  现在改为回读采用赢家；回读仍为空 ⇒ `SYSTEM_ERROR` **fail-closed**（不猜、不返回假 shop_id）。
- **聚合入口同步导出**（`common/index.js`）：`defaultShopId` / `defaultEntitlementId` / `isDuplicateKeyError`
  —— ⚠️ 这正是 2026-09-18 `genId` 漏导事故的同族风险，必须同时加进 `check_requires.js §2 MIN_KEYS`。
- `getShopContext/index.js`：改用 `defaultShopId(userId)`（**不再** `genId('shop_')`）+ 撞键回读 + 空则 fail-closed。

## 4. 判据（本地，含反向证据与变异回灌）

| 位置 | 断言 |
|---|---|
| `common/__tests__/batch0_selfcheck.js`（新增 A6b 段，9 条） | 并发两次 `resolveAuth` ⇒ 1 user / 1 shop / 1 entitlement / 同一 `user_id` / `shop_id == shop_<user_id>`；**机制级**：确定性 id 下第二次建店**被库拒** |
| 同上（**反向证据**） | 换回随机 `genId` ⇒ 两次都成功 = **2 个店**（证明判据有鉴别力，不是恒真） |
| `getShopContext/selftest.js`（4 条，替换旧断言） | 必须用 `defaultShopId(userId)` **且**不再出现 `genId('shop_')`；撞键必须回读；回读空 ⇒ fail-closed |

- **变异回灌**：把 `const shopId = defaultShopId(userId)` 改回 `genId('shop_')` ⇒
  `batch0_selfcheck` **RC=1**（「shop_id 用单源确定性格式」转红）。
- ⚠️ **自我更正**：变异同时暴露我一条断言措辞不实 —— 原本写「旧实现随机 id 会建 2 个」，
  但在 `resolveAuth` 并发场景里**输家采用赢家 `user_id` 后提前返回、根本不建店**，
  功劳不在确定性 id。已改为中性措辞，并把「确定性 id 真正压住的那条路径」
  （用户已存在但无店 ⇒ 两个并发都 insert）单独做成**机制级**判据。
- 基线：`batch0_selfcheck` **41/41**；`getShopContext` **29/29**；套件 **64/64**；门禁 A–L **RC=0**。

## 5. 部署与真云复验

- 因 `cloudfunctions/common/` 变更 ⇒ **全量 42 个函数逐个重部署**（日志 `review/evidence/a6b_deploy_20260919.txt`）。
- ⚠️ 必须**逐个**（一次多个 `--names` 会产生空壳，见 round38 根因分析）。

## 6. 顺带记录（本轮发现，未闭合）

- `dataAdapter.BIZ_KEY_FIELDS = ['id','material_id','asset_id','shop_id','account_id']` **不含 `user_id`**
  ⇒ 若有 `da.get('user', <user_id>)` 形态的调用会取不到（`user` 文档的业务主键是 `user_id` 不是 `id`）。
  本轮**未**发现该形态的有效调用（`resolveAuth` 走 `where({openid})`），登记为待查项，
  **不得**凭此改 `BIZ_KEY_FIELDS`（会动到 A6a 的兜底面）。
- `shop_entitlement` 在 `resolveAuth` 之外的补建路径（管理员发放）本就按 `user_id` 查改，不受影响。
