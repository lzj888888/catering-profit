# R181c · M3.16 套餐投喂证据（2026-09-30 08:0x）

## 投了什么

| 项 | 值 |
|---|---|
| 批次 | **C · M3.16 套餐成本卡（引用型卡）** |
| 载荷 | `feed_m316.txt`（64 行 / 5439 字节 / **3130 字符**）|
| 依据 | `specs/dev-specs/core/开发规范v1.1_ModuleM3增量_*.md` §2 / §M3.16 / §M3.24 / §M3.25 / §M3.26 |
| 范围 | `initDb/collections.js` 字段登记（`card_type` / `line_type` / `sub_card_ref` / `sub_version`）+ 新建单源 `common/comboDerive.js` + `saveCostCard`/`getCostCard` 套餐校验与返回 + `pages/card/edit` 子卡行 UI + 接 `m3_combo` 付费墙 |

## 投喂判据（全部机器可读，不用截图）

| 步骤 | 判据 | 实测 |
|---|---|---|
| 粘贴 | UIA `GetValuePattern().Value` 长度 == 载荷长度 | **3130 == 3130 ⇒ PASTE-OK** |
| 发送 | 点发送钮 `(1411,981)` 后读 `inscode.db::inflight_turn` | **0 → 1** ⇒ 已送达并开工 |
| 模型池 | `ui_preferences.json::last_model_selection` | `doubao-seed-2.1-pro` / `tier=pro`（**非 flash**）|

## 🔴 本轮新实测的坑（已回写技能）

1. **`paste` 会偶发失败，且必须"重试一次"再换方案**。
   首次跑 `paste_uia3.py` ⇒ `click n = 2` / `ctrl+v n = 4` / **`after len = 55`（占位符）/ PASTE-FAILED**；
   原样重跑**一次** ⇒ **`after len = 3130` / PASTE-OK**。
   ⇒ 判据失败时先**原样重跑**，不要立刻改坐标/改投递方式（本轮在坐标上白绕了数轮）。

2. **`EditControl` 的 UIA 引用会 stale**。`doc.EditControl(searchDepth=25)` 可能抛
   `COMError (-2146233083)`（元素已失效）⇒ 必须**每次调用前重新取 doc/edit**，不要把引用跨步骤缓存。

3. **`python` 输出到管道是块缓冲，SIGTERM 会整段丢输出**。诊断脚本被工具超时杀掉时**看不到任何 print**
   （本轮两次"无输出 + SIGTERM"的真因）⇒ 一律加 **`python -u`**。

4. **截图再次被骗**（第三次）：`shot1_oldframe.png` 显示"输入框浮在窗口中央、且里面已有 M3.16 全文"，
   而 UIA 事实是"输入框在底部 `(1021,945)`、当时为空" ⇒ **截图是旧帧，不可作任何判据**。

5. **发送钮的权威坐标** = UIA `ButtonControl '发送'` rect `(1395,965,1428,997)` ⇒ 中心 **`(1411,981)`**
   （与技能记的 `(1409,985)` 一致）。点它之前**输入框必须非空**，否则钮为禁用态、点了 `inflight` 不变。

## 文件

- `feed_m316.txt` —— 投喂载荷原文（自包含：目的 / 依据 / 7 条改动点 / 4 个复算锚点 / 红线 / 门禁要求 / 回执格式）
- `send_m316.py` —— 点发送钮 + 读 `inflight` 判据
- `try_setvalue.py` —— 诊断脚本（暴露 stale element 的 COMError；`-u` 才看得到输出）
- `find_send.py` —— UIA 定位发送钮（`ButtonControl '发送'`）
- `shot1_oldframe.png` —— **反例留存**：旧帧截图，证明"截图不可作判据"

---

## 第二轮（08:1x–08:2x）· 切模型 + 重新投喂

### 🔴 第一轮投喂其实**失败了**（原因：欠费，不是模型）

`turn_telemetry` 铁证（`inscode.db`）：

| turn | 起 | 时长 | stop_reason | rounds | model |
|---|---|---|---|---|---|
| 22（R174 那次） | 01:51 | **2833 s** | `Stopped` | 79 | doubao-seed-2.1-pro |
| 23 | 07:35 | 604 s | `ProviderError` | 15 | doubao-seed-2.1-pro |
| **24（本轮第一投）** | 07:56 | **9.4 s** | `ProviderError` | 1 | doubao-seed-2.1-pro |

turn 24 `error_detail` = `HTTP 429: insufficient_quota / Free quota exhausted and balance too low`。
⇒ 当时看到的 `inflight 0→1` 只代表"送进去了"，**随即因余额不足失败**。

`probe_pro2.py` 实测（充值后）：`pros[0].api_key` + `https://api.taotoken.net/v1` + `deepseek-v4-pro` → **200 ✅**。

### 模型切换：`doubao-seed-2.1-pro` → `deepseek-v4-pro`

- 浮层打开：**`Ctrl+M`**（点工具栏 `ButtonControl '切换模型 (Ctrl+M)'`（rect `(1207,965,1390,997)`）**不必然打开**）
- 目标条目：`MenuItemControl 'deepseek-v4-pro'`，rect `(1212,520,1474,561)`，中心 **`(1343,540)`**
- 🔴 **落盘很慢**：点击后 **3.5 s** 读 `ui_preferences.json` **仍是旧值**，>10 s 才变 ⇒ 别急着判"没切成功"
- 判据：`ui_preferences.json::last_model_selection.model == 'deepseek-v4-pro'` ✅

### 重新投喂（成功）

- `paste_uia4.py`（**`RootWebArea` 优先选 doc** + EditControl rect 非零校验 + 3 次重试）⇒ 一次 **PASTE-OK（len 3130）**
  ⚠️ 关键修复：`EnumChildWindows` 会先捞到 `Chrome_RenderWidgetHostHWND` 那个 DocumentControl，
  其 `EditControl` rect = `(0,0,0,0)` ⇒ 旧脚本因此判 `PASTE-FAILED`
- 点发送钮 `(1411,981)` ⇒ `inflight = 1`，**起跑 08:18:05**（对比失败那次仅 9.4 s）
- 旁证：`git status` 显示 `M cloudfunctions/common/errors.js` ⇒ 写码方已在动工
