# REVIEW_2026-09-15 round6 · 复核（R23–R27 全落地确认 + 3 个新发现）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 6 轮**。
> 触发：用户转达「R23–R27 全落地、已推送、§6 回执已写进 round5」。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round5-pickup.md`（R23–R27）。

---

## §0 结论：**这一轮干净落地，且协议断点真的修好了**

**R23–R27 全部 ✅**，我用**自己的方法**逐条复测（不是读回执）；提交与推送核对无误；**取件断点**这轮没再犯。

| 流程判据 | 实测 |
|---|---|
| 提交 / 推送 | `568c65d` = HEAD = `origin/dev`（**已推，无未推**）；两个提交 `87806cb` + `568c65d` |
| 工作区 | **干净**（无未跟踪遗留） |
| `review/` 入库 | **9 份全部跟踪**（round4 + round5 这次都进去了） |
| §6 回执位置 | ✅ 在 **round5** 文件末尾（只追加，前缀比对 `StartsWith=True`）；并明确抄录了两条裁决（R27 不留口子 / R24 合并批次 4 一行） |
| round4 是否被误改 | ✅ **哈希完全相同**（它把首轮误塞的回执撤回干净了） |
| 提交内容 | `87806cb` 含：`app.json`、`index.js`、`selftest.js`、**新增 `validate.js`**、`core/10`、投喂包 MD + html + 批次2/批次4 txt、门禁、重启键、`tools/verify_docx.py`、两份 review |

---

## §1 逐条复测证据（我的方法 → 结果）

| 条 | 我的复测 | 结果 |
|---|---|---|
| **R23** | 读 `app.json` 全文 + 搜 `projectConfig` | ✅ 块已删净（文件末尾为 `"style": "v2"` 后直接 `}`）；`projectConfig` 命中 **0** |
| **R24** | 单源 + **三个派生件**逐一搜 | ✅ `:298` 已是 `target_month`；**`:134` 未被误改**（仍是"前端一律 camelCase"示例）；批次 4 新行在 `:535`。派生件：`targetMonth` 残留 **0**；`target_month` 命中 **3**（md + `批次2.txt` + html）；`表单金额必须先转` 命中 **3**（md + `批次4.txt` + html） |
| **R25** | 读 `core/10:18` | ✅ `{ page, page_size }`；同文件 `:107/:110` 一致 |
| **R26** | ①**哈希比对**脚本 ②搜 §10 | ✅ `tools/verify_docx.py` 与**我验证过的那个版本 SHA256 逐字节相同**（`04E13C73EF800930…`）—— 它没被改过，所以我的双向验证结论直接适用；§10 `:407-412` 已写清派生链（cp → md2docx_portrait → docx2pdf_word）+「一文件一实例」+「中文名走临时英文」+「`*.pdf` gitignored」+ verify_docx 自检 |
| **R27** | **自己写 23 条对抗用例**直接打 `validate.js` | ✅ **23/23 全符预期**：数字/0 放行；`"100"`/`"0"`/`100.5`/`-1`/`true`/`[]`/`{}`/`NaN`/`Infinity` 全部 `INVALID_PARAM`；`undefined`/`null` 仍按设计回落 0；库存三字段同规则；明细 `{amountFen:100}`（camel-only）拒、`{amount_fen:100,amountFen:200}` 冲突拒、`{amount_fen:"100"}` 拒；**错误信息点名了字段**（`amortize_fen 必须是「分」非负整数（JSON number，字符串不接受）`） |
| **重构是否留残影** | 读 `index.js` | ✅ `index.js` 已从 154 行降到 90 行，顶部 `require('./validate')`（`:19`），**旧的 `validateInput`/`cleanItems` 定义已无残留**（无重复实现） |
| **总闸** | `verify_all` 我跑不了（EPERM）→ **逐个跑 9 个成员** | ✅ **9/9 exit=0**（门禁 A–L / seed / poc1-4 / batch0 / batch1 / 静态路径） |

**裁决落地确认**：R27 **不留口子**（已按令执行）；R24 的批次 4 那一行与 `target_month` **确实在同一次编辑、同一次派生重生**里完成（3 处派生件同步命中可证）。

> 记一功：把 `validateInput`/`cleanItems` **抽成 `validate.js`** 是个正确的额外判断 —— `index.js` 顶部 `require('wx-server-sdk')` 导致原函数无法在纯 Node 下单测，抽出来后 R27 才**可被机器验证**（你加了 4 条用例，我又独立加了 23 条）。这正是本项目"验证要能失败才算验证"的做法。

---

## §2 本轮新发现（3 条，均不阻塞）

### R28 🔵 `tools/check_requires.js` 不扫 `cloudfunctions/` —— 而那正是"模块找不到"咬过本项目两次的地方

- 证据：`check_requires.js:25` 只扫 `['pages','miniprogram','utils']` + `app.js`。文件头自述其诞生原因是 **A8（`app.js` 的 `require('./config/env.js')` 路径写错）**，属**小程序侧**盲区；
- 但云函数侧才是真正"上云才炸"的地方：`require('../common')` → `MODULE_NOT_FOUND`、子目录被拼成 `common\xxx.js` → `MODULE_NOT_FOUND`（`4e995a1` 全线扁平化的起因）。而云函数里现在有 **30+ 条相对 require**（`./common`、`./cx_*`、`./service`、**新加的 `./validate`**、`./collections` …），**全部没有静态检查**覆盖。
- **我实测了"直接加 `cloudfunctions` 会怎样"，结果很有信息量**：立刻报 2 处，但**两处都不是真错，是实现细节导致**：
  1. `cloudfunctions/common/index.js -> require('./common')` —— 这行是**注释**（`:4`）被正则 `require\(\s*['"]…['"]\s*\)` 匹配到了 ⇒ **检查器没有剥注释**（这个缺陷对现有小程序侧同样存在，只是当前恰好没踩到）；
  2. `cloudfunctions/smokeTest/index.js -> require('./common/index.js')` —— 这是**探针故意写的 fallback**（见 R29），本来就允许失败。
- **修法**（三步，做完应立刻转绿）：
  1. `:25` 的目录数组加 `'cloudfunctions'`（`walkJs` 已排除 `node_modules`）；
  2. **匹配前剥行注释**（如先 `src.replace(/^\s*\/\/.*$/gm, '')`，或至少跳过以 `//` 开头的行）—— 否则注释里的示例路径会持续误报；
  3. 给探针留一个**显式豁免**（例如白名单 `cloudfunctions/smokeTest/index.js`，或约定 `// require-check-ignore` 行内标记），并在注释里写明为什么豁免。
- **验收**：`node tools/check_requires.js` → exit 0，且**扫描面里出现 `cloudfunctions`**（把 `:55` 的提示语改成"小程序侧 + 云函数侧"以免下次又以为是只扫前端）；
  **变异验证（必做）**：把 `calcMonthlyProfit/index.js` 的 `require('./validate')` 临时改成 `require('./validates')` → 期望 **exit 1 并点名该文件**；还原后 exit 0。

### R29 🔵 探针 `smokeTest/index.js` 的诊断信号**已随扁平化失效**，可能误导下一次排查

- 证据：`:19` 的 fallback `require('./common/index.js')` + `:18` 注释「兜底：目录解析失败时直接指到 index.js」—— 这是**子目录方案时代**的写法；`4e995a1` 扁平化后 `cloudfunctions/smokeTest/` 下**没有 `common/` 目录**，所以这条 fallback **永远不可能成功**。
- 更要注意 `:27` 的 `fsDiag.hasCommonDir = fs.existsSync(__dirname + '/common')` —— 扁平化后它**恒为 `false`**，但字段名读起来像"没打进包"。将来谁再跑一次探针，很可能把「`hasCommonDir:false` + fallback: Cannot find module」误读成部署故障，白查一轮。
- **修法**：把诊断改成**贴合扁平设计**——加 `hasCommonFile: fs.existsSync(__dirname + '/common.js')`（这才是现在的判据），删掉那条 `common/index.js` fallback（或加注释标明"历史方案，已不适用"），并把 `hasCommonDir` 的语义在注释里写死（"恒 false 属预期"）。
- **验收**：跑探针时 `hasCommonFile === true`；文件里搜 `common/index.js` → 0（或仅存于"历史"注释）。

### R30 🔵 明细"相等并存"的宽容度，请**明确留痕**（是裁决，不是疏漏）

- 实测行为（我的 23 条用例里的 C4）：`{ amount_fen: 100, amountFen: 100 }`（两字段并存且相等）→ **放行**；
  `{ amountFen: 100 }`（只有 camel）→ **拒**；`{ amount_fen:100, amountFen:200 }`（冲突）→ **拒**。
- 我原句是「只锁一个」。你实现的是「camel 单独出现必拒、冲突必拒、相等并存放行」——**这是可辩护的设计**（冗余但不歧义），但按本项目"响亮失败优于静默漏检"的口味，它仍是一处**静默容忍**：前端同时写两个字段名，本身就是"字段名没统一"的信号。
- **修法（二选一，但必须选一个并留痕）**：
  - (a) **收紧**：`amountFen` 只要出现就拒（哪怕相等），错误信息提示统一用 `amount_fen`；
  - (b) **保留**：在 `core/10` 的 `calcMonthlyProfit` 注里补一句「`amount_fen` 为唯一契约字段；`amountFen` 仅在**与前者相等**时被容忍（向后兼容），单独出现或冲突一律 `INVALID_PARAM`」，并在 `validate.js:33` 那一行的注释里点明这是**有意的兼容**而非遗漏。

---

## §3 仍在你/李老师这一侧的一步

**R23 的编译确认**：删块后请在微信开发者工具**编译一次**（我只读沙箱跑不了工具）。影响面我已量化到最小：**1 文件 3 行、零消费者**（全仓库仅 `app.json` 提到 `projectConfig`，无任何 js 读取，`project.private.config.json` 亦无 appid）。若工具报错，退路 = 把它挪进 `project.private.config.json`（该文件 gitignored）。

---

## §4 能力边界

- **`verify_all` 端到端跑不了**（`spawnSync … EPERM`）；我用**逐成员**（9/9）替代。你回执里的 9/9 与我一致。
- **远端 push 核不了**（`git ls-remote` 超时）；`origin/dev = 568c65d` 是本地远端引用 —— 按"从本仓推送"这一前提采信（前几轮该引用均随提交前进）。
- **编译器/开发者工具行为核不了**（R23）；**Word/PDF 呈现核不了**（我只核文本层与文件属性）。
- **R27 的验收我做的是"纯函数层"对抗测试**（直接打 `validate.js`，23 条）；**云端端到端**（真 `wx.cloud.callFunction` 传字符串）仍未被真云验证过 —— 但 `validate.js` 是纯函数且 `index.js` 只做委托，所以这层结论对线上行为有直接说服力。

---

## §5 执行回执（WorkBuddy · 2026-09-15）

> 本轮动作：① 投喂**批次 2**（POC1 摊销边界与尾差残值）给 InsCode 并独立验收；② **R28/R29/R30 本轮不执行** —— 你已裁决「不阻塞投喂」，本轮按其聚焦批次 2，三条转下一轮 backlog。

### 批次 2 投喂与验收（详见根目录 `BATCH2_DELIVERY.md`）
- 载荷：`批次2_提示词_可直接复制.txt` + 6 条硬约束（**第 6 条承接 R19**：整数分严格断言 + ±1 分变异回验）→ `%TEMP%\inscode\payload_batch2.txt`（5,001 B）。
- 通道：剪贴板 + Ctrl+V。**首次 mid-stream 断流**（InsCode 报「服务在回复结束前关闭了连接」，停在 6%、未落盘）→ **把同一载荷粘回重发一次即成功**。
- 产出：`cloudfunctions/calcAmortize/`（`service.js` 175 / `validate.js` 99 / `index.js` 97 / `selftest.js` 164 / `package.json` + 扁平 `common.js`·`cx_*.js`）。
- **验收（我自己跑，非读它的自测表）**：
  - `node cloudfunctions/calcAmortize/selftest.js` → **42/42，EXIT=0**（判据＝整数分严格 `===`，无容差）。
  - 4 个 POC1 锚点**手工复算一致**：9,333.36 / 6,000.00 / 4,683.33 / 3,333.45（分：`933336 / 600000 / 468333 / 333345`）。
  - **外部变异**（删 `service.js` 尾差倒挤行）→ **EXIT=1**，失败项 `装修末月2028-12=3,333.33`、`装修全程累计=11,999,988`；还原后 42/42。⇒ 绿灯有鉴别力。
  - 门禁 A–L **exit 0**；`node verify_all.js` → **10/10**（已把 `calcAmortize/selftest.js` 接进 `SUITES`，与 R21 接批次 1 同一约定；头部注释 9→10 同步）。
  - 硬约束：`cloudfunctions/common/` 未动、新目录无子目录、未新增前端页。
- **留给复审的 3 个判读点**（非缺陷，是口径/边界；原文见 `BATCH2_DELIVERY.md §五`）：① `shop_amortize` 回写形态与「资产台账」语义冲突（写入行**缺 `total_value`** → 二次读 `docToAsset` 会抛 `INVALID_PARAM`；是否拆表或先删旧行请裁决）② 回写纯 INSERT **无幂等** ③ `docToAsset` 用 `Number()` 对 DB 读数宽容（与 `validate.js` 对入参严格是两套口径）。

### R23（仍在你/李老师侧）
- 我**核不了**：本沙箱无微信开发者工具/编译器。文件层已核：`app.json` `projectConfig` 命中 **0**，影响面 1 文件 3 行、零消费者（与你 §3 的量化一致）。**编译确认请你在工具里跑一次。**

### R28 / R29 / R30（本轮未动，转下一轮）
- 三条按你「不阻塞投喂」的裁决延后。执行时按你给的修法 + 强制变异验证（`check_requires.js` 加 `cloudfunctions` 扫描 + **剥行注释** + 探针显式豁免；`./validate`→`./validates` 必须 exit 1 并点名）走。

### 提交
- `___COMMIT___`（含 `cloudfunctions/calcAmortize/*`、`verify_all.js` 接批次 2、本回执、round6 入库、`BATCH2_DELIVERY.md`），`git push origin dev`。
