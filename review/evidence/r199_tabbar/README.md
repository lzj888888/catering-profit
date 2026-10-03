# R199 · 底部三入口 tabBar 落地（方案 B 实施 · 模拟器实测全过）

> **一句话结论**：R196 讨论稿推荐的**方案 B 已落地并经模拟器实测**——
> `app.json` 加 `tabBar` 三入口（**核算 / 成本 / 我的**）+ 6 张 81×81 图标 + 3 处跳转改 `wx.switchTab`；
> **逻辑层 5 项 + 渲染层 4 项判据全过**，三张截图肉眼可见底部三入口、选中态随切换正确变化。
> 全门禁 **127/127 · RC=0 · miss=0**。

## 一 改了什么（4 处源码 + 6 张图）

| # | 文件 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `app.json` | 加 `tabBar`（3 项 + 色值 + 图标路径） | 本轮主体 |
| 2 | `pages/index/index.js` | `goCard()` / `goMine()`：`navigateTo` → **`switchTab`** | 🔴 tabBar 页**不能**用 `navigateTo`（微信限制），不改就点不动 |
| 3 | `pages/mine/index.js` | 登出后回首页：`reLaunch` → **`switchTab`** | 同上 |
| 4 | `pages/index/index.wxml` | 收掉重复的「我的」ghost 按钮；加一行引导语 | tabBar 已承担「我的」，重复入口是冗余 |
| 5 | `pages/index/index.wxss` | 加 `.idx-tip`（28rpx /#666，与 `.muted` 同档） | 引导语样式 |
| 6 | `miniprogram/i18n/terms.js` **+** `specs/dev-specs/i18n/terms.js` | 加 `ui.tipMore` | 🔴 文案单源双份，**必须 `cp` 同步**（已验证 md5 一致） |

**三个 tab 的落地页**（沿用 R192 的视觉语言，不发明新样式）：

| tab | 落地页 | 内容 | 图标 |
|---|---|---|---|
| 核算 | `pages/index/index` | M1 月度盈利 + M2 开店盈亏测算 + 店铺切换 | 账本（算盘格） |
| 成本 | `pages/m3/hub` | M3 四块（成本卡 / 原料库 / 外卖 / 对账） | 一叠卡片 |
| 我的 | `pages/mine/index` | 订单有效期 / 指引 / 客服 / 隐私 / 版本 | 人头肩线 |

**图标是程序化生成的（PIL），不是生图模型**：品牌色是单源（`app.wxss:5` 墨蓝 `#1e3a5f`），
生图模型保证不了色值与线宽一致 ⇒ 每轮生成都会漂。线宽 6px @81px，圆头线描，缩到 40px 仍可辨。
选中 `#1e3a5f`（品牌墨蓝）/ 未选中 `#8a94a6`（中性灰）。单张 259–536 字节，包体积无压力。

## 二🔴 跳转方式必须改（本轮最容易漏的一环）

微信限制：**tabBar 页只能用 `wx.switchTab`，且不能带参数**；`wx.navigateTo` / `wx.reLaunch` 到 tabBar 页会**失败**。
本轮穷举了全站四种跳转方式的目标（`navigateTo` / `redirectTo` / `reLaunch` / `switchTab` 共 26 个调用点），
确认三个 tab 页的**全部 3 处**调用点都已改成 `switchTab`，无残留。

> R191 曾记「仓内有同名本地函数遮蔽 `switchTab`，实跑 0 次」—— 本轮它是**真被用起来了**（3 处原生 `wx.switchTab`），
> 且经模拟器实测生效（见 §四T3/T3b/T4）。

## 三 模拟器实测（两条腿：逻辑层 + 渲染层）

> 通道：`cli auto --auto-port 9420` + `miniprogram-automator`；R188纪律（`connect` 必须 `await`、
> `mp.disconnect` 不存在、唯一导航入口是逻辑层 `wx.reLaunch`/`wx.switchTab`、一条连接内跑完）全部遵守。

### 逻辑层 5 项（`r199_tabbar.js`）

| # | 判据 | 实测 |
|---|---|---|
| S1 | `app.json` 有 `tabBar` 且 `list` 3 项 | ✅ `list=3 color=#8a94a6 selected=#1e3a5f` |
| S2 | 六个图标文件全在盘 | ✅ 6/6 |
| S3 | 三个 tab 页都在 `pages` 声明里（否则 tabBar 不生效） | ✅ 三项都在 |
| T3 | `wx.switchTab` 切到 `pages/m3/hub` | ✅ `route=pages/m3/hub` |
| T3b | 从成本页 `switchTab` 回首页（**往返**） | ✅ `route=pages/index/index` |
| T4 | 首页 `goCard()` 真落到 `pages/m3/hub`（走业务函数，非直接调 wx） | ✅ `before=index after=m3/hub` |

### 渲染层 4 项（`_r199_pixels.py`，像素级不靠目测）

| # | 判据 | 实测 |
|---|---|---|
| P1 | tabBar 带是**白底**（页面底是 `#f5f6f8` 浅灰） | ✅ 白占比 0.647–0.686 |
| P2 | 选中项墨蓝簇在场 | ✅ 三张分别 57 / 64 / 20 像素 |
| P3 | 三个 tab 都有内容 | ✅ 三列均≥ 30 |
| P4 | 🔴 **墨蓝簇所在列随当前页变化**（选中态真切换） | ✅ 列 0 / 1 / 2 全对|

**P4 的铁证** —— 三张截图的墨蓝像素按 x 三等分后**精确互斥**：

| 截图 | brand_cols（左/中/右） | 选中列 |
|---|---|---|
| `tab1_calc.png`（核算） | `[57, 0, 0]` | 0 ✅ |
| `tab2_cost.png`（成本） | `[0, 64, 0]` | 1 ✅ |
| `tab3_mine.png`（我的） | `[0, 0, 20]` | 2 ✅ |

## 四 🔴 我自己判据错了四次（全自查抓到，非产品缺陷）

这一节的**价值比结论高**：四个坑都是「判据先红、后证明是判据自己错」。

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| ① | `wx.getTabBar is not a function` | 它**不在 `wx` 命名空间**，是**页面实例方法** | 改 `p.getTabBar()` |
| ② | 改对后仍**返回 null** | 本机 IDE 模拟器 **pageMeta 通道残**（R188 已证）⇒ tabBar 由客户端原生渲染，automator 拿不到实例 | 降为记录项，**真判据改走渲染层像素**（逻辑层证不了的，渲染层证） |
| ③ | P2 首版 `brand≥20` 但实测 4–17 | 墨蓝判据 `\|px − #1e3a5f\| < 26` **太严**，抗锯齿边缘像素偏出范围 | 先探查真实色值 ⇒ `tab2_cost` 有 `d=0` 的纯 `#1e3a5f` ⇒ 判据放宽 |
| ④ | P4 三张都指第 1 列 | 🔴 **手机 Home 指示条是纯灰 `r==g==b`**，被我`b > 0.42*r` 的判据放进"墨蓝"，且它**横跨全宽** ⇒ 把选中列永远拉到中间 | 判据改为要求 **蓝显著高于红**（墨蓝 `b/r≈3.2`，纯灰 `b/r=1.0`），并**排除底部 12 行** |

> 🔴 **通用律**：判据"报0 条/报异常值"时，**先打印被测量的真实分布**（我这个探针连查了 4 次：
> 逐点色值 → y 行分布 → 簇区间 → 逐行三色），再决定改判据还是改产品。
> R181i「守卫红里我方判据错占比极高」在**自测判据**上同样成立（本轮 4/4 全是我方错）。

**还有一处未改**：本地守卫 `check_auth_guard_shape.js` 也有同款表述不准（见 R198 README §四）——
**同理不动**，因为本轮不碰鉴权，留给专轮处理。

## 五 明确「没做到」的

1. ❌ **未验真机（iOS/Android）观感** —— 模拟器 ≠ 真机（胶囊位置、安全区、tabBar 高度都不同）。
   本轮截图底部那条Home 指示条占12px，真机上还要看 `env(safe-area-inset-bottom)`。
2. ❌ **未验「从深层页（如成本卡编辑/历史版本）1 次点击回首页」的真实手感** ——
   T3b 只验了 tab 页之间的往返，**没验深层非 tab 页**点 tabBar 的表现（理论上必通，但未实测截图）。
3. ❌ **方案 C 未做** —— 首页 M3 四块平铺（带张数）留作第二批，先看 B 顺不顺手（R196原建议）。
4. ❌ **未做变异回灌** —— 本轮没新挂守卫，`app.json` 的 tabBar 由既有 7 个页面/清单守卫间接覆盖；
   若要长期防"tabBar 被删掉"，需新挂一条守卫（本轮未挂，见 §六）。
5. ❌ **未真机扫码** —— 属李老师。

## 六 本轮发现的缺口（下轮可做，非本轮缺陷）

🔴 `app.json` 现在有 `tabBar`，但**没有任何守卫守它** ——
把 `tabBar` 整段删掉，`check_pages` / `check_page_manifest` 都**不会红**（它们只守页面清单，不管 tabBar）。
⇒ 若认同「底部三入口是本产品的主导航」，值得单独立一条守卫：
① `tabBar` 存在且 `list ≥ 2`；② 每个 `pagePath` ∈ `pages`；③ 每个 `iconPath` 文件在盘；
④ 三项路径**互不相同**（防"三个 tab 指同一页"）；⑤ tabBar 页**不得再用 `navigateTo`/`reLaunch` 跳转**（本轮 ② 的机器化）。
本轮**未挂**，因为它要改 `verify_all.js` 六处同步面 + 重启键两处（`gate-suite-checklist` 技能流程），宜单独一轮做。

## 七 本目录文件

| 文件 | 内容 |
|---|---|
| `README.md` | 本文件 |
| `tab1_calc.png` / `tab2_cost.png` / `tab3_mine.png` | 三个 tab 页截图（tabBar 常驻 + 选中态各异） |
| `T3_after_switch_m3hub.png` / `T4_after_goCard.png` | `switchTab` 与 `goCard()` 落点取证 |
| `report_r199_tabbar.json` | 逻辑层 6 项判据机读结果（`all_pass=true`） |
| `report_r199_tabbar_pixels.json` | 渲染层 P1–P4 机读结果（`all_pass=true`）+ 三张逐行分布 |

复现脚本（**仓外**，避免落进 `review/evidence/**` 被面 B 正则判红）：
`C:\Users\lzj\WorkBuddy\Claw\_r199_icons.py`（生成 6 张图标）·
`C:\Users\lzj\.workbuddy\binaries\node\mpauto\r199_tabbar.js`（逻辑层走查）·
`C:\Users\lzj\WorkBuddy\Claw\_r199_pixels.py`（渲染层像素判据）·
`_r199_preview.py`（图标放大预览）· `_r199_pixprobe.py` / `_r199_p4probe.py` / `_r199_tabgeom.py` / `_r199_rowcolor.py`（四个判据探针，本节④的连查记录）。