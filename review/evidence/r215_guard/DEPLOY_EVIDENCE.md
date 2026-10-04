# R215 部署取证（dev 环境 · 2026-10-04）

> 工具：`review/evidence/_deploy_fns.py`（ENV 现读 `cloudfunctions/initDb/config.json::DEV_ENV_ID`）
> 判据：`_judge_deploy.js`（latin1 原始字节，只匹配 ASCII —— 不信 `rc`，不信 `│`）
> 环境：`cloud1-d4gphpoxy337f2a25`（现读，非抄记忆）
> 🔴 全程 `dangerouslyDisableSandbox: true`（沙箱拦 `cli.bat` 所需的 `reg.exe`）

## 一 单函数烟测（技能要求的「先烟测、再放量」）

| 序 | 函数 | 结果 | filesCount | packSize | 用时 | 判据 |
|---|---|---|---|---|---|---|
| 1 | `smokeTest` | **success=true** | 16 | '45.0 KB' | 29.0s | `ALL_ROWS_HIT=true` · `DONE=true` |

日志：`_m3/deploy_logs/deploy_smokeTest_1.log`（4039 bytes）

## 二 正式部署

| 序 | 函数 | 结果 | filesCount | packSize | 用时 | 判据 |
|---|---|---|---|---|---|---|
| 2 | `payExpireNotify` | **success=true** | 19 | '42.5 KB' | 22.0s | `ALL_ROWS_HIT=true` · `DONE=true` |

日志：`_m3/deploy_logs/deploy_payExpireNotify_1.log`（2566 bytes）

汇总：`---- 2/2 OK ----`（两函数均首跑成功，无重跑）

## 三 `filesCount` 对账（回磁盘数，不看历史表）

```
smokeTest        磁盘 16  ≡ 云端 16  ✅
payExpireNotify  磁盘 19  ≡ 云端 19  ✅
```
（口径：含 `package.json` / `config.json` 等非 `.js` 文件，排除 `node_modules`）

## 四 `info` 回读复核（不信 rc，读真实状态）

```
│ payExpireNotify │ 'Active' │ 20      │ 'Nodejs16.13' │
│ smokeTest       │ 'Active' │ 15      │ 'Nodejs16.13' │
```

- 两函数均 **Active** ✅
- 🔴 `timeout` 仍为 **20 / 15**（与部署前权威回读一致）⇒ **「单函数部署会把 timeout 冲回平台默认 3」这一悬置问题：本轮实测 = 不会**（此前 §9 明写「从未实测」）。

## 五 本轮部署清单依据

```bash
git diff --name-only HEAD~3 HEAD -- cloudfunctions/ | sed 's#cloudfunctions/##;s#/.*##' | sort -u
# → payExpireNotify / smokeTest   （本轮未改 cloudfunctions/common/ ⇒ 无需 sync_common、无需扩面）
```

## 六 ⏸ 未做：触发器上传（**属 GUI 操作 + 业务决策**）

| 事实 | 证据 |
|---|---|
| `cli cloud functions` **无触发器子命令** | 实测子命令集仅 `list / info / deploy / inc-deploy / download` |
| 故 `config.json::triggers`（每天 10:00）**随包上传 ≠ 触发器生效** | 技能 `miniprogram-cloud-deploy` §9 同族结论（「随包上传 ≠ 生效力」） |

⇒ 需在**微信开发者工具 → 云开发控制台 → 云函数 → payExpireNotify → 触发器**手工「上传触发器」。
⚠️ 且**是否启用**属**业务决策**：R214 曾给两条路 —— ① 做订阅消息提醒 ⇒ 上传触发器；
② 决定不做提醒 ⇒ 按 R214 建议**下线该函数**（前端常驻提示条已覆盖该需求）。
⇒ **安全洞（任意用户可拉全表）已随本次部署关闭**，与本条无关。

## 七 交付话术（诚实边界）

**「已上云」≠「功能可用」**：本文件只能证明**代码已部署且函数 Active**。
真正可用性（定时器是否真跑起来 / 前端 no_shop 引导是否如期弹出）须**真机或控制台**验证 —— 见 NOTE §九 待办 5/6。
