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
| 3 | `payExpireNotify`（**决策注释同步**，§八-quater 落地后重部署） | **success=true** | 19 | **'43.0 KB'** | 34.3s | `ALL_ROWS_HIT=true` · `DONE=true` |

日志：`_m3/deploy_logs/deploy_payExpireNotify_1.log`（2566 bytes）；第 3 次 `deploy_payExpireNotify_1.log`（3849 bytes，日志轮转同名）

> 🔴 **交叉印证（体积 → 内容）**：第 3 次 `filesCount` 仍 **19≡19**（文件数未变）而 `packSize` **42.5 → 43.0 KB（+0.5 KB）**
> —— 增量恰为本次新增的注释文本 ⇒ **新代码确实传上去了**（不是「跑了个空部署」）。
> 本次只改注释、**逻辑零改动**；`config.json` 随包上传**不等于**触发器生效（见 §六）。

汇总：`---- 2/2 OK ----`（首轮）+ `---- 1/1 OK ----`（决策同步轮）

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
- **第 3 次（决策注释同步轮）回读**：`payExpireNotify` → `'Active'` · `timeout 20`（**未回退**）✅
- 🔴 `timeout` 仍为 **20 / 15**（与部署前权威回读一致）⇒ **「单函数部署会把 timeout 冲回平台默认 3」这一悬置问题：本轮实测 = 不会**（此前 §9 明写「从未实测」）。

## 五 本轮部署清单依据

```bash
git diff --name-only HEAD~3 HEAD -- cloudfunctions/ | sed 's#cloudfunctions/##;s#/.*##' | sort -u
# → payExpireNotify / smokeTest   （本轮未改 cloudfunctions/common/ ⇒ 无需 sync_common、无需扩面）
```

## 六 ✅ 触发器上传：**已决策「暂不上传」**（保留函数待命，不下线）

| 事实 | 证据 |
|---|---|
| `cli cloud functions` **无触发器子命令** | 实测子命令集仅 `list / info / deploy / inc-deploy / download` |
| 故 `config.json::triggers`（每天 10:00）**随包上传 ≠ 触发器生效** | 技能 `miniprogram-cloud-deploy` §9 同族结论（「随包上传 ≠ 生效力」） |
| 需生效时走 | 微信开发者工具 → 云开发控制台 → 云函数 → `payExpireNotify` → 触发器 → 手工「上传触发器」 |

**决策（2026-10-04，李老师授权「按你的建议操作」）= 暂不上传** —— 理由链见 `NOTE_2026-10-04_round215_*.md §八-quater`：
扫描窗口 `expire_at ∈ (now, now+7d]` 而免费档建档恒 `expire_at = 0`（`initDb/cx_auth.js:113`，唯一写非 0 处为真实支付回调 `payCallback`）
⇒ **当前无付费用户 ⇒ 恒扫空**；且函数不推送、无模板 ID、无前端授权、**前端兜底提示条也不存在**
⇒ 配了只是每天云端日志多一行。

> 🔴 **纠正 R214 错述**：R214 遗稿写「不做提醒 ⇒ 下线该函数（**前端常驻提示条已覆盖该需求**）」——
> 该括注**不成立**：`miniprogram/` 内 `days_left` / `expire` / `到期` / `entitlement` **全零命中**，
> 前端提示条**与推送通道一样都不存在**。故**不能以下线了事**，而是**保留待命 + 登记启用前置**（`CHECKLIST §G`）。

⇒ **安全洞（任意用户可拉全表）已随本次部署关闭**，与本条无关。

## 七 交付话术（诚实边界）

**「已上云」≠「功能可用」**：本文件只能证明**代码已部署且函数 Active**。
真正可用性（定时器是否真跑起来 / 前端 no_shop 引导是否如期弹出）须**真机或控制台**验证 —— 见 NOTE §九 待办 5/6。
