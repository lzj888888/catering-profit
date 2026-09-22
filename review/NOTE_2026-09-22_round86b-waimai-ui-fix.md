# NOTE · round86b — 外卖分项 UI 修复（李老师真机反馈）

- 日期：2026-09-22 08:2x–08:5x
- 触发：李老师真机走查（08:24）：「针对外卖这个板块，填写分项输入时，金额框 预留过小，粘贴框预留过大，
  另外测试 粘贴 真给数字是否正常填入，整体做的特别的专业了。」
- 版本：基于 `813643d`（round88 / 套件 90）
- 结论：两条布局缺陷**已修**；粘贴→填入链路**实测 20/20 通过**；
  同类布局全仓扫描**已清零**（外卖段是最后一处）。

---

## 1. 缺陷与判据

### 1.1 金额框过小（真缺陷 · 已修）

判据不能用"看着小"——时 IDE GUI 不在（`wechatdevtools` 进程数 = 0），automator 截图通道取不到
（`mp.screenshot` → `timeout waiting for automator response`），
故改用**离线精确复现**：从真 `wxss` 自动抽取并做 `1rpx = 0.5px` 换算 + 真 `terms` 文案，375px 逻辑宽渲染，
再用 `getBoundingClientRect()` **机器量宽**（不是目视）。产物：`mock_before.png` / `mock_after.png`。

375px 屏实测（容器宽 327px = 654rpx）：

| 项 | 改前 | 改后 |
|---|---|---|
| 金额输入框 | **181.7px**（占字段 55.6%） | **327px**（占字段 100%） |
| 字段名 label | 90px（固定 180rpx） | 按内容 |
| 粘贴按钮 | 45.3px × 44px（描边方块，挤在金额行） | 38px × 44px（浅底胶囊，移到字段名行右端） |
| 字段行高 | 44px | 81.7px |

→ 金额框 **+80%**。

### 1.2 粘贴按钮占位过大（真缺陷 · 已修）

原「标签 + 金额框 + 粘贴按钮」一行三控件 ⇒ 粘贴按钮占了金额行的 13.8% 宽，
且白底 + 深蓝描边在三个字段上重复三次，视觉重量压在金额框上。

### 1.3 顺带修掉：配平行 label 被固定宽挤到换行（真缺陷）

`.tw-field-lbl { flex: 0 0 180rpx }` = 90px，而配平行文案「账单商家应收款」7 字 × 14px = 98px
⇒ **溢出换行**（改前 `mock_before.png` 可见「账单商家应收/款」两行）。改为按内容宽后不再溢出
（改后实测「溢出=否」）。

### 1.4 🔴 同族病第 3 例（本轮最重要的模式发现）

同一反馈在同一个仓里**已经发生过两次**，外卖分项（R85 新增）是第三次：

| # | 位置 | 时间 | 原文判据 |
|---|---|---|---|
| 1 | `pages/month/input.wxss:11-12`（`.sub-block` 其他收入细项） | 2026-09-20 | 「原一行三控件时金额框仅 **220rpx**，点中间数字易误删」 |
| 2 | `pages/month/input.wxml:70-71`（`.dine-item` 堂食分项） | 2026-09-21 | 「原一行三列把渠道名挤成竖排、金额框只剩 **240rpx**」 |
| 3 | `pages/month/input.wxml:139-160`（`.tw-field` 外卖分项） | 2026-09-22 | 本 NOTE（金额框 181.7px） |

⇒ 已在 `input.wxss` 改动处写入**显式禁令**：「新增录入区**不要再写「标签+输入框+按钮」一行三控件**」。

**全仓扫描**（判据：`val-input` 之后到同层 `</view>` 之前是否出现 `<button>`）：
改后命中 **0 处** —— 同族病已清零。

### 1.5 硬约束：AD 规范不可下调

`pages/month/input.wxss:22-26` 明写：**AD 规范（ad-gates G2 硬守）可点元素 `min-height ≥ 88rpx`，不可下调**，
"真把 min-height 调小会让门禁转红"。
⇒ 本轮**只改粘贴按钮的视觉重量**（去描边、去白底、收 `padding` 至 `0 10rpx`），
**热区保持 `min-height: 88rpx; height: 88rpx`**（未动）。这是"视觉小 / 热区够"的既有做法，同 `.btn-del`。

---

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `pages/month/input.wxml` | 3 处 `.tw-field` 由一行三控件改为两行：行① `.tw-field-head`（字段名 + 粘贴）／行② `<input>` 整行宽。事件绑定 `data-target`/`data-idx`/`catchtap="openPaste"` 与 `data-field`/`bindinput="onTwDetail"` **逐字未动** |
| `pages/month/input.wxss` | `.tw-field`→column；新增 `.tw-field-head`；`.tw-field-lbl` 去固定 180rpx；`.tw-field .val-input` 整行宽（34rpx）；`.paste-btn` 轻量化 + `::after{display:none}`；`.paste-area` `min-height` 240rpx→**200rpx** |

⚠️ `pages/*` 零业务逻辑改动（纯样式与结构），`input.js` **未修改**。

---

## 3. 实测：粘贴 → 填入（李老师第 3 项要求）

独立脚本（不复用 R85 自测）：解析层直连 `utils/takeaway.js::extractPaste`；
落值层**照抄** `pages/month/input.js::onPasteExtract` 的 `doFill`（`r[field] = res.sum ? res.sum.toFixed(2) : ''`;
`r.subtotal = subtotalOf(...)`）。证据：`review/evidence/r85_feed/paste_fill_test.txt`。

**结果 20 通过 / 0 失败**，覆盖：

- 解析 9 例：Excel 单列 3 行求和 / 带表头 / **日期列+金额列一起粘**（账期不被当金额）/
  含「合计」行（`hasTotal=true` 且合计行不计入）/ 时间+长订单号+金额 / 千分位 / 带「元」/ **负值行** / 单数字；
- 落值 7 例：填入 `7140.00` `128.50` `320.00` `1234.56`，小计 `7588.50` / `1234.56`，两平台合计 `8823.06`；
- 边界 4 例：纯文字与空文本走 `pasteEmpty`；单粘 `2026-09` 不再被当金额（R85 已修）。

**记录的既有行为（未改，待李老师定）**：粘 `0` 时 `res.sum` 为 `0`（falsy）⇒ `doFill` 落值为**空串**，
界面表现为"未填"。若需要"粘 0 也显示 0.00"，改 `res.sum ? … : ''` 为 `res.numbers.length ? … : ''` 即可。

⚠️ 本条是**逻辑级实测**（纯函数 + 照抄落值）。真机点击级验证需要 IDE GUI 或预览码 —— 已重出预览码交李老师。

---

## 4. 门禁

- `verify_all.js` → **91/91 套件通过，RC=0**（证据 `review/evidence/r85_feed/gate_ui_fix.txt`）。
- ⚠️ **口径说明**：91 而非 90，是因为**工作树里有一份他方未提交的在途改动**
  （已暂存：`tools/check_archive_grace.js` + `verify_all.js` + `specs/dev-specs/core/13_…md` + `★知识存储点…md`，
  即 `archive-grace` 套件）。本轮**未触碰其暂存区**，我的提交**只带自己的 pathspec**。
  故本次门禁是"我的改动 + 他方在途改动"的**混合态**：我的改动在其之上全绿。

---

## 5. 核验脚本自身的两次误报（先证伪自己的口径）

按纪律，FAIL 先怀疑自己的判定口径 —— 本轮 3 + 2 个 FAIL **全部是脚本自己的 bug**，产品无缺陷：

1. 落值用例 key 误写 `'good:0'`（应为 `'goods:0'`），split 后字段名被截成 `good`，
   结果 rows 里多出 `good` 字段 ⇒ 3 个 FAIL。改为显式 `[idx, field, text, want]` 结构后消失。
2. `subtotalOf` 返回**字符串**（`"7588.50"`）而非数字，我用 `===` 比数字 ⇒ 2 个 FAIL。
   改为 `Number(sub0) === …` 后消失。

---

## 6. 本次未能做到的（如实登记）

- **真机/模拟器截图取证未拿到**：`wechatdevtools` GUI 进程数 = 0（automator 可 `connect` 且 `currentPage` 正常，
  但 `mp.screenshot` 超时）。按 `miniprogram-page-review` 技能：**GUI 一旦关闭，agent 侧无解**，
  只能请人在桌面会话打开。⇒ 本 NOTE 的视觉判据为**离线精确复现**（真 wxss 换算 + 真文案 + 真实测宽），
  非真机截图。已重出预览码请李老师真机复核。
- **未加"防一行三控件复发"的守卫**（只写了显式禁令注释 + 全仓扫描 0 命中）。
  若要硬守，需一条扫 `.wxml` 的守卫（判据已有，误报风险需评估）—— 留待下一轮。
