# NOTE 2026-09-19 · round39 · R81 闭环：`saveCostCard` / `calcBom` 的 `mode` 白名单（挂 4 轮）

> **归属（R96）**：本件是**执行方（WorkBuddy）的分析件**，前缀 `NOTE_`（`REVIEW_*` 归复审方）。
> **时点**：2026-09-19 01:00–01:40（round39 续）。R81 自 round34 提出，round36/37/38 三轮记「未落（排队）」⇒ **本件记录其落地与验证**。

## 0. 一句话结论

**R81 已闭环**：`mode` 的静默兜底（`=== 'B' ? 'B' : 'A'`）在**入口 + 引擎双层**改成**白名单/断言式**，
共 **8 处**改动、**19 条断言**，并已完成**变异回灌**（退回旧兜底 ⇒ 19 条转红、两个 selftest RC=1）。

## 1. 为什么它是"上线级"（复述 round34 §4.5，便于独立复核）

调用方传 `'b'`（小写）/ `2`（照库里 `calc_mode` 的口径）/`'C'`/`''`/缺失 ⇒ **静默当成 A**：

- 不生成/更新虚拟半成品（`shop_material.is_virtual`）
- 忽略 `batch_output`
- 落库 `calc_mode: 1`（而不是 2）

⇒ **成本语义悄悄变错，且无任何报错**。同文件对越界 `loss_pct`、缺失 `batch_output` 都是**响亮拒**，
本仓 R27/R30/R32/R35 一路纪律是「涉金额的模糊入参一律响亮失败」——这里是**唯一例外**。

## 2. 改动清单（8 处）

| # | 文件:行（改后） | 改法 |
|---|---|---|
| ① | `cloudfunctions/saveCostCard/validate.js:34` | 白名单：非 `'A'`/`'B'`（**含缺失**）⇒ `INVALID_PARAM` |
| ② | `cloudfunctions/calcBom/validate.js:43` | 同口径白名单（防「预览按 A 算、保存按 B 存」的口径分裂） |
| ③ | `cloudfunctions/saveCostCard/service.js:59` | 引擎断言式：`throw { code:'INVALID_PARAM' }` |
| ④ | `cloudfunctions/calcBom/service.js:85` | 同上 |
| ⑤ | `cloudfunctions/syncCostCard/service.js:41` | 同上 |
| ⑥ | `cloudfunctions/saveCostCard/index.js` | 调用点 `try/catch` ⇒ `fail(e.code, e.msg)` |
| ⑦ | `cloudfunctions/calcBom/index.js` | 同上 |
| ⑧ | `cloudfunctions/syncCostCard/index.js` | 同上 |

- **⑥–⑧ 为什么必须加**：引擎改成抛错后，若不透传会退化成 `SYSTEM_ERROR`（"系统异常"），
  那就从「响亮拒」变成「含糊拒」，违背 R27 纪律。
- **③–⑤ 三副本同口径**：`calcCostCard` 有三份副本（云函数不能跨包 require）。三份**逐字一致**，
  错误码用字面量 `'INVALID_PARAM'`（与 `common/errors.js::ERROR_CODES.INVALID_PARAM` 同值），
  **Service 层保持零依赖**（`calcBom`/`saveCostCard` 的 service.js 原本就没有 `require('./common')`）。
- **grep 查全同类（纪律）**：全仓 `=== 'B' ? 'B' : 'A'` 已**零命中**（唯一命中是 selftest 里的背景注释）；
  全仓 `function calcCostCard` 只有 3 份，`web-preview`/`admin-h5` **无第四份副本**。

## 3. 断言（19 条，含反向证据）

| 位置 | 越界样本 | 反向证据（不该红时不红） |
|---|---|---|
| `saveCostCard/selftest.js` ⑥段（入口 5 + 引擎 5 + 反向 4 = 14 条） | `'b'` / `2` / `'C'` / `''` / **缺失** | `'A'` 放行、`'B'` + `batch_output` 放行、引擎 `'A'`/`'B'` 不抛 |
| `calcBom/selftest.js` R81 段（入口 5 + 引擎 4 + 反向 2 = 11 条） | 同上 | 预览入口 `'A'` 放行、引擎 `'B'` 不抛 |

> 反向证据是**硬要求**（本仓纪律②：放宽性设定必须配"不该红时不红"的反向证据）——
> 否则"一律拒绝"的写法也能让越界断言转绿，判据就失效了。

**基线（改后）**：`saveCostCard` 29/29、`calcBom` 40/40、`syncCostCard` 4/4；套件 **64/64**、门禁 A–L **RC=0**。

## 4. 变异回灌（已做，可复现）

把四处白名单条件改回 `false`（等价旧的三元兜底）：

```
saveCostCard/validate.js : card.mode !== 'A' && card.mode !== 'B'  →  false
saveCostCard/service.js  : p.mode    !== 'A' && p.mode    !== 'B'  →  false
calcBom/validate.js      : src.mode  !== 'A' && src.mode  !== 'B'  →  false
calcBom/service.js       : p.mode    !== 'A' && p.mode    !== 'B'  →  false
```

⇒ **19 条断言转红**（`实际=null`，即"静默放行"），`saveCostCard RC=1`、`calcBom RC=1`。
还原后三者全绿。**判据确有鉴别力，不是恒真断言。**

## 5. 前端不受影响（已核，不是"想当然"）

- `pages/card/edit.js:71` 的 `init.calcMode = c.calc_mode`，`c` 来自 `getCostCard` 出参；
- `getCostCard/service.js:13` 已把 DB 的 `calc_mode`（`1/2`）映射成 wire 的 `'A'/'B'`；
- `edit.wxml` 的 `radio value="A"/"B"`，新建默认 `calcMode: 'A'`。

⇒ 前端**恒传** `'A'`/`'B'`，收紧不会打断现有流程。
（反过来：若将来有人改成直读 DB 字段传 `2`，会**立刻被白名单拦下**——这正是本修复的价值。）

## 6. ✅ 真云复验（2026-09-19 01:24 部署 → 01:33 复验，路径 A：页面上下文调云函数）

部署 `saveCostCard` / `calcBom` / `syncCostCard` 三个函数**逐个**部署，均一次成功（`success:true`）。
随后在开发者工具页面上下文（`mp.evaluate` → `wx.cloud.callFunction`，拿到真实 OPENID）实调：

| 调用 | `mode` | 真云返回 | 判定 |
|---|---|---|---|
| `saveCostCard` | `'b'` | `INVALID_PARAM` · `card.mode 必须是 "A" 或 "B"（当前值："b"）` | ✅ 响亮拒 |
| `saveCostCard` | `2` | `INVALID_PARAM` · 当前值：2 | ✅ 响亮拒（**这条最关键**：DB 的 `calc_mode` 就是 1/2） |
| `saveCostCard` | `'C'` | `INVALID_PARAM` | ✅ 响亮拒 |
| `saveCostCard` | `''` | `INVALID_PARAM` | ✅ 响亮拒 |
| `saveCostCard` | `'A'` | **`SUCCESS`** | ✅ **反向证据**：不是"一律拒绝" |
| `calcBom` | `'b'` | `INVALID_PARAM` | ✅ 预览路径同口径 |
| `calcBom` | `'A'` | **`SUCCESS`** | ✅ 反向证据 |

- 真云 `shop_id = shop_mu6j87v1itrs`，取到真实原料 `mat_mu7606ti1psx`（`getMaterial` 返回 6 条）
  ⇒ **不是 mock**：`saveCostCard` 严格校验原料存在，能返回 `SUCCESS` 说明走完了真实写库链路。
- 证据：`review/evidence/r81_probe_result.json`（原始返回逐字）、`r81_deploy_20260919.txt`（部署日志）、
  `r81_probe.js`（可复现脚本）。

## 7. 待办（本件未闭合）

- 其余人工面：**§3 判据**（`idx_card_code_version` 是否真生效）需控制台 GUI 手工插重复三元组；
  **超时值**（R86/R93）需控制台手点 + `cli cloud functions info` 回读。
- 本修复**未经复审方复核**（round39 复审尚未出），按「先审后合」应由下轮先审。

## 8. 部署纪律留痕

- ⚠️ 部署**必须逐个**（一次传多个 `--names` 会产生**空壳**：函数先被 Creating，紧随的代码更新被拒，
  云端留下无 `code` 的壳）。本次 3 个函数逐个、`-r` 远程装依赖，均 attempt=1 成功。
- 探针脚本的 `miniprogram-automator` 装在 `C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules`
  （`workspace/node_modules` 那份的 `@jimp/plugin-crop` 是坏的 ⇒ `MODULE_NOT_FOUND`）；
  跑法：`NODE_PATH=.../mpauto/node_modules node review/evidence/r81_probe.js`。
- 页面路径别写错：`app.json` 里是 `pages/card/index`，**没有** `pages/card/list`（`reLaunch` 错路径会抛
  `Uncaught [object Object]`，看不出原因）。
