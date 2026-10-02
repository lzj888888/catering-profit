# R188 附：模拟器 UI 走查（M3.31「每100g」界面呈现）

**日期**：2026-10-02 上午 | **环境**：dev `cloud1-d4gphpoxy337f2a25` | **AppID** `wx33c110dc57a9c8dc`
**驱动方式**：微信开发者工具自动化通道（`cli auto --auto-port 9420` + `miniprogram-automator` 0.12.1）

---

## 一 结论（一句话）

**M3.31「每100g」在界面上真的存在、能选中、文案正确** —— 三条独立判据全部成立；
顺带**突破了卡两轮的自动化通道**（见 §三），这条经验比走查本身更值钱。

---

## 二 三条判据（都可复现）

| # | 判据 | 实测 | 来源 |
|---|---|---|---|
| 1 | 规格行含 `per100g` | `specRows = [half 半份, small 小份, **per100g 每100g**]` | `mp.evaluate`（逻辑层实读，**两次独立**取得） |
| 2 | 界面**渲染**出「每100g」 | `$$('text')` 命中 `["半份","小份","每100g"]` | 同轮 |
| 3 | **能选中**（交互链路通） | `toggleSpec({spec:'per100g'})` → `enabled: false → true` | 同轮 |
| 4 | 文案正确 | `t.specPer100gUnit = "100g"` · `t.specPer100gNote = "按 100g 计价，实际按称重结算"` | 同轮 |

**视觉证据**：`03_spec_area.png` —— 「规格（大小份）」区可见三个 chip：**半份 / 小份 / 每100g**。

> 锚点数值（975/876）不在此重复验：那是引擎层的事，R185 已用生产引擎独立复算过（含反例 `coef.main=0.5 → 624`）。
> 本走查**只回答 UI 层**的问题：界面上有没有、看不看得见、点不点得动。

---

## 三 🔴🔴 重大发现：自动化通道的**正确入口是逻辑层 `wx.reLaunch`**

### 现象（复现 R181n 的"死局"）
```
connect        → ok
systemInfo     → ok  platform=devtools
evaluate(1+1)  → 2                      ← 逻辑层是活的
evaluate(getCurrentPages().length) → 0   ← 页面栈恒空
mp.currentPage() / mp.reLaunch()  → FAIL
   Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null.
```

### 突破：**绕开 `mp.reLaunch`，直接在逻辑层调 `wx.reLaunch`**
```js
await mp.evaluate(() => new Promise(res =>
  wx.reLaunch({ url: '/pages/card/edit', success: () => res('s'), fail: e => res('f') })));
// → success；随后 getCurrentPages().length 由 0 → 1，mp.currentPage() 也恢复正常
```
⇒ **根因不是"通道坏了"，而是 `mp.reLaunch()` / `currentPage()` 依赖页面元数据（pageMeta），
而本机 IDE（NW 0.54.1）与 automator 0.12.1 之间那份元数据取不到（恒 null）；
`mp.evaluate` 走的是另一条通道（逻辑层 eval），不依赖它，所以永远是通的。**

⇒ **可用能力矩阵（本机实测）**：

| 能力 | 走 `mp.*` API | 走 `mp.evaluate` 内调 `wx.*` / 页面实例 |
|---|---|---|
| 导航到任意页 | ❌ `rawPath null` | ✅ `wx.reLaunch` / `wx.redirectTo` |
| 读页面栈 | ❌ | ✅ `getCurrentPages()` |
| 读页面 state | ❌ `page.data()` | ✅ `getCurrentPages().at(-1).data` |
| 调页面方法（交互） | ❌ `element.tap()` | ✅ `p.toggleSpec({currentTarget:{dataset:{spec:'per100g'}}})` |
| 滚动 | — | ✅ `wx.pageScrollTo` |
| 截图 | ✅ `mp.screenshot()` | — |

### 两条操作纪律（本轮踩到）
1. **一次连接做完一件事**：反复 `connect/disconnect` 后，**第二次起 `evaluate` 就会 `timeout`**（实测第 2 页起连续 17 页全超时）。
   全 21 页走查应当**一次连接内顺序跑完**，而不是"每页独立 connect"（技能里那条建议在本机是**反效果**）。
2. **`cli auto` 后要预热 60–90s 再连**：刚起就 connect 会直接超时（实测）。

---

## 四 🔴 模拟器「长时间没有响应」模态框：本机**必然反复出现**

- 文案：「模拟器长时间没有响应，请确认你的业务逻辑中是否有复杂运算，或者死循环」
- **不是产品缺陷**：它在**还没 Connect 之前**就已存在；恢复后首页渲染完全正常。属**残留工具态**。
- **渲染层一卡，`mp.screenshot()` 就返回"旧帧"**（本轮 `01`/`04` 两张都拍到「加载中…」，
  而同一时刻逻辑层 `specRows` 读得好好的）⇒ **逻辑层 ≠ 渲染层**，两者要分开判。
- **恢复配方（本轮实测坐标可用）**：窗口 `1877×1034 @ (21,0)`，截图 PNG 尺寸 ≡ 窗口 rect
  ⇒ `屏幕坐标 = rect 原点 + PNG 坐标`：
  - 点「终止模拟器」(PNG 918,326 → **屏幕 939,326**)
  - 点工具栏「普通编译」文字 (PNG ~1729,147 → **屏幕 1750,147**)；⚠️ **这一下常只展开下拉菜单**，
    菜单第一项「普通编译」在 **屏幕 ~(1673,211)**，再点一次才真编译
  - 绿按钮（「暂停模拟器」）PNG 中心 **(1096,326)** —— 用它反推另两个按钮位置最稳（唯一高饱和色）
- ⇒ **重启后只有约 1–2 分钟可用窗口**，之后必再卡。要用就「重启 → 立刻连 → 一次跑完」。

---

## 五 明确「**没做到**」的（防下一轮误判）

| 没做到 | 原因 | 影响 |
|---|---|---|
| 全 21 页逐页截图 | 每页独立 connect ⇒ 第 2 页起通道超时（§三 纪律 1）；未按"一次连接跑完"重跑 | 走查覆盖度不足；`report.json` 保留原始失败记录 |
| per100g **端到端试算数值** | 需页面有原料明细（`buildCalcLines()` 空 ⇒ `calcSpecs` 直接 return）；构造明细成本高 | **不影响结论** —— 数值正确性由 R185 引擎侧复算负责 |
| 「每100g」**已启用态**截图 | 抢窗口期失败（`cli auto` 后未预热即连，超时） | 已有 `03_spec_area.png`（未启用态）+ 逻辑层 `toggleSpec` 生效证据 |
| 真机（手机）验证 | 仍属李老师 | 本走查是**模拟器**，不能替代真机；但已把"界面有没有"这一层问清楚了 |

---

## 六 建议项（**不是缺陷**，供拍板）

🔵 **规格区标题文案不再准确**：`pages/card/edit.js` 的 `t.specTitle` = **「规格（大小份）」**，
但备选规格现已是 **半份 / 小份 / 每100g** 三项 ⇒ 「大小份」概括不了「计重」。
- **判据**：`app.json` 21 页无此文案；单源在 `i18n/terms.js::card.specTitle`（改后需**双副本同步** `specs/dev-specs/i18n/terms.js`）。
- **建议**：改「规格（份量 / 计重）」之类，或直接用 `t.specHint` 承担说明、标题简化为「规格」。
- **不改也不影响功能**，属文案一致性；**我不代改**（写码归码方），仅登记。

---

## 七 归档

| 文件 | 内容 |
|---|---|
| `01_card_edit.png` | 编辑页首屏（**旧帧**，渲染层已卡 ⇒ 拍到"加载中"，保留以示区分） |
| `02_after_4000.png` | 编辑页正常渲染（表单全貌，`loading=false`） |
| `03_spec_area.png` | **关键证据**：规格区三个 chip（半份 / 小份 / 每100g） |
| `04_per100g_expanded.png` | 旧帧（同 `01`，渲染层卡） |
| `report.json` | 21 页走查原始记录（多为 `timeout`，如实保留） |
| `_pages_*.png` | 坏状态下的空帧（保留，作为通道限制的痕迹） |

**脚本（仓外，不进门禁面 B）**：`C:\Users\lzj\.workbuddy\binaries\node\mpauto\` 下
`diag_channel_r188.js`（通道诊断） · `diag_wxrelaunch.js`（突破验证） · `verify_per100g_ui.js`（本轮主脚本）
