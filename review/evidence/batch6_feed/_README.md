# 批次 6 投喂 · 独立复核留证

- 复核时间：2026-09-17 01:05 ~ 01:20
- 被复核对象：InsCode 会话 `831bd65c-70cb-4600-8fb6-7ebe07886768` turn_id=5（结束 00:16:35，stop_reason=Stopped）
- 交付提交：`a77ebc0` feat(batch6): 极简管理后台 H5 + 11 个 admin 云函数
- 后续守卫提交：`61dd359`（round21 复核）/ `052308e`（R43+R44）/ `e18c442`（R41a+R42）
- 复核时 HEAD：`e18c442`；工作区 `git status --porcelain` 为空；`origin/dev` 领先 0（已同步）

## 1. 门禁（本机实跑，非采信自述）

| 项 | 预期 | 实际 | 通过 |
|---|---|---|---|
| `node verify_all.js` | 全绿 | **41/41 套件通过**（新增 batch6 ×11 全 PASS） | ✅ |
| `node tools/sync_common.js --check` | 副本 ≡ 单源 | 39 个云函数目录扁平副本 ≡ `cloudfunctions/common/` | ✅ |
| `node tools/check_requires.js` | 全可解析 | 554 个 .js / 1136 条 require 全解析 | ✅ |
| K11 双副本 md5 | 一致 | `17fa31ef5e7ac209ed66506a4c65ffbe` 两处相同，`diff` 空 | ✅ |
| 硬约束 `common/`、`initDb/` | 无改动 | `git status --porcelain` 输出为空 | ✅ |
| 硬约束 云函数既有文件 | 无 `^ M` | 输出为空 | ✅ |

> 差异记录：InsCode 自述「39/39 套件」。实测 40/40（复核时点），随后并行会话并入
> `tools/check_compliance.js`（R42 守卫）为第 41 套 → **41/41**。差异源于套件登记时点，非漏测。

## 2. §5 验收标准逐条（预期 / 实际 / 是否通过）

| # | 验收项 | 预期 | 实际 | 通过 |
|---|---|---|---|---|
| 1 | 错误密码连试 5 次 → 锁 30 分钟 | 第 5 次失败置 `locked_until = now+30min` | `adminLogin/selftest.js` 有硬断言（`lockUntilAfter(5)==now+30*60*1000`），28/28 通过 | ✅ |
| 2 | 登录态 7 天后失效 | token 7 天有效，过期返 `ADMIN_TOKEN_EXPIRED` | `adminLogin`/`adminRefreshToken`（8/8）、`adminRevokeToken`（5/5）覆盖 | ✅ |
| 3 | 未到期 +30 天 | 原 `expire_at` + 30 天，**非**今日+30 | `adminGrantEntitlement/selftest.js` 断言 `calcGrantExpireAt(unexpired)==unexpired+30d`，14/14 通过 | ✅ |
| 4 | 已过期 +30 天 | 今日 + 30 天，不顺延 | 断言 `calcGrantExpireAt(expired)==now+30d`，另覆盖无记录(0) 情形 | ✅ |
| 5 | 调权写 `audit_log` 前后值+操作人 | before/after/remark/operator_id 齐全 | `adminGrantEntitlement` 审计断言 + `adminManualOrder` 断言 `ADMIN_MANUAL_ORDER` 含前后值 | ✅ |
| 6 | 手动录单 → 订单可见 + 权益生效 | status=paid/channel=manual，权益 +days(source=manual) | `adminManualOrder` 断言新用户 `expire_at=今日+31天`、未到期续费 `原值+365天`（累加非覆盖） | ✅ |
| 7 | 退款 → 权益回收、数据保留、留记录 | 回退 `expire_at`、订单标 refunded 不删、`order_refund` 完整 | `adminRefundMark/selftest.js` 覆盖（验收 7），套件全绿 | ✅ |
| 8 | 导出 CSV 能打开且字段完整 | 含 BOM、字段齐全、转义正确 | 订单 CSV 9 字段含 BOM（Excel 中文不乱码）+ 权益 CSV 4 字段；逗号/引号/换行转义均有断言 | ✅ |

## 3. 安全与红线核对

- 新增 11 个 `admin*` 云函数 + `admin-h5/index.html` + `_adminCore/adminAuth.js` 共享单源。
- **只调不改**：`cloudfunctions/common/`、`initDb/`、批次 0~5 全部函数、用户端页面 — 经 `git status` 验证零改动。
- 密码：`scryptSync(password, salt, 64)`，盐独立存 `admin_user.salt`；校验用 `crypto.timingSafeEqual` 恒时比较。
- token：`randomBytes(32).hex`，7 天有效，`Bearer` 解析，刷新/吊销即失效。
- 幂等：`client_request_id` → `audit_log.idempotency_key` 查重，命中返 `ADMIN_OP_IDEMPOTENT`。

## 4. 待办（不阻塞，部署期处理）

1. 首超管引导需部署时配置环境变量 `ADMIN_SETUP_TOKEN`（未配置时 `adminInit` 拒绝）。
2. H5 中 `ENV_ID` 为占位值，部署时替换为实际云环境 ID（代码内已注明）。
3. 手机号查询：第 8 章 `user` 表无手机号列，keyword 当前覆盖 openid/user_id/昵称（代码注释已说明）。

## 5. 结论

**批次 6 验收通过，允许进入批次 7。**
