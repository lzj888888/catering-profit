# R606-bis · M1 外卖「框填不进」同族 5 处对象数组循环 + wx:key 稳定性通用守卫

> 日期：2026-11-02（续 R606）｜ 范围：5 处对象数组循环（takeaway items/packs、card comboLines/lines、dishreview splitRows）｜ 整改状态：已闭环，守卫已进门禁（229 套件），待真机复核 + R605 推送

## 一、缘起（为什么有本篇）

R606 已定位并修复 `subpkg/biz/month/input.wxml` 4 处 `g.rows` 循环的 `wx:key="index"` 位置键错位（首行能填、下方行填不进）。
「位置键 + 含 `<input>` 的循环 + 每次按键整体 `setData` 重赋值」是**一类通病**。按「不采信任何自述」硬规矩，逐模块重读源码坐实，
又挖出 **同族 5 处对象数组循环**（均具「每按键整体重赋值」机制，与 R606 完全一致），并落地一条**通用回归守卫**把整类缺陷锁死。

> ⚠️ **matrix 维度档位（rent/labor/margin/target/other）曾被一并列为第 6 类（标量数组）并改为对象包裹，但经权威守卫实测后已回退、列入白名单**，
> 理由见 §3.2 —— 它**不是** R606 形态，对象化反而破坏既有标量契约。故本篇「同族」实为 **5 处对象数组循环**，不含 matrix。

## 二、根因（与 R606 同构，确定性）

行级 `wx:for` 用 `wx:key="index"` / `wx:key="idx"`（**位置键**）+ 每次按键 `setData` 整体重赋值整个数组
（`slice()`→改某下标→`setData({整个数组})`）⇒ 原生 `<input>` 按下标复用 DOM 节点 ⇒
重渲染后节点身份错位 ⇒ **首行能填、下方行「填不进 / 丢焦点 / 输入即丢」**。

## 三、整改清单（已落地，全部未提交 · 受 R605 约束）

### 3.1 五处对象数组循环（注入稳定 `rid` 键）

| # | 模块 | 文件 | 循环 / 字段 | wxml 改键 |
|---|------|------|------------|-----------|
| 1 | 外卖分项 items | `subpkg/biz/takeaway/index.js` + `.wxml` | `items` 行级 editable | 行 20：`wx:key="index"`→`rid` |
| 2 | 外卖分项 packs | `subpkg/biz/takeaway/index.js` + `.wxml` | `packs` 行级 editable | 行 31：`wx:key="index"`→`rid` |
| 3 | 菜品卡 comboLines | `subpkg/biz/card/edit.js` + `.wxml` | `comboLines`（组合子项行） | 行 228（含 `wx:for-item="cl" wx:for-index="ci"`）：`wx:key="index"`→`rid` |
| 4 | 菜品卡 lines | `subpkg/biz/card/edit.js` + `.wxml` | `lines`（明细行，原 `wx:key="idx"` 字面量更糟） | 行 103：`wx:key="idx"`→`rid` |
| 5 | M3 菜品拆分 | `pages/m3/dishreview/index.js` + `.wxml` | `splitRows`（拆分比例行） | 行 120（含 `wx:for-index="si"`）：`wx:key="index"`→`rid` |

**统一范式**（镜像 R606 `month/input.js`）：
- 模块级 `const _ridPrefix = 'k' + Date.now().toString(36) + '_'` + 自增 `let _ridSeq`；
- `ensureRid(r)`：仅在 `rid` 缺失时写入；改价 / 重装饰走 `Object.assign` / `filter` / `slice` 保留 `rid` ⇒ 跨次键入稳定；
- 会话前缀保证会话内唯一、跨会话（含已落库行回填）不重号；
- **提交载荷在 `buildOrder` / `doSave` / `buildCalcLines` / `onSplitCalc` 等处重建干净 payload（不含 `rid`）**——`rid` 纯渲染层键，不进计算、不进保存契约。

### 3.2 matrix 维度档位：经审计豁免（非 R606 形态，不纳入本轮修复）

`subpkg/tools/sandbox/matrix.js` 的五个维度档位（rent/labor/margin/target/other）原为**标量数组**（如 `rent:[5000,8000,10000]`）喂 `<input>`。
初判「位置键同样致错位」遂改为对象包裹 `[{v, rid}]` 并改 wxml 取 `item.v`。但随即被权威守卫暴露问题：

- `check_m2_partial_behavior.js` **原样 require `matrix.js`** 并以标量 `dims={rent:[5000,...],...}` 调 `onGenerate`；
  对象化后 `onGenerate` 读 `r.v` 得到 `undefined` ⇒ 判「维度档位不能为空」⇒ 云端调用 0 次（A1/B1/D0…全红）。
- `check_m2_matrix.js`（静态契约守卫）的 R331/R335/R345 判据依赖 `matrix.js` 字面形态，对象化后判据失配（3 处红）。
- 云端 `onGenerate` 同样期望标量值。

**关键判定**：matrix 维度档位在键入时按位更新（`dims[dim][idx] = val`），**数组长度与顺序在键入过程中不变** ⇒
不会触发「节点身份错位 / 填不进」；对象化包裹除破坏标量契约外无任何收益。

⇒ **回退 `matrix.js` / `matrix.wxml` 至原始标量实现**，并在 `check_wxkey_stable.js` 的 `WHITELIST` 中显式豁免
`subpkg/tools/sandbox/matrix.wxml`，注释写明：标量维度档位、位置键安全；若 matrix 将来改为可重排 / 可增删行，须撤销此豁免。

## 四、通用回归守卫（把整类缺陷锁死）

新增 `tools/check_wxkey_stable.js`（登记进 `verify_all.js` SUITES，套件名 `wxkey-stable`；头部注释 `228 个套件` → **229 个套件**，知识存储点同步）：

- **纯函数**：`stripComments`（剥注释避免误杀文档写法）/ `findClose`（同名标签深度匹配闭合）/ `findLoops`（抽取含 `<input>`/`<textarea>` 的 `wx:for` 循环）/ `judgeWxml`（位置键 `index`/`idx` 判违规，稳定键 `rid` 放行）；
- **6 项影子样本自证**：C1 位置键+输入必红 / C2 等价 `rid` 改正必绿（不误杀）/ C3 字面量 `idx` 必红 / C4 无输入循环不误伤静态列表 / C5 注释里的举例写法不误杀 / C6 循环体内嵌套 `<input>` 必抓；
- **扫描面下界**：`walk` 全仓 `*.wxml`，`MIN_FILES=20` 护栏（实扫 31 文件），防扫描面被悄悄写窄；
- **R606 锚点**：`input.wxml` 的 `g.rows` 4 处循环必须 `wx:key="rid"`（用 `forExpr` 精确匹配，避免误伤外层分组循环）；
- **白名单**：`subpkg/tools/sandbox/matrix.wxml` 显式豁免（见 §3.2，标量维度档位位置键安全）；
- **末行纪律**：`===== R606-bis wx:key 稳定性 守卫结果：N 通过 / M 失败 =====` + `process.exit(fail===0?0:1)`，中间行不出现「N 通过 / M 失败」总口径（避免 `check_suite_assert_counts` 误判）。

## 五、证据

- 4 个编辑过的 JS 文件 `node --check` 全部 OK（takeaway/index.js、card/edit.js、dishreview/index.js、month/input.js〔R606 原修复〕）；
- 守卫 `node tools/check_wxkey_stable.js`：**8/0**，EXIT=0（6 影子样本 + 扫描面下界 31 + matrix 白名单跳过 + R606 锚点命中 4 处均 `wx:key="rid"` + 全仓 0 违规）；
- `node tools/check_m2_matrix.js`：**191/0**（确认 matrix 回退未破坏 M2 矩阵守卫）；
- `node tools/check_m2_partial_behavior.js`：**15/0**（确认 matrix 回退后 onGenerate 行为面正常）；
- 全量门禁（Python 驱动 `run_gate_py.py`，绕开沙箱「禁 node 派生子进程」限制）：**229/229**（R92 套件入库用真实 `git ls-files`，新守卫文件已 `git add` 进索引；受 R605 约束未 `commit` / 未 `push`）。

## 六、风险与待办

- ⚠️ **真机走查**：R606 原「外卖净额多平台」场景需李老师真机复点（首行 + 下方行均可键入）。本次新增的 takeaway/card/dishreview 三处同理，建议一并真机走查。
- ⚠️ **R605 推送暂缓**：资质问题（个人 vs 个体户）暂未定，`dev` 领先 `origin` 9 commits 含付费墙/主体代码，推送与部署暂缓。本次改动**全部未提交**；新守卫文件仅 `git add` 进索引以满足 R92 入库判据，未 `commit`、未 `push`。待资质确认后可整批提交。
- ⚠️ **matrix 白名单前提**：仅在 matrix 维度档位保持「标量 + 按位更新、不重排」时成立。若未来 matrix 改为可增删/重排行，必须撤销 `WHITELIST` 中该豁免并改用稳定键，否则本守卫会漏报。
- **沙箱约束**：本环境禁止 `node` 派生 `node` 子进程，`verify_all.js` 直跑会被拦；本轮门禁经 Python 侧逐个 `node <套件>` 跑出真实结果（非缓存）。
