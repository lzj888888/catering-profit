# NOTE · 2026-09-19 round50 自驱动巡检（WorkBuddy）

> 本轮性质：**无新 commit 可复核 + 队列已清空** ⇒ 本轮正事 = ① 复核 HEAD 是否有并发方新落代码 ② 对已闭环的 R86 做**第二次独立终值回读**加固 ③ 把 dsh 故障从"现象"推进到"根因侧证"。
> 判据一律来自 DB / 进程命令行 / HTTP / CLI 回读，**不采信任何自述**。

## 1. 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight=0`；`approval_audit` 末行 id=54 `approved_once`（非 pending）；`message_count=1465`（**八连持平**）；`idle_sec≈102700`（28.5h）；`model=deepseek-v4-flash`；`permission=auto` | **idle**，无待批、无在跑 ⇒ 不点击、不投喂 |
| dsh | 窗口 `rect=-32000` 最小化 ⇒ `ShowWindow(h,9)` 恢复（852,105,1764,924）；OCR 仍见 **`历史加载失败：signal timed out (internal)`** | **不可用（第 6 轮）** |
| dsh 差异点 | 与 round49「`find 发消息/输入/拒绝` 三连 MISS」不同，本轮 OCR **能读到「给智能体发消息」输入框**（SPA 外壳已渲染） | 外壳在、业务后端不在 ⇒ **仍不投递**（技能 §3.2：后端不可用换模型无效、别反复投递） |

证据：`review/evidence/selfdrive_20260919_r50/probe_r50.json`、`dsh_diag_and_concurrency_r50.txt`

## 2. 🆕 dsh 根因侧证（本轮新增，round49 未做）

| 侧证 | 实测值 | 推出什么 |
|---|---|---|
| dsh web 进程 `CreationDate` | **2026-09-17 03:07:02**（PID 3324） | 已**连续运行 62.8 小时**未重启 |
| `storages/session_projcache.json` mtime | 2026-09-19 09:21:08（**10.5h 无写入**） | 会话层早已停止落盘 |
| `/api/sessions` `/api/health` `/api/config` | 全部 **404** | HTTP 层在应答，但 API 路由未注册/未就绪 |
| `/` 与 `/v1/models` | 200（HTML） | SPA 兜底，**不能当健康信号** |
| 上游 `https://api.deepseek.com` | **401 Authorization Required** | ✅ **外网与上游可达（401=需鉴权，非断网、非额度耗尽）** ⇒ 排除"网络/额度"根因 |

⇒ **结论（可证伪）**：既不是网络问题也不是额度问题，指向 **dsh web 长跑进程内部会话加载超时**（进程 62.8h + storages 10.5h 静止）。
⇒ 对上报的影响：**方案 D（重启 dsh web，`start-dsh-web.vbs`）的证据强度上升**；但**无人值守轮次不擅自动手杀进程**，仍待李老师四选一裁决。

## 3. 并发写入方判定（§0.7 进程级，三次采样）

- 采样 1（19:44）／采样 2（19:47）／采样 3（19:53）：`wmic process … CommandLine` 指向仓内脚本的进程数 = **0**（仅 sheetagent / weixinpay / `dsh bin.js web` 三类常驻噪音）。
- 证据目录：`r86_timeout_20260919` 最新 **15:58（静止 235min）**、`r86_final_20260919` 16:57（静止 176min）。
- 他人 2 个未提交文件 `REVIEW_2026-09-15_round38-verify.md`(09:57) / `索引补齐核对单.md`(09:17) mtime 均在 10h 前。
⇒ **并发方已停手** ⇒ 解锁 `cli` 单通道（本轮 R86 回读因此可做）；该 2 个他人文件**仍不代提交**。
（窗口枚举里「云开发控制台」仍在，但按 §0.7 该信号最易误伤=窗口没关而已，以进程级为准。）

## 4. 🟢 本轮核心 = R86 第二次独立终值回读（round50）

命令（并发停手后才敢占单通道）：

```
cli.bat cloud functions info --project C:/Users/lzj/WorkBuddy/Claw/catering-profit \
  -e cloud1-d4gphpoxy337f2a25 --names <42 个函数，空格分隔>   # RC=0
```

| 项 | 结果 |
|---|---|
| 解析出行数 | **42/42** |
| 与定值表比对 | **42/42 全达标，MISMATCH = 0** |
| `timeout=3` 残留 | **0** |
| 分布 | `60`×2（`adminExport`/`exportData`）· `30`×1（`initDb`）· `15`×1（`smokeTest`）· `20`×38 |

证据：`review/evidence/r86_recheck_20260919/readback.json` + `cli_info_42_raw.txt`

**价值**：round45（并发方）→ round46（我方）→ **round50（我方，间隔 2.7h，且跨过并发方当日活动窗口）** 三方独立回读结论一致 ⇒ R86 从"改对了"升级为"**稳定保持住了**"。
⚠️ 遗留工程债不变：平台不采纳 `config.json::timeout` ⇒ **新建 prod 环境必须重走一遍定值与回读**。

## 5. 门禁（我方直跑，非采信）

| 门禁 | 结果 |
|---|---|
| `node verify_all.js` | **总览：66/66 套件通过** |
| `node specs/dev-specs/prototype/check_error_codes.js` | **A–L 全绿，真实退出码 RC=0**（⚠️ 用 `\| tail` 取到的是 tail 的 rc，本轮改为重定向后取 `$?`） |
| `tools/selftest_ad_gates.js` | **24/24** |
| `tools/selftest_ui_fix.js` | **27/27** |

## 6. 阻塞抽查（只登记，不给结论）

- **隐私政策 v1**（唯一硬阻塞）：`specs/dev-specs/上线材料_隐私政策_v1.md` 占位符 **7 处未填** —— `【营业执照上的主体全称】`／`【常用邮箱】`／`【微信号 / 客服电话…】`／`【客服方式…】`／`【可公网访问的静态页 / 公众号图文】`／`【15】`／`【】`。
  ⚠️ **数量修正**：此前各轮记作"4 处"，实扫为 **7 处** ⇒ 李老师的填空量被低估，本轮更正。
- 未跟踪过程 PNG **1033 张**（`review/evidence/r86_timeout_20260919/`）：仍待李老师定（不代提交、不代删）。
- `ENV_MAP.prod` 仍为占位符 ⇒ 建 prod 时必须同时替换（round48 遗留）。

## 7. 队列核对（§6）

| 项 | 状态 |
|---|---|
| ① A6b 代码层兜底 | ✅ 已闭环 |
| ② R91 F1/F2 UI 缺陷 | ✅ 已闭环（ui 27/27 本轮复跑） |
| ③ AD 适配 G1–G8 复验 | ✅ 已闭环（ad 24/24 本轮复跑） |
| ④ R86 超时值（人工面） | ✅ 已闭环 + **本轮二次回读加固 42/42** |
| ⑤ 14 页真数据走查 | ✅ 已闭环 |

**HEAD 比对**：`git rev-parse HEAD = f52c0de`（= round49 收口 commit），`git ls-remote origin refs/heads/dev` 同值
⇒ **自 round49 以来无任何新 commit** ⇒ 无"未经我方复核的代码 commit"可查 ⇒ 队列确无新活。
⇒ **不自创新批次**（8 批投喂 0~7 收官、无「批次 8」；中优先级项明写"上线后 1 月内补"，自动化擅自开工属越权）。

## 8. 回执

- [2026-09-19 19:44] R50-1 **已落** · 探针 + 并发三次采样 · 证据：`probe_agents.py` → InsCode idle(msg 1465 八连持平/无待批)、dsh 最小化；`wmic process` 三次采样 → 仓内目标进程 0 · commit 见下
- [2026-09-19 19:50] R50-2 **已落** · R86 二次独立回读 · 证据：`cli.bat cloud functions info --names <42>` → 42/42 达标、`timeout=3` 命中 0 · 证据 `review/evidence/r86_recheck_20260919/` · commit 见下
- [2026-09-19 19:53] R50-3 **已落** · dsh 根因侧证 · 证据：进程 `CreationDate=20260917030702`（62.8h）+ `/api/*` 全 404 + `api.deepseek.com` 401 ⇒ 排除网络/额度，指向长跑进程超时 · 证据 `selfdrive_20260919_r50/`
- [2026-09-19 19:55] R50-4 **已落** · 门禁 · 证据：`verify_all.js` 66/66；`check_error_codes.js` 真 rc=0；ad 24/24；ui 27/27
- [2026-09-19 19:56] R50-5 **已落** · 阻塞抽查更正 · 证据：grep 占位符 → 隐私政策 **7 处**（此前记 4 处，更正值）
- [2026-09-19 19:57] R50-6 **未落** · dsh 复审投递 · **理由**：后端不可用第 6 轮（历史加载失败 + `/api/*` 404 + storages 10.5h 静止）；李老师四选一（A 放开权限 / B 改只读判据 / C 退场 / **D 允许重启 dsh web**）仍未裁决 ⇒ 不投递、不换模型（换模型对本故障无效）
- [2026-09-19 19:57] R50-7 **未落** · 1033 张过程 PNG 处置 · **理由**：归属并发方产出，待李老师定，不代提交不代删
