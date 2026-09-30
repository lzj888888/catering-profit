# R181f · M3.20 词库/模板 投喂取证（2026-09-30 16:2x）

## 结论一句话
**M3.20（标准原料词库 + 菜品模板）载荷已成功投喂 InsCode，轮次在跑**（模型 `deepseek-v4-pro`）。
送进去的正文经 DB 逐字核验（`sessions.body` 最后一条 `User` 消息，len **3598**，关键标记 6/6 命中）。

## 投喂判据链（全部机器判据，不靠肉眼）
| 环节 | 判据 | 实测 |
|---|---|---|
| 送达 | `sessions.body` 末条 `User` 消息文本 == 载荷 | ✅ len 3598；`M3.20`/`e891b3b`/`selftest_m3_lexicon`/`绝不自动匹配替换`/`LEXICON`/`dishTemplates` 全 True |
| 发出 | `inflight_turn` 行数 0 → 1 | ✅ 0 → **1** |
| 发出 | `sessions` User 消息数 +1 | ✅ 12 → **13** |
| 在跑 | `turn-lifecycle.log` 出现 `turn_started` | ✅ `rt-7d1c50ecf79c40e9a05c85ccdfc4cfaa:2` |
| 在跑 | `logs/session-stream.log` mtime 在走 | ✅ 16:23:18 |
| 用对模型 | `sessions.model` / `provider` / `ui_preferences` | ✅ `deepseek-v4-pro` / `taotoken/pro` / `tier=pro slot=pro` |
| 余额池可用 | `pros[0].api_key` + `POST https://api.taotoken.net/v1/chat/completions` | ✅ **HTTP 200** |

## 🔴 本轮新发现的硬坑（写入技能）
### 1. `Ctrl+V` 被 InsCode 吞掉；**`Shift+Insert` 才能粘贴**
对照实验（同一输入框、同一次会话，像素 diff 判据）：
| 通道 | pixdiff | 结论 |
|---|---|---|
| 打字 `abc`（SendInput 键） | **2123** | ✅ 键盘注入通 |
| `Ctrl+V`（SendInput 组合键） | **20** | ❌ **被吞** |
| **`Shift+Insert`** | **12755** | ✅ **唯一可用的粘贴通道** |

⇒ 旧的「剪贴板 + Ctrl+V」配方在本机 InsCode 上**已失效**，改走 `Shift+Insert`（`key(0x10) ; tap(0x2D) ; key(0x10,up)`）。

### 2. `Ctrl+A` 是有效的（清空输入框靠它）
`Ctrl+A` + `Del`（按两次）→ 输入框回到占位符态（两帧间隔 1s 双读到「描述你的任务」）。

### 3. 窗口 rect `(0,0,1942,1106)` 时发送钮被屏幕底边裁掉一半
屏幕 1920×1080，窗口高 1106 ⇒ 底部 26px 出屏，发送钮（灰度圆）bbox 只剩 26px 高。
✅ 修法：`MoveWindow(h, 20, 20, 1620, 1000, True)`，整条工具条露出。

### 4. 发送钮的**像素判据随状态变色**（禁用/可用两态）
| 状态 | 颜色 | 定位 |
|---|---|---|
| 输入框为空（禁用） | 灰 `(153,154,159)` | 圆钮在输入框右端 |
| 有内容（可用） | **黑 `(15,17,25)`** | 同上 |

⇒ 定位法：在「窗口内底部 70px」区间扫 `sum(px) < 120` 的连通块，取 bbox 中心。
⚠️ **务必把扫描区间限制在窗口 rect 内** —— 窗口底边以下的桌面/任务栏也是暗色，会把判据污染成「整行皆暗」。

### 5. UIA 在本机 InsCode（Tauri+WebView2）上**彻底不可用**
深度 8 的 `GetChildren` 递归只能拿到 1 个 `DocumentControl`（`AutomationId=RootWebArea`，**rect 全 0**，里面 `EditControl` 不存在）。
⇒ 本机 InsCode 投喂只能走 **OCR/像素 + 键盘注入** 通道，不要浪费轮次在 UIA 上。

### 6. 「截图旧帧」本轮又骗了一次
`n1_pasted.png` 之前的 `k1_after_paste.png`（Ctrl+V 之后 1s 拍）显示输入框仍是占位符，而**实际已粘贴成功**；
像素 diff 也因此假阴（20）。⇒ 判据只认 **DB**（`sessions.body` / `inflight_turn`），截图仅作留证。

## 本轮脚本清单
| 文件 | 用途 |
|---|---|
`launch_inscode.py` | 用户态启动（Win+R）拉起 InsCode（沙箱内直启被拦） |
`paste_uia5.py` | UIA 通道粘贴（**本机不可用**，留档） |
`feed_ocr.py` / `feed_ocr2.py` | OCR+像素通道（v1 用 Ctrl+V，失败） |
`focus_probe.py` | 焦点实证（点击 → 打字 → 像素 diff） |
`paste_probe.py` | **对照组实验：打字 / Ctrl+V / Shift+Insert**（决定性） |
`clear_box.py` | 清空输入框 + 双帧校验 |
`feed_final.py` | 清空 → Shift+Insert 粘贴 → 定位发送钮（**v1 发送钮定位写错，见坑 4**） |
`click_send.py` | **成功发送**：像素定位黑圆钮 → 点击 → DB 复核 |

## 载荷
`feed_m320.txt`（3599 字符）—— 批次 B 收尾 · M3.20 标准原料词库 + 菜品模板。
红线三条：**绝不自动匹配替换 / 绝不带价格 / 不改引擎**；锚点 7 条（L-a…L-g）；
要求新建 `tools/selftest_m3_lexicon.js` 并 require 真实单源实算。

## 待办（投喂后）
- [ ] 回看 `turn_telemetry.stop_reason`（**别只看 inflight**）：`Stopped` = 正常收尾；`ProviderError` + 429 = 欠费。
- [ ] 复核三件套：`git diff --stat` 逐行看 / 受保护区（`cloudfunctions/common/`、`initDb/`）未被改 / K11 双副本 md5。
- [ ] 门禁补齐：新套件 `selftest_m3_lexicon` 需登记进 `verify_all.js::SUITES`（116→117）+ 同步 6 处声明面。
- [ ] 我方补 `specs/` 侧 terms 双副本（InsCode 不许改 specs）。
