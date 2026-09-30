# R181n · 小程序模拟器逐页走查 —— **未完成 · 卡在通道侧**

> 目的：把「阶段① 账单导入」的第二 tab 从**静态可读**推进到**动态可点**，顺带做 21 页 UI 走查
> （同时可验证 AD 门禁类排版问题、付费边界按钮文案）。
> **结果：没做成** —— 卡在自动化通道侧（非产品缺陷、非代码问题）。本目录如实留档，含 3 条**工具侧新事实**。

---

## 〇 一句话结论

**IDE 能拉起来、模拟器能跑起来、首页渲染完全正常**（见 `05_simulator_running_home.png`），
但 `miniprogram-automator` **连上后拿不到任何页面**（`getCurrentPages()` 恒为 `0`，`reLaunch`/`currentPage` 均报
`Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null.`）
⇒ **走查断在通道绑定层**，与仓内代码无关。

⚠️ 因此 **阶段② 的硬前置 ②（阶段① 真机/动态点一次）依然未解除**，本轮不算完成它。

---

## 一 做到了什么 —— 3 条**工具侧新事实**（都要回写技能）

### 事实 1 · 非沙箱 `cli.bat open --project` **能直接拉起 IDE GUI**（推翻技能旧表）
技能 `miniprogram-page-review` 的表里记着「`cli.bat open` 只起 headless server、GUI 仍为 0」，并据此把
「键鼠用户态启动（Win+R）」当成唯一正解。**本轮实测：非沙箱直跑即可**。

```
_r181n_cli.py open --project <repo>        → RC=0 · √ open · IDE server 127.0.0.1:39721
窗口枚举（win_gui.py list，DPI-aware，不信 tasklist）
  → 10816424  Chrome_WidgetWin_1  1875x1500  WeChat Web Devtools      ← GUI 真的出来了
_r181n_cli.py auto --project <repo> --auto-port 9420 --trust-project
  → √ auto · autoPort 9420 · √ Using AppID: wx33c110dc57a9c8dc        ← 号也对
```

⇒ **GUI 拉起不再需要键鼠**；键鼠那套降级为兜底。

### 事实 2 · IDE 项目窗口被挤成 **630×1034** 时，模拟器会废掉
次窗口枚举拿到的是 `630x1034 catering-profit`（此前正常为 `1875x1034`）。三栏被压扁、模拟器区白屏。
处置：`MoveWindow` 拉回 `1875x1034 @ (20,20)`（脚本 `_r181n_win.py`，**必须 `SetProcessDpiAwareness(2)`**）。

### 事实 3 · 「模拟器长时间没有响应」模态框的**恢复配方**（含实测坐标）
模态框文案：「模拟器长时间没有响应，请确认你的业务逻辑中是否有复杂运算，或者死循环」
按钮三个，**只认鼠标**（ESC / F8 无效）——本机窗口 1875×1034、原点 (20,20) 下的**实测坐标**：

| 按钮 | PNG 坐标（≡ 窗口相对） | 判定依据 |
|---|---|---|
| 关闭 | (768, 326) | OCR HIT `关闭 center=(768.0, 325.5)` |
| **终止模拟器** | **(918, 326)** | 色值剖面：灰填充 `(77,77,77)` 连续区间 x=837..998 |
| 暂停模拟器（绿） | (1095, 326) | 色值剖面：绿填充 `(87,189,106)` 区间 x=1014..1175 |

恢复链路（**实测有效**）：点「终止模拟器」→ 模拟器显示「模拟器处于终止状态，可点击工具栏上的编译按钮 ↻ 重新启动模拟器」
→ 点工具栏「普通编译」（OCR `center=(1706,152)`；⚠️ 点**文字**，点 caret 只会展开菜单）
→ 模拟器恢复，首页正常渲染。

🔴 **重要判据**：该模态框**不代表产品有死循环**。本轮它在**我尚未 Connect 之前**就已存在（首次预检即报同一错），
且恢复后首页渲染完全正常 ⇒ 它是**残留的模拟器状态**（旧会话 + 窗口被压扁），**差点被误报成产品缺陷**。

---

## 二 卡在哪 —— 通道侧绑定（判据全是实测）

`channel_diag_9432.log`（脚本 `probe_channel_diag_r181n.js`，逐项打点）：

```
connect: ok                                  ← WS 连得上
systemInfo: ok platform=devtools             ← 服务认得是 devtools
evaluate(1+1): 2                             ← 🔴 JS 上下文是活的（逻辑层没死）
getCurrentPages().length: 0                  ← 🔴 页面栈恒为空
currentPage: FAIL  Cannot destructure ... rawPath ... as it is null
reLaunch:    FAIL  同上
```

⇒ **能读上下文、读不到页面**。`evaluate` 通而 `getCurrentPages()=0`，
说明自动化服务绑到的上下文里**一个页面都没注册**，故 `getPageMetaByWebviewId` 返回 null。

---

## 三 已**排除**的原因（不是这些，别再试）

| 假设 | 判据 | 结论 |
|---|---|---|
| 端口 9420 上是「卡死那轮」的旧实例 | 换 `--auto-port 9431` 后 **9431 OPEN、9420 转 ERR**（`probe_wsport_r181n.js`） | 新实例照旧失败 ⇒ **不是旧实例** |
| 通道没预热够 | 完整 close→open→auto 后**静置 75s** 再连（技能称预热 60–90s） | 照旧失败 ⇒ **不是预热** |
| automator 版本旧 | `npm view miniprogram-automator version` → **0.12.1**，与本地**完全一致** | 0.12.1 **已是 npm 最新** ⇒ **无升级路径** |
| 我手工重启模拟器导致不受托管 | 改为 close→open→auto **由 CLI 自己拉起**模拟器 | 照旧失败 ⇒ **不是托管关系** |
| 页面真有死循环 | 恢复后首页渲染正常（截图） | **不是产品缺陷** |

---

## 四 明确**未验**（不许写成已完成）

- ❌ 21 页截图 / 按钮文案 / `actualPath` —— **一张都没拿到**（`report_channel_blocked.json` 只含失败预检）
- ❌ **阶段① 第二 tab 的动态可点性** —— 仍只有**静态**闭环（`app.json` 登记 + 入口 + 四步链 + i18n 单源）
- ❌ 「阶段② 硬前置 ②」**未解除**

---

## 五 证据清单

| 文件 | 内容 |
|---|---|
| `01_ide_630px_wedged_modal.png` | 被压扁到 630×1034 + 模态框（初始态） |
| `02_ide_resized_modal_buttons.png` | 拉回 1875×1034 后，模态框三按钮（用于取坐标） |
| `03_simulator_terminated.png` | 点「终止模拟器」后：提示点编译按钮重启 |
| `04_compile_dropdown.png` | 「普通编译」下拉展开（点 caret 的中间态） |
| `05_simulator_running_home.png` | 🔴 **模拟器跑起来了**：首页正常（默认店铺「耙三样」+ 三模块入口） |
| `channel_diag_9432.log` | 逐项 API 诊断（2 attempts，rc=1） |
| `channel_preflight.log` | 走查脚本预检失败输出（rc=4，**设计内拦截，避免盲跑 21 页**） |
| `report_channel_blocked.json` | 失败预检的 report（**非**走查结果，勿误读） |
| `probe_pagewalk_r181n.js` | 逐页走查脚本（页清单读 `app.json`；含预检 + 增量落盘 + 显式 exit） |
| `probe_channel_diag_r181n.js` | 通道逐项诊断 |
| `probe_wsport_r181n.js` | WebSocket 端口探针（**不凭猜**找 `wsEndpoint`） |

---

## 六 回执

- [2026-10-01 03:18] **R181n 未落** · 证据：`channel_diag_9432.log` → `connect ok` / `evaluate 2` / `getCurrentPages 0` / `reLaunch FAIL`（rc=1）；
  `channel_preflight.log` → `PREFLIGHT_FAIL ... rawPath ... null`（rc=4）· **21 页截图 0 张** · commit 见本次提交。
- **未落**：逐页走查 · 阶段① 第二 tab 动态可点性 · 阶段② 前置 ②。
- **存疑（写清理由，不静默跳过）**：通道为何绑不到页面**未定根因** —— 已排除「旧实例 / 预热 / 版本 / 托管关系 / 产品死循环」
  五条，剩下的可能落在 **IDE 版本与 automator 协议不匹配** 或 **本机 IDE 残留态**；
  下一步可试（均需人判风险）：① 升级/重装 IDE；② `cli cache` 清缓存（可能影响 IDE 会话）；
  ③ 换一台机验同一脚本以分离「机器态」与「版本缺陷」。
