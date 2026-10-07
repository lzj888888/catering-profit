# R232j · 形态机器值契约缺陷（真机实测 P0）· 取证

## 1. 现象（李老师真机截图 2026-10-07 12:39:01）
外卖单均测算 → 账单导入 tab，选入「外卖商品销量」表后：

| 字段 | 显示 | 应为 |
|---|---|---|
| 平台 | ⬜ 空白 | 应为 picker（淘宝闪购/美团/饿了么/其他） |
| 识别到 | ⬜ 空 + 「行」 | 354 行（或 7 天） |
| 归月到 | ⬜ 空 | 2026-09-07 ~ 2026-09-13 |
| 合计 | **¥ 1823.08** ✅ | 1823.08（**这个是对的**） |
| 结果行 | 🔴「门禁未通过，已阻断导入」 | 应可导入 |

## 2. 根因（两处，非解析层）
**合计 1823.08 正确 ⇒ `parseDishSalesC` 完全正常**，缺陷全在前端契约与云函数预览分支：

### 根因 A：`shape` 是机器值，前端按字母序号比对
云函数 `importSalesBill/service.js::DISH_SHAPES`：
```
A: 'dish_sales'   B: 'combo_detail'   C: 'waimai_goods'
```
而 `pages/takeaway/index.js:347` 写 `const isC = d.shape === 'C';`
⇒ 与 `'waimai_goods'` **永不相等** ⇒ `isC` 恒 false
⇒ 走 `else` 分支（账单），绑 `importPreview.rowCount`/`monthsText`（形态 C 无此字段）⇒ **全空白**
⇒ wxml `wx:if="{{... importShape === 'C'}}"` 也恒 false ⇒ 形态 C 卡片整块不渲染（无 picker、无零元行）

### 根因 B：预览期被 platform 门禁挡住 ⇒ 死锁
平台由**用户在预览卡里的 picker** 选 ⇒ 首次预览 `platform` 必然为空
⇒ 云函数 `checkGradeA({platform:''})` 返 `SCHEMA_PLATFORM` ⇒ `grade.pass=false`
⇒ 原 wxml `wx:if="{{importGrade && importGrade.pass}}"` 控制确认按钮 ⇒ **按钮不出现**
⇒ 没按钮 ⇒ 选不了平台 ⇒ 永久死锁（picker 与按钮同屏却永远点不到）

### 附带根因 C：分→元 只在假值分支除 100
`pages/takeaway/index.js` 原写 `((p && p.totals && p.totals.amountFen) || 0 / 100).toFixed(2)`
⇒ `/100` 落在 `||` 右支 ⇒ 仅在 `amountFen` 为假时执行 ⇒ 真值时原样输出**分值**（182308.00，放大 100 倍）

## 3. 修法
| # | 文件 | 改动 |
|---|---|---|
| 1 | `pages/takeaway/index.js` | 顶部新增 `DISH_SHAPES` 单源（与云端逐字对齐）；`d.shape === 'C'` → `DISH_SHAPES.C`；`importShape === 'C'` → `DISH_SHAPES.C`（2 处）；data 增 `shapeC: DISH_SHAPES.C` 下发给 wxml |
| 2 | `pages/takeaway/index.wxml` | `importShape === 'C'` → `importShape === shapeC`（不在模板写字面量）；确认按钮条件 `importGrade && importGrade.pass` → `!importGrade \|\| importGrade.pass` |
| 3 | `cloudfunctions/importSalesBill/index.js` | 预览分支：`platform` 空时回 `platform_missing: true` + 剔掉 grade 里的 `SCHEMA_PLATFORM` 项；**阻断只留 confirm 分支** |
| 4 | `pages/takeaway/index.js` | 分→元改 `(amtFen / 100).toFixed(2)`（括号外除）；新增 `groupCount`/`dateRangeText`；新增 `importPlatformMissing` 位 |
| 5 | `miniprogram/i18n/terms.js` + `specs/.../i18n/terms.js` | 新增 `importDaysUnit: '天'` / `importPickPlatformHint`；两副本 md5 一致 |
| 6 | `pages/takeaway/index.js` | `t:{}` 三处补映射（第三处，漏登记=静默空白） |
| 7 | `tools/check_shape_machine_value.js` | **新增守卫**（12 断言） |

## 4. 判据（机器可验）
- 守卫自跑：**12 通过 / 0 失败 · RC=0**
- 全量门禁：**151/151 通过 · RC=0 · R92 tracked=7194 missing=0**（288.1s）
- 变异回灌 **3/3 有效红**（均红在目标断言名，非崩溃红；还原零残留）：
  - M-1 `C: 'waimai_goods'` → `C: 'C'` ⇒ 红 V-2-③ / V-3-①
  - M-2 `C: 'waimai_goods'` → `C: 'waimai_sales'`（契约漂移）⇒ 红 V-2-③ / V-3-①
  - M-3 wxml `importShape === shapeC` → `importShape === 'C'` ⇒ 红 V-4-② / V-4-③
- 锚点复算（本地，真样例）：`groups=7` / `totals.amountFen=182308` ⇔ 界面 `¥1823.08` 一致

## 5. 同类缺陷扫描（防复发）
全仓扫 `shape === 'C'` / `importShape === 'C'`：除注释说明外**零残留**（守卫 V-4 剥注释后判）。
