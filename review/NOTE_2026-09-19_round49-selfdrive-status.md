# NOTE 2026-09-19 round49 · 自驱动巡检状态 + 两个未复核 commit 的独立复核

> 执行方：WorkBuddy（我·巴迪）｜轮次编号 **round49**（并发方自称 round48 ⇒ 本轮取 49 防同号）
> 仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`｜时间 2026-09-19 18:10 ~ 18:35

---

## §1 探针结果（唯一入口，判据非印象）

命令：
```
"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe" \
  "C:/Users/lzj/.workbuddy/skills/self-drive-loop/scripts/probe_agents.py"
```

| 代理 | 判据 | 值 | 判定 |
|---|---|---|---|
| InsCode | `inflight_turn` 行数 | 0 | **idle**（不点，无火可救） |
| InsCode | `sessions.message_count` | **1465** | 与 round43/44/46 **七连持平** |
| InsCode | `sessions.idle_sec` | **97533.2 s ≈ 27.1 h** | 空闲 27 小时 |
| InsCode | `sessions.model` / `permission` | `deepseek-v4-flash` / `auto` | 无异常 |
| InsCode | `approval_audit` 末行 | `approved_once`（非 pending） | **无待批** |
| dsh | 窗口标题含 `DeepSeek Harness` | hwnd=855322（Edge），rect `-32000` 最小化 | 已 `ShowWindow(h,9)` 恢复 |

**dsh 本轮新症状（升级，非此前四轮的沙箱文案）**：窗口 OCR + 截图见
`历史加载失败：signal timed out (internal)`（红字），且 `find 发消息` / `find 输入` / `find 拒绝` **三者全 MISS**。
liveness 侧证：`http://127.0.0.1:3080/` HTTP 200（SPA 静态可服务）、`/v1/models` 亦回落同一 HTML、
`/api/sessions` **404** ⇒ 静态层活着，**业务后端不可用**；`C:\Users\lzj\.dsh\storages\session_projcache.json`
mtime = **09-19 09:21**（≈9 小时无写入）⇒ dsh 自 09:21 起没干成过活。
证据：`review/evidence/selfdrive_20260919_r49/dsh_20260919_1818.png` + `dsh_ocr_r49.txt`。

## §2 并发写入方判定（§0.7，本轮 = 已停手）

| 判据 | 结果 |
|---|---|
| 进程级（`wmic process … CommandLine`） | 18:13 采样见 `node verify_all.js`(44708) + `tools/selftest_ad_gates.js`(46068)；**18:15:38 再采已消失**，只剩常驻噪音（sheetagent×2 / weixinpay×2 / `dsh … bin.js web`） |
| 证据目录 mtime | `review/evidence/r86_timeout_20260919/` 最新文件 **15:58**（本轮采样时距 2h17m 静止） |
| `git status` | 有他人未提交改动（见 §3） |
| 结论 | 并发方于 **18:14 完成 round48 收口并推送**（`d14c369`）⇒ **判定停手**，解锁单通道，本轮按**只读旁观 + 路径级提交我方文件**执行 |

> 纪律：对他人未提交的 2 个文件（`review/REVIEW_2026-09-15_round38-verify.md`、`索引补齐核对单.md`）
> **不代提交、不代删**，工作树故意不清。

## §3 本轮核心 · 独立复核两个**未经我方复核**的代码 commit

并发方在 17:29 与 18:05 落了两个**改代码**的提交（不是文档），我方此前从未复核 ⇒ 这是本轮唯一真缺口。

| commit | 主题 | 触及 |
|---|---|---|
| `c32caa4` | R45 收口——iOS 端虚拟商品付费入口过滤（此前零实现） | `utils/platform.js`(新) / `utils/paywall.js` / `pages/pay/orders.js` / `tools/check_ios_pay.js`(新) / `verify_all.js` / terms 双副本 |
| `10f9ed5` | 环境 ID 占位符静默回落缺口 | `miniprogram/config/env.js` / `tools/check_env_ready.js`(新) / `verify_all.js` |

### 3.1 门禁（我方直跑，不采信自述）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 主套件 | `node verify_all.js` | **66/66 PASS · RC=0**（套件数 64→65→66，并发方新增 ios-pay-guard / env-ready） |
| A–L 门禁 | `node specs/dev-specs/prototype/check_error_codes.js` | **RC=0**（A–L 全组列印） |
| AD 缺口 | `node tools/selftest_ad_gates.js` | **24 通过 / 0 失败** |
| UI 修复 | `node tools/selftest_ui_fix.js` | **27 通过 / 0 失败** |
| iOS 支付守卫 | `node tools/check_ios_pay.js` | **6 通过 / 0 失败** |
| 环境就绪守卫 | `node tools/check_env_ready.js` | **11 通过 / 0 失败** |

### 3.2 🔴 我方独立变异回灌（不采信"变异已做"的自述）

脚本：`review/evidence/selfdrive_20260919_r49/mutation_r49.py`
输出：`review/evidence/selfdrive_20260919_r49/mutation_result_r49.txt`

| # | 变异 | 期望 | 实测 | 还原后 |
|---|---|---|---|---|
| M1 | 抽掉 `utils/paywall.js::onConfirm` 的 `if (isIOS()) return showIOSBlocked();` | 转红 | **rc=1**，`P1 utils/paywall.js 已做 iOS 过滤` ❌（5 通过/1 失败） | **rc=0** ✅ |
| M2 | 抽掉 `miniprogram/config/env.js::getEnv` 的 `if (!this.isPlaceholder(id)) return id;` | 转红 | **rc=1**，N1（返回 `catering-prod-xxxxxxxx`）+ N2（零告警）+ E2.2 **共 3 条红** | **rc=0** ✅ |
| M3 | **新增**一个漏网入口 `pages/__mut_probe_r49.js`（有 `api.call('payRenew')`、无 `isIOS`） | 转红**且须点名新文件** | **rc=1 且捕获到新文件**（`P1 pages/__mut_probe_r49.js …❌`）⇒ 守卫**不是**硬编码两份已知文件 | 探针已删、**rc=0** ✅ |
| M4 | 反向（不该红时不红）：注释里裸写 `payRenew` | 仍绿 | **rc=0** ✅ | 还原 rc=0 ✅ |

**结论**：两个新守卫均为**真判据**（可红可绿、能抓新增漏网、注释误报已被收敛），并发方 commit message 里的
"变异回灌已做"经我方独立复现**属实**。`isIOS()` 的 fail-closed（取不到 platform ⇒ 按 iOS 处理）与
`isPlaceholder` 的非字符串一律视占位符，方向均取**风险侧收敛**，与项目既有政策一致。

### 3.3 源码层面抽读（非只看 commit message）

- `utils/platform.js`：`wx.getDeviceInfo` 优先 → `wx.getSystemInfoSync` 回落 → 均失败返回 `''` → `isIOS()` 返回 `true`（fail-closed）。缓存 `cached` 单源。
- `utils/paywall.js`：`openPaywall` 顶端 `if (isIOS()) return showIOSBlocked()`；`onConfirm` **二次拦截**（注释明写"守卫只保证文件里做了判断，本行保证运行时真挡住"——**边界自述诚实**）。
- `pages/pay/orders.js`：`showRenew: !isIOS() && (…)` 入口隐藏 + `onRenew` 顶端二次拦截，两处齐全。
- `tools/check_ios_pay.js`：判据为**函数体级**（`enclosingStart` 向上回溯缩进更小的函数头），只认**调用形态**正则（`api.call('payRenew` / `name:'payRenew'` / `payRenew(`），并有 S1 扫描面非空 + S2 命中数下限 ≥2 两道自失效护栏 —— 与"存在类判据不可信"的教训方向一致。

### 3.4 ⚠️ 遗留（不属本轮缺陷，登记待办）

- `utils/platform.js` 的 `isIOS()` **只在前端**判定；后端 `payCreateOrder`/`payRenew` **有意不拦**（客户端 platform 不可信）。
  这是**明确记录的政策选择**，非疏漏；但 ⇒ **安卓用户改包/改 UA 无法绕过（无入口），iOS 用户若走 deep link 直达下单云函数仍能成功**。
  上线前建议由复审方评估"是否需要服务端二次确认端侧"——**我方不给结论，只登记**。
- `env.js` 的 `ENV_MAP.prod` 仍是占位符 `catering-prod-xxxxxxxx` ⇒ **新建 prod 环境时必须同时替换**，否则
  `getEnv()` 会回落 dev 并把生产数据写进开发库（新守卫只负责"不静默"，不负责"自动修好"）。

## §4 dsh 状态与待决（第 5 轮，须李老师裁）

dsh 已连续 **5 轮**不可用：
- round42~46：`沙箱拒绝此类写入与node子进程` + 不在输入框（投递不进）
- **round49（本轮）**：升级为 `历史加载失败：signal timed out (internal)`，会话历史都拉不出来；`/api/sessions` 404、storages 9 小时无写入

⇒ 我方**未投递**（投了也跑不动，且技能明写"别反复投递"）。待李老师四选一：

| 选项 | 内容 | 我的建议 |
|---|---|---|
| A | 给 dsh 放开**写文件 + node 子进程**权限 | 治本，但需改 harness 沙箱配置 |
| B | 让 dsh 只做**只读判据**复审（读源码 + 跑 `verify_all.js`/`selftest_*`，不做变异） | **推荐**，与 dsh 现状能力匹配；变异类由我方 3.2 那种方式兜 |
| C | 退场，由我方自审 | 违反分权，不推荐 |
| D | **允许我重启 dsh web 服务**（`taskkill` + `C:\Users\lzj\.dsh\start-dsh-web.vbs`；用户画像已把"服务重启/自启"划归我） | 若您认为超时是进程僵死所致，可试；**无人值守轮次我不擅自动手** |

## §5 队列状态（§6）

| # | 项 | 状态 |
|---|---|---|
| ① | A6b 代码层兜底 | ✅ 已闭环（`68ae219`+`cd8877e`，本轮复核门禁仍绿） |
| ② | R91 F1/F2 UI 缺陷 | ✅ 已闭环（`selftest_ui_fix.js` 27/27） |
| ③ | AD 适配 G1–G8 复验 | ✅ 已闭环（`selftest_ad_gates.js` 24/24，本轮复跑仍绿） |
| ④ | R86 超时值 | ✅ 已闭环（round46 我方独立终值回读 42/42；本项**无新增**） |
| ⑤ | 14 页真数据走查 | ✅ 已闭环（`5f7ace8`，14/14） |
| ⑥ | **本轮新增**：`c32caa4` / `10f9ed5` 两代码 commit 独立复核 | ✅ 本轮完成（§3） |
| ⑦ | 上线阻塞 7 项 | 仅剩**隐私政策正文 + URL**（`253e632` 已出草稿，缺 **6 处**占位符，**只有李老师能填**）<br>🔴 **2026-09-19 round51 更正**：本行原写「4 处」为漏计；实扫 `上线材料_隐私政策_v1.md` 得 **6 处**（主体全称/邮箱/第一节客服方式/响应时限【15】/第九节客服方式/公网 URL）。round50 记忆写的「7 处」亦不准（把格式说明行的 `【】` 误计）。以 **6 处**为准。 |

⇒ 队列**已清空**。按纪律**不自创新批次**（8 批投喂收官、无「批次 8」；中优先级项明写"上线后 1 月内补"，
擅自开工 = 越权）。下一件真正的活 = **等李老师对 §4 与 §3.4 的裁示**。

## §6 本轮未落 / 存疑（不静默跳过）

- **未落**：给 dsh 投递 round39 三份 NOTE 的复审请求 —— 理由：dsh 后端不可用（§4）+ 李老师三选一未定。
- **未落**：R86 之外的云端操作 —— 理由：队列已清空，无需。
- **存疑**：dsh「是否进程僵死」—— 无法从 SPA 取得进程内状态判据；仅能证"静态层活、业务后端超时"。
- **存疑**：他人 2 个未提交文件（`REVIEW_2026-09-15_round38-verify.md` / `索引补齐核对单.md`）归属已判为**他人**，
  内容未读（避免误判他人进行中的工作），**不代提交**。
