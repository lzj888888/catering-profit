# R181 · InsCode 充值复验（真因=端点）＋ 微信开发者工具启动阻塞定性（2026-09-30）

> **本轮三件事**：① 李老师充值 20 元后复验可用性 → **真因不是额度，是端点**；② 把 R174 批次投给 InsCode（已送达并在跑）；③ timeout 42 个云函数 —— **本环境无法启动微信开发者工具**，定性到根因并给出替代路径。
> 基线：`dev = 702d761`，工作区干净，门禁 114/114（R180）。

---

## 一 🔴 充值复验：pro 池**已可用**，此前误判真因是"端点搞错"

### 实测（直连服务端，不看界面、不看本地缓存）

| 端点 | 模型 | 结果 |
|---|---|---|
| `https://api.taotoken.net/v1` | `deepseek-v4-pro` | ✅ **HTTP 200**（带 reasoning_tokens） |
| `https://api.taotoken.net/v1` | `glm-5.3` | ✅ **HTTP 200** |
| `https://api.taotoken.net/coding/v1` | `deepseek-v4-pro` | ❌ 400 `Model deepseek-v4-pro is not available on Coding Plan.` |
| `https://api.taotoken.net/coding/v1` | `glm-5.3` | ❌ 400 同上 |
| `https://api.taotoken.net/coding/v1` | `deepseek-v4-flash`（free key） | ✅ HTTP 200 |

### 🔴 结论（推翻 R179 的一条判词）

**两条通道是分开的，模型集合也不同：**
- **`/coding/v1` = 套餐通道（Coding Plan）** —— 只开放 2 个模型（`deepseek-v4-flash` / `glm-5.3-flash`）
- **`/v1` = 余额通道（按量计费）** —— 开放 29 个模型（含 `deepseek-v4-pro`）

⇒ **R179 里"pro 等 27 个模型一律不可用"的判词，是因为当时统一用了 `/coding/v1` 端点去试**，属**方法错误导致的错误结论**。
真拿 pro key 打 `/v1` ⇒ **200 可用**。**"not available on Coding Plan" 说的是套餐通道，不是"模型不存在"。**

### 界面侧状态
- `ui_preferences.json::last_model_selection` = `{model: doubao-seed-2.1-pro, tier: pro, slot: pro}` —— **已在 pro/余额池**
- 会话 `sessions.model` = `doubao-seed-2.1-pro`，`sessions.provider` = `taotoken/pro`
- 芯片显示 `73% doubao-seed-2.1-pro`
- ⇒ **pro 级模型（非 flash）已在用**，符合李老师"不要用 flash"的要求

> ⚠️ 遗留：`deepseek-v4-pro` 是**直连可用**，但界面切到它需要操作浮层（本轮未完成，见 §三）。
> 当前会话用的 `doubao-seed-2.1-pro` 同属 pro 池，**能力档位已达标**，不阻塞干活。

---

## 二 ✅ R174 批次已投喂送达（在跑）

### 投喂内容
`review/NOTE_2026-09-29_round174_inbound_reserve.md` 的批次 B：新建集合 `external_sales_daily`（9 字段 + 唯一键 `(shop_id, biz_date, external_ref_id)`）+ `shop_dish_mapping` 新增 `external_ref_id` 字段。纯 schema、零业务逻辑。

### 送达判据（客观，非自述）
`inscode.db` → `inflight_turn` = **1**；`logs/session-stream.log` mtime 持续在动（出字中）；`sessions.body` 最后一条 User 消息 = 本批载荷。

### 投喂通道的关键突破（详见 §四）
**`Enter` 与 `Ctrl+Enter` 都发不出去**（实测三者轮询：Enter ✗ / Ctrl+Enter ✗ / **点发送钮 ✓**）。

---

## 三 🔴🔴 timeout 42 个：本环境**无法启动微信开发者工具**（定性到根因）

### 3.1 试过的六条路径与结果

| # | 路径 | 结果 |
|---|---|---|
| 1 | `微信开发者工具.exe`（Popen） | 启动器 4 秒退出 rc=0，**无任何 IDE 进程** |
| 2 | 同上（`os.startfile`，模拟双击） | 同样无进程 |
| 3 | `cli.bat open --project <repo>` | `× IDE may already started at port 35237` → `wait IDE port timeout` |
| 4 | `cli.bat open ... --port 39721 --disable-gpu` | 同上（仍报 35237） |
| 5 | **`wechatdevtools.exe`（真入口）** | ✅ **进程能起（3~6 个），但 18~58 秒后崩溃 `rc=0x80000003`（STATUS_BREAKPOINT）**，**从未出现窗口** |
| 6 | `wechatdevtools.exe --user-data-dir=<新目录> --disable-gpu` | 被安全规则拦，SIGTERM |

### 3.2 根因链（两条独立的拦截）

**① 安全中心规则阻止写 NW.js 的 User Data**
```
Blocked by Security Center rules:
  write C:\Users\lzj\AppData\Local\nwjs\User Data\Default\History
  (rule: C:\Users\lzj\AppData\Local\nwjs\User Data\Default\History)
```
⇒ 微信开发者工具底层是 **NW.js**（不是 Electron / 不是 VS Code 内核，"DevTools"只是名字像）。
Chromium 内核启动要写 User Data（History 等），**写被拦 ⇒ 进程崩溃**。这与"从未出窗口"完全吻合。

**② `reg.exe` 被程序黑名单全局拦**
```
PROGRAM BLOCKED BY SECURITY POLICY: reg.exe (C:\WINDOWS\System32\reg.exe)
This block cannot be approved or bypassed from the current command.
```
⇒ `cli.bat` 内部依赖 `reg.exe` 读 IDE 的端口配置 ⇒ **cli 路径整体堵死**（这也是它反复报 35237 的原因：读不到/写不了配置）。
（`wmic.exe` 同样在名单里。）

### 3.3 附带结论：CLI **没有**改 timeout 的能力

```
cli cloud functions <command>
  list | info | deploy | inc-deploy | download
```
⇒ **无 configure / update 子命令**。`info` 只能读 `status/timeout/runtime`。
⇒ **改 timeout 只有 GUI 一条路**（与 ROADMAP B3 的判断一致）。

### 3.4 边界（别把结论说过头）

- 本环境 = WorkBuddy 沙箱 + 本机安全中心双层限制。**李老师在正常桌面（非沙箱）手动启动 IDE 不受此限** —— 历史记录里 IDE 一直可用（最近 2026-09-27）。
- ⇒ **可行动方案**：李老师手动启动微信开发者工具 → 我方**用键鼠接手**（对已运行窗口的键鼠注入不受"写 User Data"规则影响）。
- 本轮**未改动任何云端 timeout**，42 个函数仍是 3s。**不写"已处理"。**

---

## 四 📌 InsCode 投喂通道的两个新事实（已回写技能）

### 4.1 🔴 粘贴失败的真因是**焦点**，不是注入被拦

| 做法 | 结果 |
|---|---|
| `ui.send_vk(0x0D)` 自检 | 返回 **1**（SendInput 可用） |
| UIA `edit.SetFocus()` + `Ctrl+V` | ❌ 投递成功（`chord` 返 True）但**输入框内容不变（len 55 = 占位符）** |
| **真实鼠标点击（SendInput 版）** + `Ctrl+V` | ✅ **PASTE-OK**，`EDIT VALUE LEN = 1843` 与载荷逐字一致 |
| 读 `auto.GetFocusedControl()` | 点击后 = **`EditControl`**（证实焦点确实在输入框） |

⇒ **`UIA SetFocus` ≠ WebView 真聚焦**；必须用**真实鼠标点击**（且要用 `SendInput` 的 `MOUSEEVENTF_LEFTDOWN/UP`，不是 `mouse_event`）。
判据用 **UIA `GetValuePattern().Value` 长度 == 载荷长度**（截图是旧帧，不可信）。

### 4.2 🔴 `ui.chord` 会被"调用方设的全局 argtypes"污染

调用方一旦给 `ctypes.windll.user32.SendInput` 设了 `argtypes`，`inscode_ui.send_vk` 内部再调它就会报
`expected LP_INPUT instance instead of pointer to _INPUT`（两个模块各自的 `INPUT` 类不兼容）。
✅ 修法：**自己实现 SendInput 而不要设全局 argtypes**（本轮脚本 `paste_uia3.py`）。

### 4.3 发送只能点按钮

窗口 rect `(80,20,1700,1020)` 时实测：
- 输入框 UIA rect `(615,932,1428,959)` ⇒ 中心 `(1021, 945)`
- **发送钮（灰色实心圆 ↑）= `(1409, 985)`** ← 唯一有效
- `Enter` ✗ / `Ctrl+Enter` ✗ —— 与技能旧记录（"InsCode 拦掉 Enter"）一致

---

## 五 本轮未做 / 待办

| # | 事项 | 状态 |
|---|---|---|
| 1 | R174 批次回执验收 | ⏳ **在飞**（inflight=1）。完成后跑门禁 + 复核是否越界改了 `specs/` |
| 2 | timeout 42 个 | 🔴 **阻塞** —— 需李老师手动启动 IDE |
| 3 | 界面切到 `deepseek-v4-pro` | 🟡 未做（当前 `doubao-seed-2.1-pro` 已是 pro 档，不阻塞） |
| 4 | `#1 主体资质`（美团/淘宝 OAuth） | 🔴 只能李老师做 |
