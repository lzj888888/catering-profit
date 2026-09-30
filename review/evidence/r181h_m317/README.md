# R181h · M3.17 外卖单均 + M3.32 投喂取证（2026-09-30 17:4x）

## 结论

**投喂成功**。批次 D（M3.17 外卖单均 + M3.32 补贴拆行/固定佣金）已送达 InsCode，模型 `deepseek-v4-pro`、余额通道 `pro`。

## 硬判据（全部机器读数）

| 判据 | 值 | 出处 |
|---|---|---|
| 余额探针 | `HTTP 200`（`/v1` + `pros[0]` + `deepseek-v4-pro`） | `balance_probe.py` |
| `inflight_turn` | 0 → **1** | `probe_delivery.py` |
| `sessions` User 条数 | 13 → **14** | `probe_delivery.py` |
| 末条 User 长度 | **4204**（载荷 4205，尾部空行差 1） | `probe_delivery.py` |
| 首/尾行逐字 | 与 `feed_m317.txt` 一致 | `probe_delivery.py` |
| `turn_telemetry.model` | `deepseek-v4-pro` | `probe_delivery.py` |
| `taotoken_plan` / `provider_host` | `pro` / `https://api.taotoken.net/v1` | `probe_delivery.py` |

## 载荷

`feed_m317.txt`（4205 字符）。内容 = 批次 D 自包含提示词：
- 依据 `开发规范v1.1_...§M3.17`（198~266 行）+ `v1.2_...§M3.32`（146~173 行）+ `§M3.39 红线 14~17`
- 新建 `utils/takeawayDerive.js`（纯计算单源：`calcTakeawayOrder` / `resolveCommission` / `reverseListedPrice`）
- 双口径并列（到手 / 总额法），🔴 不混数；佣金基数**恒为商品总价**；`fixed` 模式保底不生效
- 补贴拆 `s_user` / `s_merchant`，**承担方未选 ⇒ 不计入**（fail-closed）
- 🔴 试算不落库、不新建集合；平台参数存 `shop_switch::m3_takeaway_params`
- 锚点 B-a 150 分 / 实收 1800 / 利润 365 / 到手率 66.67%；B-b `P* = 2963 分`
- 新守卫 `tools/selftest_m3_takeaway.js`（T-a…T-g）

## 本轮踩到并解决的坑（重要，已回写技能）

投喂一度**连续 5 次零效果**（点击与粘贴对界面零变化）。逐项排除后的真因链：

1. **不是 DPI**（`probe_cursor.py`：DPI 后 `metrics=1920x1080`，`SetCursorPos` 三例均无 clamp）
2. **不是注入被拦**（`probe_inject.py`：`Ctrl+M` 前后 diff = **15785**，模型浮层真的弹出）
3. **是输入框几何判断错**。用「裁图放大肉眼读」定出真值（窗口 rect `(20,20,1640,1020)` 下）：
   - **输入框**：`x 532~1380`、`y 924~988`（占位符文字行 y≈944）
   - **发送钮**：圆心 ≈ `(1336, 981)` ⇒ **窗口相对 `(R-300, B-39)`**
   - 旧脚本硬编码的 `(bx-330, by)` 与 `y=B-2` 全落在框外 ⇒ 5 个候选点**全部脱靶**
4. **灰色判据只在输入框为空时成立**：有内容时按钮变黑（`(15,17,25)`）⇒ 判据放宽为「灰 **或** 近黑」
5. **截图判据有陷阱**：全屏 diff 要**裁到目标区域**才有意义；裁错区域会得 0 而被误读成"完全没反应"

**修复后的可复现配方** → `feed317.py`（前置窗口 → `MoveWindow(20,20,1620,1000)` → 相对几何点击输入框 → `Ctrl+A`+`Del` 清空 → **`Shift+Insert`** 粘贴 → 像素校验 → 点发送 → DB 复核）。

## 文件清单

| 文件 | 作用 |
|---|---|
| `feed_m317.txt` | 投喂载荷（4205 字符） |
| `feed317.py` | 投喂主脚本 v2（相对几何 + 像素校验 + DB 复核） |
| `balance_probe.py` | 投喂前余额探针（1-token，200 即可投） |
| `probe_inscode.py` | InsCode DB 状态探针（表/行数/inflight） |
| `probe_delivery.py` | 送达核验（末条 User 逐字 + 模型/通道） |
| `probe_cursor.py` | DPI 与光标 clamp 验证 |
| `probe_inject.py` | 键盘注入可用性（Ctrl+M 浮层 diff） |
| `probe_input.py` / `probe_focus.py` | 早期失败探测（坐标脱靶留档） |
| `enum_windows.py` | 顶层窗口枚举 + 截图新鲜度 |
| `crop_bottom.png` / `crop_bottom_left.png` | 输入框区放大图（几何真值来源） |
| `v2_0_before.png` … `v2_3_after_send.png` | 投喂过程截图留证 |

## 回执（本轮）

- `[2026-09-30 17:4x] R181h 已落` · 证据：`balance_probe.py` → **HTTP 200**；
  `feed317.py --send` → DB before `(0,13,134)` → after+4s `(1,14,134)`；
  `probe_delivery.py` → 末条 User **4204** / payload 4205、`model=deepseek-v4-pro`、`plan=pro`。
- `[2026-09-30 17:5x] R181h 已落` · A6 调研 → `review/NOTE_2026-09-30_B2开放平台主体资质调研.md`
  （B2 收窄成「照抄即可问」的问句；美团外卖侧门槛已查实，淘宝侧已查实）。
- **未落 / 待办**：① 🔴 **门禁全量未跑**（投喂时 InsCode `inflight=1`，按纪律等回执后一并跑）；
  ② InsCode 产出（`utils/takeawayDerive.js` / `tools/selftest_m3_takeaway.js`）**尚未验收**，当前在飞；
  ③ 决策面板余项仍待李老师拍板。
- **存疑**：美团「个人开发者」通道的能力边界（是否含商家私有订单）**官方文档未写明**，
  本调研**标为待实测、未下结论** —— 不拿它当"路已通"的依据。

## 待办

- 等 InsCode 回执 → 复核（红线三条 + 锚点独立复算 + 门禁 N/N + 变异回灌）→ 提交。

---

# R181h-2 · 充值后续跑（2026-09-30 18:0x–18:4x）· 「打错窗口」事故 + 恢复成功

## 结论

李老师 17:5x 充值 50，指令「让它继续工作」。**续做指令已发出，InsCode 此刻正在跑 M3.17**
（UI 可见 `自测 21/0 全绿。现在补齐剩余部分。先看 shop_switch 读写机制（saveShopSetting / getShopContext）`
＋ 连续 Read/grep/sed，发送钮变停止方块）。

## 一、断因诊断（先读遥测，别信界面文案）

`turn_telemetry` 最新行：

| 字段 | 值 |
|---|---|
| `stop_reason` | **`ProviderError`** |
| `error_category` | **`balance_insufficient`** |
| `error_code` | `Free quota exhausted and balance too low, please recharge compute credits.` |
| `duration_ms` / `input_tokens` / `output_tokens` | 471101 / 3,627,427 / 22,890 |
| `model` / `taotoken_plan` | `deepseek-v4-pro` / `pro` |

⇒ 就是**欠费掐断**（HTTP 429）。充值后 1-token 余额探针恢复 `HTTP 200`。

## 二、🔴🔴 事故：连投 6 次全零反应 —— 真因是**点击/按键打在了 WorkBuddy 上**

逐项排除（全是误诊）：DPI 正常（`SetCursorPos` 无 clamp）、注入没被拦（SendInput 发 Win+R 弹出了运行框）、
窗口消息泵活着（`WM_NULL → 1`）。**真因**：WorkBuddy 在**每次我方工具调用后抢回前台**，
而旧脚本收尾把 InsCode 从 TOPMOST 降回普通层级 ⇒ 我方点击/按键**全打在 WorkBuddy 窗口上**。

铁证（`probe_dead.py`）：

| 动作 | diff | 真相 |
|---|---|---|
| 点「搜索」 | **1,000,559** | 变的是 **WorkBuddy 的侧栏**（假证：看着"鼠标有效"） |
| 点「插件」 | 137,411 | 同上 |
| 点 composer | **0** | 打在 WorkBuddy 空白区 ⇒ 被误判成"粘贴通道坏了" |

**两个破法（已固化）**：
1. **投喂全程 `SetWindowPos(h, HWND_TOPMOST=-1, …)` 钉住**，发完才 `-2` 释放（`send_resume.py`）。
2. **点位归属两段校验**：① 窗口归属 `WindowFromPoint`→`GA_ROOT == h`；
   ② **页面归属** `ocr_screen find 描述你的任务` —— 因为探针已把 InsCode 点进了**它自己的「插件」页**，
   那里**没有 composer**，一切粘贴必然 diff=0，与"注入坏了"无法区分（`evidence_02_wrongpage_plugin.png`）。

## 三、`sessions` 快照在 429 中断后会**回退**（第二坑）

M3.17 载荷确已发出（当场读到 `inflight 0→1`、User 13→14）；
**被掐断后**再读 DB：User 退回 **13**、末条 User 变回上一条 **3598** 字符 —— **而 UI 里那条消息还在**。
⇒ 判「载荷还在不在会话里」**看 UI**；DB 只用于判"发出没有 / 在不在跑"。

## 四、恢复流程（每一步都实测过）

| 步 | 动作 | 关键判据 / 坑 |
|---|---|---|
| 1 | 点侧栏「搜索」→ **Ctrl+K 命令面板** → 点「**最近**」第一条 | ⚠️「推荐」第一条是「**新建任务**」，误点 ⇒ 切新会话页（丢上下文 + 模型被改默认值）；**面板不吃 Esc/Enter**，只能鼠标点 |
| 2 | **`Ctrl+M`** 打开模型选择器 → `ocr_screen find` 定位 → 点 `deepseek-v4-pro`（中心 **1291.5, 542.5**） | ⚠️**点芯片常常不弹**，Ctrl+M 稳；点完**必须再截一次图确认**（浮层 ~1.8s 才关、芯片才更新） |
| 3 | 清 composer 残留（我误打进去的 `ab`） | ⚠️`Ctrl+A`/`Del` **无效**（残留疑似**输入法未上屏候选**）⇒ 有效法 = **`Esc` → 点框 → 连点 3 下 → `Del` + `Backspace`×6**（实测 diff 4677，占位符回归） |
| 4 | 发**「续做」载荷** `feed_m317_resume.txt` | 短指令（点名两个**未跟踪**产物让它自查现状）+ **原文全文**（防遗漏）= 5159 字符 |
| 5 | 发送后判据 | 粘贴 diff **5616**、`inflight 0→1`、User **15→16**、末条 User **5158 逐字一致**、UI 发送钮变**停止方块** |

## 五、硬判据（全部机器读数）

| 判据 | 值 | 出处 |
|---|---|---|
| 余额探针 | `HTTP 200` | `balance_probe.py` |
| 粘贴像素校验 | diff **5616**（bbox 覆盖输入框文本区 29,0→954,55） | `send_resume.py` |
| `inflight_turn` | 0 → **1** | `send_resume.py` |
| `sessions` User 条数 | 15 → **16** | `send_resume.py` |
| 末条 User 逐字 | **5158 == 载荷去尾换行** | `probe_verify_resume.py` |
| `sessions.model` / `provider` | `deepseek-v4-pro` / `taotoken/pro` | `probe_verify_resume.py` |
| `inflight_turn.pre_turn_git_sha` | `f493e5a…`（= 我方最后一次提交） | `probe_verify_resume.py` |
| UI 层 | 发送钮变**停止方块** + 「正在运行 sed -n …」 | `evidence_01_inscode_running.png` |

## 六、⚠️ 附带的自身损失（如实记录，不遮）

`turn_telemetry` 多出一行 **`stop_reason = Cancelled`**（34.9s，末条 Assistant = `bash: cancelled before completion.`）——
**很可能是我导航时误点了停止钮**，掐掉了"充值后自动续跑"的那一轮。已用第 4 步的干净续做补上。

## 七、判据截图（入库的 9 张 `evidence_*.png`）

| 文件 | 证明什么 |
|---|---|
| `evidence_01_inscode_running.png` | InsCode 真在跑 M3.17（发送钮=停止方块、正在读 `saveShopSetting`） |
| `evidence_02_wrongpage_plugin.png` | 被点进「插件」页 ⇒ 无 composer ⇒ 粘贴必然 diff=0（事故真因之一） |
| `evidence_03_workbuddy_stole_front.png` | WorkBuddy 压在最前（事故真因） |
| `evidence_04_ctrlK_recent_list.png` | Ctrl+K 面板「最近」列表（回会话的入口） |
| `evidence_05_ctrlM_model_selector.png` | Ctrl+M 模型选择器（含 `deepseek-v4-pro`） |
| `evidence_06_model_back_to_v4pro.png` | 模型已切回 `deepseek-v4-pro` |
| `evidence_07_composer_cleared.png` | 输入框已清空（占位符回归） |
| `evidence_08_back_to_conversation.png` | 已切回目标会话（可见 M3.17 用户消息） |
| `evidence_09_payload_pasted.png` | 续做载荷已进输入框 |

⚠️ 其余 143 张为**过程截图**，按项目既有决定（同 r86 `_gui/`、`_m3/`）**不入库**，
已在 `.gitignore` 加机械保证（**未删除、未移动**任何文件）。

## 八、回执（R181h-2）

- `[2026-09-30 18:0x] R181h-2 已落` · 证据：`probe_error.py` → `error_category=balance_insufficient` + HTTP 429；
  `balance_probe.py` → **HTTP 200**；`send_resume.py --send` → DB `(0,15)` → `(1,16)`、粘贴 diff 5616；
  `probe_verify_resume.py` → 末条 User **5158 逐字一致**、`model=deepseek-v4-pro`。
- `[2026-09-30 18:4x] R181h-2 已落` · 回写：技能 `inscode-desktop-feed`（新增整节「429/欠费中断后的『续做』恢复 + 『打错窗口』事故」）、
  `MEMORY.md` §8 三条红线 + §12 决策流水、今日日志 `2026-09-30.md`。
- **未落 / 待办**：① 🔴 **门禁全量未跑**（InsCode `inflight=1`，按纪律等回执后一并跑）；
  ② InsCode 产出未验收（在飞）；③ 决策面板余项待拍板。
- **存疑**：第 3 步清空法对本机输入法状态的依赖未穷尽（只证了"当前状态下有效"）；
  若换机器/换输入法需重测。

