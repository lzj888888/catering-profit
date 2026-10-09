# R250 取证 —— 京东账单「门禁未通过，已阻断导入」

> 现场（李老师原话，2026-10-08）：
> **「导入 京东账单 提示  门禁未通过 已阻断导入」**

---

## 一、结论：**两条独立缺陷**，不是一条

| # | 缺陷 | 性质 | 现场表现 |
|---|---|---|---|
| ① | **平台自动判定误杀真数据** | fail-closed **误杀** | 一张 **117 行数据**的京东订单级对账单，被判「无法识别账单平台」 |
| ② | **门禁失败原因不透出** | 后端回了、前端**不读** = 静默丢弃 | 界面只有笼统的「门禁未通过，已阻断导入」，看不出**为什么** |

**两条都不是「部署落后」**。上轮（R249）把本障碍定性为「云函数版本旧」是**不完整且有误**的，
修正见 §六。

---

## 二、缺陷 ① 根因：两级表头 vs 启发式选行

京东《对账单下载》（**订单级**）是**两级表头**：

- `R1` = 合并的**组表头**（"商家基础信息" ×5 / "订单基础信息" ×77 / "实际收入" / "营业收入" ×5 …）
- `R2` = **真正的列名**（"商家编号" / "商家名称" / … / "主订单号" / …）

🔴 **致病点**：京东导出时把 `R1` **逐格写满**（不是只写合并区左上角）⇒
**R1 与 R2 的「非空文本格数」都是 82 ⇒ 打平**。
而 `guessHeader` 的启发式是「非空文本格最多 + **严格大于** best + 先到先得」
⇒ 打平时**首行胜出** ⇒ 取到 `R1` ⇒ `detectPlatform(R1)` = `null`
⇒ 整张 117 行的真数据表被判「无法识别账单平台」。

**机器取证**（`jd_structure_sanitized.txt`，由真文件经真 SheetJS 导出后脱敏）：

```
---- sheet 'com.jd.o2o.settlement.domain.dt' : 117 行 × 82 列
     R1  非空文本格 = 82 / 82      ← 组表头，逐格写满
     R2  非空文本格 = 82 / 82      ← 真列名  ⇒ 打平 ⇒ guessHeader 取 R1
```

### 修法

新增 `detectPlatformInRows(rows, limit)` / `detectPlatformInMatrix(matrix)`：
平台判定**不再依赖「哪一行最像表头」**，改为前 5 行内**逐候选行试签名**，谁先命中谁赢 ——
与 `pickSheet` 的扫描口径一致。

三处同源落地：

| 位置 | 角色 |
|---|---|
| `cloudfunctions/importSalesBill/service.js` | 云端实现（生产路径） |
| `utils/billParse.js` | 前端镜像副本（同源同步） |
| `cloudfunctions/importSalesBill/index.js` | 调用点（`detectPlatformInMatrix(matrix)` 为**唯一入口**） |

---

## 三、缺陷 ② 根因：门禁原因被吞

- 云函数预览**其实回了** `grade.failures[]`（含具体 `code`，如 `CHANNEL_EMPTY`）。
- 页面却只渲染一句 `t.importFail`（`i18n` 文案）⇒ **`failures` 零消费**。
- 且 `utils/api.js:47` 的 `msgOf(r.code)` 会把后端 `msg` **整条覆盖**
  ⇒ 用户看不到任何具体原因。

**实测现场**：李老师导的那份京东「**sku对账单下载**」是
**1 行 × 27 列 —— 只有表头的空模板**（原始 XML：`dimension ref="A1:AA1"`、仅 `<row r="1">`）
⇒ 云函数回 `CHANNEL_EMPTY 未解析到任何数据行` ⇒ **门禁判得完全正确**，
但界面把原因吞了，用户只会反复重试。

### 修法

- `miniprogram/i18n/terms.js` + 镜像 `specs/dev-specs/i18n/terms.js`：新增 4 键
  `importFailEmpty / importFailTotal / importFailPlatform / importFailRow`
  （文案单源，**不把云函数英文 code 漏到界面**；未登记 code 走 `importFailRow` 兜底，**不静默**）。
- `pages/takeaway/index.js`：`FAIL_REASON_KEY` 映射 + `failReasonText(grade)` + 落 `data.importFailReason`（两处：预览回包 / 成功清空）。
- `pages/takeaway/index.wxml`：两处 fail 分支各加**一条同级渲染**的原因行。

---

## 四、验证（真文件 + 真 SheetJS，走**生产路径**）

`verify_r250_truth.txt`（脚本 `_r250_verify.js`；`NODE_PATH` 指向真 `xlsx`）：

| 样本 | 结果 |
|---|---|
| **真·京东订单级（117×82）** | `detectPlatformInMatrix ⇒ {platform:'jd_order', headerRow:1}` · `pickSheet ⇒ com.jd.o2o.settlement.domain.dt` · `parsed rows=15 totals={amountFen:55596, qty:23, rowCount:23} excluded={92,'非正向订单（推广费/保险单）'}` · **`grade: pass=true`** |
| **真·京东 SKU 级（仅表头）** | `⇒ {platform:'jd_sku', headerRow:0}` · `rows=0` · **`grade: pass=false failures=[CHANNEL_EMPTY]`** |
| 真·淘宝闪购商品表 | 平台机器判不出 ⇒ **形态 C 按设计由用户选**（非缺陷） |
| fixture 淘宝 / 美团 | 行为**与改前一致**（回归） |
| 两副本一致性 | 云端 `service.js` ≡ 前端 `billParse.js`：**逐条等价 = true**（含美团命中在**第二** sheet 的情形） |

---

## 五、守卫 + 变异回灌

| 套件 | 断言 | 新增内容 |
|---|---|---|
| `tools/selftest_bill_parse.js` | 39 → **53** | R250 组 14 条：S1~S5（致病条件）+ A1/A5（修复点）+ A2~A4（回归/反例）+ B1~B4（副本与调用点） |
| `tools/check_shape_machine_value.js` | 18 → **27** | F 组 9 条：云端 `failure code` 全集 ↔ 页面映射 ↔ terms 文案 ↔ wxml 渲染行，四段配对 |

🔴 **两条判据纪律（本轮实证踩到的）**：

1. **仓内 fixture 复现不出这个坑** —— `r245_jd_profile/jd_order_2026-09.matrix.json` 的 `R0` 是
   **稀疏**的（17 格非空），旧写法照样取到 `R1` ⇒ 断言**无分辨力**（假绿）。
   ⇒ 必须按**判据相关属性**（R0 与 R1 非空文本格数**相等**）**现造忠实样本**（断言 S4/S5/A5）。
2. **结构判据必须先剥注释** —— F-④ 若只数 `importFailReason` 出现次数，
   **wxml 注释里也有** ⇒ 删掉渲染行仍然绿。⇒ 先 `replace(/<!--[\s\S]*?-->/g,' ')` 再按**渲染行**配对。

🔴 **没有**把「旧写法必须失败」写成断言 —— 避免**反向伤害第二型**（将来有人改对反而报红）。
旧写法的诊断只**打印**、不判红。

`mutation_r250.txt` —— **变异回灌 5/5 全部有效红**（逐条独立、还原后 md5 全等、且复绿）：

| 变异 | 红在**目标断言名** |
|---|---|
| M1 `index.js` 退回「先 guessHeader 选行再判平台」 | **B3** |
| M2a `utils/billParse.js` 退回旧写法 | **A5**（忠实样本）+ B2 |
| M2b 云端 `service.js` 退回旧写法（两副本分叉） | **B2** |
| M3 wxml 删两条原因渲染行 | **F-④** |
| M4 页面映射漏登记 `CHANNEL_EMPTY` | **F-①** |

---

## 六、🔴 对上轮结论的修正

| 上轮（R249）说法 | 本轮订正 |
|---|---|
| 「京东导入报错 = **部署落后**」 | **不完整、有误**。真因是 §二/§三两条缺陷。 |
| （上轮我用真文件跑通了京东订单级） | 上轮我是**把 `platform` 硬塞**给 `pickSheet` ⇒ 走的是**测试路径**（正是「测试路径 ≠ 生产路径」）；自动判定那条路上 `platform` 还不存在，走的正是**纯启发式** ⇒ 盲区。 |
| — | 本轮用**真 SheetJS + 真文件**、走**生产路径**（自动判定）复跑，才把它坐实。 |

---

## 七、文件清单

| 文件 | 说明 |
|---|---|
| `README.md` | 本文 |
| `jd_structure_sanitized.txt` | **结构取证（脱敏）**：只留 sheet 名/维度/表头行；数据行不入仓 |
| `sanitize_jd_evidence.py` | 生成上表的脱敏脚本 |
| `_jd_dump.py` / `_jd_matrix.py` | 真文件 → 结构 dump / JSON 矩阵 |
| `_jd_diag.js` / `_jd_diag_real.js` | 诊断（openpyxl 矩阵+空桩 / **真 SheetJS 走生产路径**） |
| `_r250_verify.js` | 验证脚本（真文件 + fixture，两副本逐条比对） |
| `verify_r250_truth.txt` | 上表的**实跑输出** |
| `_r250_mutation.py` | 变异回灌 v2（自适应 CRLF） |
| `mutation_r250.txt` | 5/5 有效红的实跑输出 |

> ⚠️ 真实账单原件与含数据行的矩阵**不进仓**（隐私；同 `.gitignore` 里 `_probe_tmp/` 的既有理由）。

---

## 八、待办 / 需李老师确认

1. 🔴 **请重新导出一份「有数据行」的京东 SKU 级对账单** —— 您手上那份
   `sku对账单下载`（3830 B / 1 行 × 27 列）**本身就是只有表头的空模板**，
   门禁拦它是对的；本次修复后界面会**明确告诉您**「这张表里没有可导入的数据行」。
2. 京东**订单级**对账单（117 行那份）修复后应可正常导入 → 待真机/真云复验。
