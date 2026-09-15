# 批次 1 · POC3 双利润引擎 · 交付文档

> 生成时间：2026-09-15 15:1x ｜ 投喂对象：**InsCode 桌面版**（模型 `deepseek-v4-flash`）
> 需求来源（逐字未改）：`specs/dev-specs/delivery/批次1_提示词_可直接复制.txt`
> 投喂载荷（原文 + 本轮 5 条硬约束）：`%TEMP%\inscode\payload_batch1.txt`（6,618 B）
> 本批只做**算法**：不含前端页面、不含数据库写入、不含摊销算法（摊销由外部传入）。

---

## 一、复核：投喂起点是**批次 1**（不是批次 0）

| 依据 | 证据 |
|---|---|
| 批次 0 交付文档在库 | 根目录 `BATCH0_DELIVERY.md`（2026-09-12），五点验收全落地 `cloudfunctions/common/` |
| 批次 0 已入 dev | 里程碑 `8e7e37f` 批次 0 工程地基入 dev（`★知识存储点` §1.1 :83「批次 0（工程地基）已交付」） |
| 批次 0 自测**现场实测** | `node cloudfunctions/common/__tests__/batch0_selfcheck.js` → **20 通过 / 0 失败**（EXIT=0） |
| 批次 1 自身前提 | 提示词 §1「基于批次 0 的地基（已自带鉴权/错误码/时间工具）」 |

⇒ 投喂包「批次 0 → 7 顺序」是**序列顺序**；批次 0 这一格**已由 WorkBuddy 建好并入库**，**不再投给 InsCode**（重投会重写已验收冻结的 `cloudfunctions/common/`，返工面 = 后面全部批次）。

---

## 二、本轮额外硬约束（投喂时追加，原文未改）

1. 禁止修改/删除 `cloudfunctions/common/` 下任何文件（批次 0 地基已验收冻结，只能调用）。
2. 代码放在新建目录 `cloudfunctions/calcMonthlyProfit/`，目录内文件**一律平铺、禁止子目录**（云端不认子目录）。
3. 引公共层写 `require('./common')`（扁平派生 `common.js` + `cx_*.js`，由 `node tools/sync_common.js` 生成）。
4. 本批只**新增**文件；不改 `initDb/`、`miniprogram/`、`specs/`。
5. 完成后逐条自测验收锚点，给「预期 / 实际 / 是否通过」表。

---

## 三、产出文件（全部新增，`cloudfunctions/calcMonthlyProfit/`）

| 文件 | 角色 |
|---|---|
| `index.js` | Controller：`resolveAuth` → `assertShopOwner` → 参数校验 → **读 `shop_switch` 服务端权威开关** → 传干净数据给 Service |
| `service.js` | **Service 层纯计算**（不引 `wx-server-sdk`、不碰库、不碰请求），**口径锁**实现处 |
| `selftest.js` | 12 锚点自测 + 口径锁专项 + 差异自洽校验 |
| `package.json` | 仿 `smokeTest` 的依赖声明 |
| `common.js` + `cx_*.js`（9 个） | **扁平派生副本**（InsCode 自行跑了 `sync_common.js` 生成） |

---

## 四、验收回执

### 4.1 项目门禁（`node specs/dev-specs/prototype/check_error_codes.js`）
**exit 0 —— A–L 全绿**，其中 **L 组**（common 扁平副本 ≡ 单源派生）**3 个云函数目录全过**。

### 4.2 12 条锚点（`node cloudfunctions/calcMonthlyProfit/selftest.js`）
**12/12 通过，EXIT=0**；口径锁专项 `S2 经营参考利润 = 9160` ✅；差异自洽（经营−全要素=差异）S1/S2/2-R 均 true。
**WorkBuddy 已手工独立复算 12 个预期值，全部一致**（未只信其自测表）。

### 4.3 变异测试（证明自测**有鉴别力**，不是假绿）
把 `service.js` 中经营参考利润的 `directConsumeFen` 篡改为 `realConsumeFen`（故意破坏口径锁）：

| | 结果 |
|---|---|
| 变异体 | 锚点 **#8 S2 经营参考利润 9,160 → 8,160 ❌ 失败**，**EXIT=1** |
| 还原后 | 12/12 通过，**EXIT=0** |

⇒ 自测**确实**能抓到口径锁被"好心修正"，绿灯有意义。

### 4.4 硬约束核验
- `cloudfunctions/common/` **未被动过** ✅（`git status -- cloudfunctions/common/` 为空）
- 新函数目录内**无子目录** ✅（`find -type d` 只有自身）
- 未新增前端页面 ✅（`.inscode/` 内只有本地 AI 编辑元数据，无 html；已加 `.gitignore`）

---

## 五、留给复审方的 3 个判读点（**非缺陷，是口径边界**）

1. **S2 的「菜品毛利」取哪个消耗？** 本项目锚点只钉了 **S1 的毛利率 65.625%（#4）**，**未钉 S2**。实现取 `食材成本 = 真实消耗(倒轧 23,000)` → S2 毛利 41,000、毛利率 64.06%。**InsCode 主动就此推理并说明**（源码注释与回答里均写明）。若业务口径要求 S2 毛利也用直填 22,000，则需改 `service.js:52` 并**补锚点**（现在无锚点可判，属规范空白）。
2. **首建档审计缺失（P2）**：`index.js:28` 以 **2 参**调用 `resolveAuth(ctx, db)`，未传 batch 0 的可选 `audit` 写入器 → 首次进入的**自动建档不会写 `audit_log`**（batch 0 点1b 要求建档写 `AUTH_AUTO_PROVISION`）。已实测 2 参调用**不会崩**（`auth.js:51` 对 audit 有 `typeof write === 'function'` 守卫）。本批无写操作、不影响算法结论，但**跨批一致性**上建议后续批次补 `audit`。
3. **金额字段命名**：`index.js:147` 明细项接受 `amountFen`/`amount_fen` 双写法，而外层入参用 `snake_case`（`direct_consume_fen` 等）。建议在批次 2 起统一为 `snake_case` 单一写法，避免前后端两套。

---

## 六、投喂通道的技术留痕（避免重踩）

- **搜狗输入法吞字母**：`keybd_event` 打 `wbtest123` 落进输入框只剩 `25123` ⇒ **长中文/任意文本一律走剪贴板 + Ctrl+V**（粘贴原子、不丢字）。
- **`SendMessage(WM_CLOSE)` 永久阻塞**：被关窗口弹模态（记事本「是否保存」）时 SendMessage 不返回 ⇒ 收尾用 `PostMessage` + 看门狗。
- **64 位指针**：`GlobalAlloc/GlobalLock/GetClipboardData` 必须设 `restype = c_void_p`，否则指针截成 32 位 → `GlobalLock` 返 0 → 访问违例。
- 可复用技能：`~/.workbuddy/skills/inscode-desktop-feed/`（含 `scripts/inscode_ui.py`）。

---

## 七、后续修订（2026-09-15 · 复审 round3 R19/R20，**正文不改写，本节追加**）

> §4.2 / §5.3 的原文描述已**部分过期**，以本节为准。

1. **自测判据升级（R19）**：12 条金额锚点由「元展示串 + ±0.01 容差」改为**整数分严格相等 `===`**（`exp` 现为分：`916000 / 347667 / 568333 / 2300000 / 2100000 / 547667 …`）；仅 `#4 毛利率`保留 ±0.01（比率）。`diffCheck` 与口径锁由"打印"升级为**断言**，三场景不一致即 exit≠0。
   - **原因**：同一份「末步 +1 分」变异下，`#6/#12` 被拦下而 `#9`（S2 全要素 3,476.67）因浮点差恰为 `0.0099999999997635 ≤ 0.01` 被**放行** —— 判据实际取决于落在容差哪一边，等于把 N9/N11/N17 的"容差掩膜"重新请回。
2. **契约字段收口（R20）**：`index.js` 的明细项**不再双收** `amountFen`/`amount_fen` —— 契约层只认 `amount_fen`；只传 `amountFen` 明确回 `INVALID_PARAM`，两者并存且不相等亦拒收。（对应原 §5 第 3 点的**判读点已关闭**。）
3. **`cleanItems` 校验**由 `%TEMP%\round3_r19\check_cleanitems.js` 覆盖 10 条用例（`index.js` 顶层 require `wx-server-sdk`，无法整体加载，按括号配平截取函数原文测试）。
4. **契约表出处**：`specs/dev-specs/core/10` 的入参/出参已统一 `snake_case` + 金额 `*_fen`，与该处实现逐字对齐。

**当前状态**：`node verify_all.js` → 9/9 PASS（批次 1 自测已接进总闸）；门禁 A–L exit 0。
