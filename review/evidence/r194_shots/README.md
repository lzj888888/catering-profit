# R194 附：模拟器走查（店铺切换页三动作 + 「我的」页头像）

**日期**：2026-10-03 上午 | **环境**：dev `cloud1-d4gphpoxy337f2a25` | **AppID** `wx33c110dc57a9c8dc`
**驱动**：微信开发者工具自动化通道（`cli auto --auto-port 9420` + `miniprogram-automator` 0.12.1）
**判定方式**：`wx.createSelectorQuery().boundingClientRect()` **机读真实布局矩形**为主，截图为辅。

---

## 一 一句话结论

`pages/shop/switch` 的三件事（建店 / 重命名 / 删店）**在界面层真能走通**，
但走查**抓到 3 个真缺陷**（2 个是本轮新代码的，1 个是既有页面的），已全部修复并**双向变异回灌**验证。

---

## 二 走查抓到的缺陷（全部带实测数字）

### 🔴 缺陷① 重命名行布局崩坏：输入框被挤成 20px、第 2 个按钮顶出卡片

| 判据 | 修复前（定向变异态） | 修复后 |
|---|---|---|
| `.edit-inp` 宽 | **20px**（left 24 → right 44） | 164px（24 → 188） |
| `.edit-btn` #1 | 184px（50 → 234） | 83px（194 → 277） |
| `.edit-btn` #2 | 184px（240 → **424**） | 83px（283 → **366**） |
| 卡片内部右边界 | 366 | 366 |

⇒ 修复前第 2 个按钮右边界 **424 > 366**，**溢出卡片 58px 且被屏幕右缘裁掉**（真机上更窄的机型溢出更多）。

**根因（R194 原始表述，保留留痕）**：`<button>` 带**固有宽度 184px**，且其优先级**高于页面 wxss 里的普通 `width`/`min-width`**：

| 写法 | 实测结果 |
|---|---|
| `width: 140rpx; min-width: 140rpx`（无 `!important`） | ❌ 仍 **184px**（完全无效） |
| `width: 200rpx !important; min-width: 200rpx !important` | ✅ 104px |
| `flex: 0 0 160rpx`（**无需 `!important`**） | ✅ 83px ← **采用** |

> 🔴🔴 **R195 更正（本段结论已升级，R194 原文保留不删）**：上表的「固有宽度压过普通 width」方向是对的，
> 但**真正可操作的规则是「压过的是 _单类选择器_ 的 `width`」，且与父层是否 flex 容器无关**。
> 反证（R195 三处同型样本，机读矩形见 `review/evidence/r195_shots/report_r195_{,pay_}{BEFORE,AFTER}.json`）：
> - `pages/pay/orders.wxss::.btn-block` 父**非 flex** 容器，单类 `width:100%` **同样失效**（184px / 父 366px）
>   ⇒ 推翻「只在 flex 容器内才失效」；
> - `pages/month/index.wxss::.banner .btn-small` 父**非 flex**，但因是**双类**选择器 ⇒ **生效**（83px）。
>
> ⇒ **两条修法按场景选**：flex 容器内 → `flex: 0 0 <b>`（本处 `.edit-btn` 走这条）；
> 非 flex 容器内 → **把选择器提到双类**（如 `.btn.btn-block`，R195 已用此法修 `orders.wxss`，184 → 342）。
> ⚠️ `!important` 这条路只在 R194 的 flex 样本上验过，**非 flex 场景未验**，别当第三条路。

**修法**：`pages/shop/switch.wxss::.edit-btn` 改用 `flex: 0 0 160rpx`（仓内此前**零** `!important` 先例，故不引入）；
新建行按钮独占一行 ⇒ 加 `.edit-row.fill .edit-btn { flex: 1 1 0 }` 让两个按钮平分（否则 UA 的 `margin:auto` 会把它们推到中间留空洞）。

### 🔴 缺陷② 「最后一家不可删」弹窗的唯一按钮写着「创建」

`pages/shop/switch.js::onDeleteAsk` 的边界分支复用了 `TERMS.exp.createOk`（**「创建」**），
但**该弹窗不创建任何东西**，点它只关窗 ⇒ 文案明确误导。

**证据**：`05_modal_lastOne_OLD_label_desktop.png`（旧文案「创建」）↔ `05_modal_lastOne_desktop.png` / `05_modal_lastOne_crop.png`（新文案「知道了」）。
**修法**：改用既有口径 `TERMS.buttons.gotIt`（「知道了」，3 字 ≤4 ✓，R45 就定过"无动作信息弹窗的唯一按钮"）。

### 🔴 缺陷③ 「我的」页头像被渲染成椭圆（既有页面，同根因）

`pages/mine/index.wxss::.avatar-btn` 写 `width:120rpx; height:120rpx; border-radius:50%`（= 62×62 正圆），
**实测 184×62** ⇒ `border-radius:50%` 下变成**椭圆**。

**修法**：`.profile-avatar` 改 `display:flex`，`.avatar-btn` 加 `flex: 0 0 120rpx` ⇒ 实测 **62×62**（`report_layout3.json` MINE 视图）。
**证据**：`09_mine_avatar.png`。

---

## 三 双向变异回灌（证明"修的是真东西"）

定向把 `.edit-btn` 的定宽去掉（`.edit-btn { flex: 0 0 auto; margin-top: 0; }`）→ 重新编译 → 实测：

- `report_layout_BEFORE_mutation.json`：输入框 **w=20**、按钮 **r=234 / r=424**（缺陷精确复现）
- `report_layout_AFTER.json`：输入框 **w=164**、按钮 **r=277 / r=366**（无溢出）

⇒ 该 CSS 声明是**致因**，不是巧合。

---

## 四 🔴 顺带查明的两个环境级根因（比走查本身更值钱）

1. **开发者工具窗口被最小化 ⇒ Chromium 节流 ⇒ `mp.evaluate` 大面积 timeout。**
   本轮起初 127 套件之外的自动化步骤交替失败（`ensureSwitch` 随机返回 null）。
   `win_gui` 探针：`iconic=True` ⇒ `SW_RESTORE + SetForegroundWindow` 后**一次通过、零 errs**。
2. **本机「文件保存时自动编译」是关着的**：能编译是因为**往项目目录写文件触发了文件监听**。
   ⇒ 本轮把截图写到 `_r194shots`（**项目外**）之后，`switch.js` 的改动**一直没进包**
   （表现为弹窗文案怎么改都还是「创建」）。判据：把一张 PNG 写进 `review/evidence/` 后，App 立即重启、弹窗被清空。
   **纪律：改完源码要显式触发一次重编译（或往项目目录写一个文件）再验证。**

---

## 五 归档件

| 文件 | 内容 |
|---|---|
| `01_switch_normal.png` | 切换页常态（标题/提示行/当前店铺 tag/⋯ 圆钮/建店按钮/底部提示） |
| `02_rename_row.png` | **修复后**就地重命名行（输入框 + 保存 + 取消，全在卡片内） |
| `03_create_row.png` | **修复后**新建行（整行输入框 + 两个等宽按钮平分整行） |
| `05_modal_lastOne_OLD_label_desktop.png` | 缺陷②证据：旧文案「创建」 |
| `05_modal_lastOne_desktop.png` / `_crop.png` | 修复后：「删除店铺 + 至少要保留一家店铺…」唯一按钮「知道了」 |
| `06_modal_confirm2_desktop.png` / `_crop.png` | 真·删除确认框（标题带店名 / 后果说明 / 「再想想」+ 红「删除」） |
| `07_action_sheet_desktop.png` / `_crop.png` | ⋯ 原生菜单：**重命名 / 删除店铺 / 取消**（删除项**总是**出现，未藏功能） |
| `09_mine_avatar.png` | 缺陷③证据：头像已是正圆 |
| `report_layout_BEFORE_mutation.json` / `report_layout_AFTER.json` | 缺陷①的变异前/后机读矩形 |
| `report_layout2.json` | 三态（常态/重命名/新建）修复后矩形 |
| `report_layout3.json` | 「我的」页 `.avatar-btn` 修复后 62×62 |
| `log_lastone.txt` / `log_confirm2.txt` / `log_sheet.txt` | 三次弹层取证脚本的原始 stdout |
| `../r194_gate/native_blocked_r194_walk.txt` | 原生门禁被沙箱拦（`spawnSync git EBUSY`）的实录 |
| `../r194_gate/gate_r194_walk_1.txt` | 沙箱通道跑出的 **127/127 · miss=0**（走查当轮 · 提交前树） |
| `../r194_gate/gate_r194_walk_2.txt` | **提交后复跑** `dbd5836`／`56c57ed`：**127/127 · RC=0 · miss=0**（git 索引 3203 → 3204） |

**脚本（仓外，不进门禁面 B）**：`C:\Users\lzj\.workbuddy\binaries\node\mpauto\` 下
`r194_walk_switch3.js`（原生弹层取证）· `r194_layout{,2,3}.js`（机读布局）· `r194_shot_final.js` · `r194_desktop_shot.py`（桌面真截屏）。

---

## 六 明确「**没做到**」的（防下一轮误判）

| 没做到 | 原因 | 影响 |
|---|---|---|
| **端到端真跑** create / delete / rename（真写云库） | dev 账号只有 1 家店、`hit_free_limit=true` ⇒ 建第 2 家会占额度；删/改现有唯一店铺会动真实数据 | ⚠️ **本走查只验证了「界面层」，没有验证云函数真写**。功能正确性目前仍依赖 `manageShop` selftest 46/46（单测）+ 代码审查，**真云 e2e 尚未做** |
| 「⋯」菜单 **点击后**的真实分支跳转（选「重命名」是否真进编辑态） | 原生操作菜单不可被脚本点选（`mp.screenshot` 拍不到原生层；只能桌面截屏看形态） | 菜单**形态与项文案**已证实；**选择行为**未端到端验证 |
| `.btn-block{width:100%}`（`pages/pay/orders`）· `.banner .btn-small{width:160rpx}`（`pages/month/index`）同型风险 | 这两处按钮 `wx:if` 未满足、**未渲染** ⇒ 机读为空数组 | **登记为同型风险，未实测未定性**（不写"已验证"） |
| 真机（手机）验证 | 仍属李老师 | 本走查是**模拟器**，且本机模拟器为 iPhone 12/13 尺寸；窄屏机型的溢出量只会更大 |
