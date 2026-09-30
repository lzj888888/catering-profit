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
