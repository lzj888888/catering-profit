# R724l · 备份数据处置口径（零脱敏：判定为可接受，不是「修好了」）

> 台账条目：R3-3（原 P1 推测 → R722 降 P2 → 本轮完成处置判定）
> 纪律：`cloud-console-audit` 全程只读，**本轮没改任何云控制台配置、没改 dbBackup 代码、没重新部署**。
> 复核时间：2026-11-13 07:5x GMT+8 ｜ CLI 证据：`review/evidence/r724l_cloud_console/cli_recheck.txt`

---

## 1. 一句话结论

**备份文件确实是明文 JSON，含用户信息与经营数据；这不是漏洞，是「在三个前提成立下可接受的 P2 治理项」。**
前提已被机器锁进 `tools/check_backup_data_handling.js`，任一前提变化 ⇒ 必须重新评估，到那时再决定要不要脱敏/加密。

不写成「没事了」，也不写成「修好了」——**明文还在，只是泄露路径被排除、留存期被限定、前提被监控**。

---

## 2. 事实（分两层，别混）

### 2.1 R722 实测（GUI，14 张截图，未重跑）

| 项 | 结论 | 证据 |
|---|---|---|
| 云存储权限 | **仅创建者可读写**（5 个单选项第 2 个选中），不是「所有用户可读」 | `r722_cloud_console/06_storage_permission.png` |
| 数据库数据权限 | 同样封死；页面原文「除自定义权限外，其他权限均不支持未登录态用户访问」 | `11_db_permission.png` |
| 未登录访问开关 | **灰色关** | `14_env_permission_bottom.png` |
| 备份目录 | `backup/2026-11/` 下有明文 `admin_login_log.json` / `admin_user.json` / `audit_log.json`(137KB) / `external_sales_daily.json`(212KB) 等 | `08_backup_folder.png` / `09_backup_202611.png` |

### 2.2 R724l 本轮复核（CLI，只读）

- `cli islogin --port 10896` → `{"login":true}`
- `cli cloud env list` → **仍只有 `cloud1-d4gphpoxy337f2a25` 一个环境，prod 未建**
- 与 R722 一致；无配置变更、无理由变化 ⇒ **5 项 GUI 核查本轮未重跑**，如实登记，不拿旧截图冒充本轮实测。

### 2.3 源码事实（本轮新读，`cloudfunctions/dbBackup/index.js`）

- 备份 = 全集合原始行 `JSON.stringify` 后写 `backup/<YYYY-MM>/<集合>.json`，**零字段脱敏**。
- 🔴 **但不是永久留存**：R688 已实现轮转，`KEEP_EPOCHS = 2`（当期 + 上一期，最老数据约 60 天），
  且**只在 `ok && done.length` 时才删旧文件**（半成功不删，避免把仅存的完整备份弄没）。
  R722 报告里「明文永久留在对象存储」是 dbBackup 源码注释描述 R688 之前的旧状态，本轮校正。
- 函数自保：`ctx.OPENID` 存在（= 小程序端调用）⇒ 直接 `FORBIDDEN`，只有定时触发器能跑。
- 红线③：备份只读业务库，唯一写入是云存储（已有 `check_db_backup` B-⑨ 守着）。

---

## 3. 明文里到底有什么（敏感集合清单）

从 `dbBackup/COLLECTIONS` 实算，不手抄；下列 4 个是**凭据/身份/审计类**，其余 `shop_*` 是经营数据：

| 集合 | 敏感内容 | 为什么仍要备 |
|---|---|---|
| `user` | openid、用户标识 | 注销/恢复时要能对回主体 |
| `admin_user` | 后台账号名、密码哈希 | 后台配置重建依据 |
| `admin_login_log` | 登录审计 | 追溯用 |
| `audit_log` | 操作审计（137KB） | 追溯用，只增不删 |
| `external_sales_daily` | 外卖/收银日销量流水（212KB） | 真实业务数据，丢了没法复盘 |

另有 `shop_monthly_account` / `shop_cost_card` / `shop_material` 等经营明细，属李老师**自己的**经营数据，
敏感度低于凭据类但同样是明文。

---

## 4. 为什么本轮不做脱敏/加密（唱反调结论）

**反方：明文摆在那儿，为什么不顺手脱敏？**

1. **备份的目的是可恢复**。字段级脱敏（抹掉 openid / 密码哈希）会让备份失去恢复能力——
   真出事那天才发现备了一份「不能用来恢复」的文件，比不备更糟。
2. **泄露路径已实测排除**（R722 三项绿）。当前威胁模型下，拿到备份文件的唯一途径是
   **云端账号/凭据本身失守**；那种情况下攻击者本来就能直接读数据库，脱敏备份救不了。
3. **真正有效的手段是服务端加密或 KMS**，不是改几行 `JSON.stringify`。这需要调研云开发存储
   是否支持、密钥谁管、恢复流程怎么走，属产品+运维决策，**不是一次审计能顺手做的**。
4. 轮转已把留存压到约 60 天，风险窗口有限。

⇒ **本轮只做「判定 + 前提锁定」，不改代码、不改配置**。这不是回避，是把「什么时候必须改」写清楚。

---

## 5. 四个前提（任一变化 ⇒ 必须重评）

| # | 前提 | 谁在守 | 失效后果 |
|---|---|---|---|
| P1 | 云存储权限仍为「仅创建者可读写」 | R722 截图 + 本说明文档 | 备份可被小程序端枚举读取 ⇒ 一次拿全库 |
| P2 | 未登录访问开关仍关 | R722 截图 + 本说明文档 | 同上 |
| P3 | `KEEP_EPOCHS ≤ 2` 且轮转**只在完全成功时**执行 | `check_backup_data_handling.js` H-③/H-④ | 明文留存期被悄悄拉长；或半成功时把仅存完整备份删掉 |
| P4 | `dbBackup` 仍只允许定时触发（OPENID 自保） | `check_backup_data_handling.js` H-⑤ | 小程序端可刷备份、刷存储账单 |

**重评触发事件**（任一发生即回来改这份文档并考虑加密/脱敏）：
接虚拟支付 / 引入多人协作或客服账号 / 建 prod 环境 / 云存储权限被调整 / 隐私政策更新 /
`KEEP_EPOCHS` 上调 / 备份清单新增含凭据的集合。

---

## 6. 本轮未测到的项（不许用推断冒充实测）

- 5 项 GUI 核查**本轮未重跑**（无配置变更；R722 截图是 2026-11-12 的，不是今天的）。
- `dbBackup` 的**函数级执行超时 60s** 云端配置本轮未复核（R722 报告也标注「未测到」）。
  每次重新部署 `dbBackup` 后必须复查这一项，否则定时备份会静默失败。
- 云开发存储是否提供服务端加密 / KMS，**未调研**。
- `backup/` 下除 `2026-11` 外是否已有 `2026-12` 等新期次，本轮 CLI 拿不到（无存储 CLI），未测。

---

## 7. 复现命令

```bash
CLI="/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
P="C:/Users/lzj/WorkBuddy/Claw/catering-profit"
"$CLI" islogin --port 10896
"$CLI" cloud env list --project "$P"
node tools/check_backup_data_handling.js
node tools/check_db_backup.js
node tools/check_privacy_collection.js
```
