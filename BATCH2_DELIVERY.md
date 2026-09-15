# 批次 2 · POC1 摊销边界与尾差残值 · 交付文档

> 生成时间：2026-09-15 19:40 ｜ 投喂对象：**InsCode 桌面版**（模型 `deepseek-v4-flash`）
> 需求来源（逐字未改）：`specs/dev-specs/delivery/批次2_提示词_可直接复制.txt`
> 投喂载荷（原文 + 本轮 6 条硬约束）：`%TEMP%\inscode\payload_batch2.txt`（5,001 B）
> 本批只做**摊销算法**：无前端页面；`calcAmortize` 为 Service 层纯计算，输出对接批次 1。

---

## 一、复核：投喂起点是**批次 2**（批次 0/1 均已交付冻结）

| 依据 | 证据 |
|---|---|
| 批次 0 地基在库且冻结 | `node cloudfunctions/common/__tests__/batch0_selfcheck.js` → **20 通过 / 0 失败**（点4 env.js 占位符属部署前置，非单测可判真） |
| 批次 1 已交付 | `BATCH1_DELIVERY.md`；`cloudfunctions/calcMonthlyProfit/` 自测 12/12 |
| 批次 2 自身前提 | 提示词 §1「基于批次 0 地基」，§3「时间工具复用批次 0」 |

⇒ 只投批次 2；`cloudfunctions/` 下**只新增** `calcAmortize/`，不动既有目录。

---

## 二、本轮额外硬约束（投喂时追加，原文未改）

1. 禁止修改/删除 `cloudfunctions/common/` 下任何文件（批次 0 地基已验收冻结，只能调用）。
2. 代码放在新建目录 `cloudfunctions/calcAmortize/`，目录内文件**一律平铺、禁止子目录**（云端不认子目录）。
3. 引公共层写 `require('./common')`（扁平派生 `common.js` + `cx_*.js`，由 `node tools/sync_common.js` 生成）。
4. 本批只**新增**文件；不改 `initDb/`、`miniprogram/`、`specs/`。
5. 完成后逐条自测验收锚点，给「预期 / 实际 / 是否通过」表。
6. **（本轮新增 · 承接 R19）自测必须用「整数分严格 `===`」断言**（如 9,333.36 元 = `933336` 分），**禁止 ±0.01 元容差**（那会掩盖 ±1 分误差）；每个金额锚点都要做 **`+1 分` 变异回验**证明判据有鉴别力。金额型字段参数校验同样按批次 1 `validate.js` 纪律：非 JSON number 一律 `INVALID_PARAM`，错误信息点名字段。

---

## 三、产出文件（全部新增，`cloudfunctions/calcAmortize/`）

| 文件 | 行数 | 角色 |
|---|---|---|
| `service.js` | 175 | **Service 层纯计算**（不引 `wx-server-sdk`、不碰库、不碰请求）；**尾差倒挤**实现处 |
| `validate.js` | 99 | 入参校验（纯函数、无云依赖、可单测）；沿用 R27 纪律 |
| `index.js` | 97 | Controller：`resolveAuth` → `assertShopOwner` → `validateInput` → `DataAdapter.list('shop_amortize')` → `calcAmortize` → 回写台账 |
| `selftest.js` | 164 | 42 项断言（含 ±1 分变异回验 + 「末月不倒挤」注入变异） |
| `package.json` | — | 仿 `smokeTest` 的依赖声明（`wx-server-sdk ~2.6.3`） |
| `common.js` + `cx_*.js`（9 个） | — | **扁平派生副本**（InsCode 自行跑了 `sync_common.js` 生成） |

**尾差倒挤实现位置**：`service.js` 的 `amountForMonthFen()` 末月分支 ——
`if (end === naturalEnd) return asset.total_value - base * (N - 1);`（自然到期末月倒挤）；提前终止末月仍按 `base`，残值由 `calcResidualFen()` 单独计。

---

## 四、验收回执

### 4.1 项目门禁（`node specs/dev-specs/prototype/check_error_codes.js`）
**exit 0 —— A–L 全绿**，其中 **L 组**（common 扁平副本 ≡ 单源派生）含 `calcAmortize/` 一并通过。

### 4.2 42 项自测（`node cloudfunctions/calcAmortize/selftest.js`）
**42 通过 / 0 失败，EXIT=0**。判据为**整数分严格相等**（无容差）。

| POC1 锚点 | 应为 | 实测（分 / 元） |
|---|---|---|
| 旧空调残值（2026-08 报废） | 9,333.36 | `933336` / 9,333.36 ✅ |
| 招牌已摊合计 | 6,000.00 | `600000` / 6,000.00 ✅ |
| 2026-08 三资产合计 | 4,683.33 | `468333` / 4,683.33 ✅ |
| 装修末月（2028-12） | **3,333.45**（非 3,333.33） | `333345` / 3,333.45 ✅ |

**WorkBuddy 已手工独立复算 4 个锚点，全部一致**（未只信其自测表）：
- 旧空调：`round(1200000/36)=33333`；区间 `[2026-01,2026-08]`＝8 期；8×33333=`266664`；残值 `1200000−266664=933336` 分 ✓
- 招牌：`round(600000/12)=50000`；末月（自然到期）倒挤 `600000−50000×11=50000`；合计 `600000` 分 ✓
- 装修末月 2028-12：`12000000−333333×35=333345` 分（是 .45 不是 .33）✓
- 2026-08 三资产：装修 `333333` + 加盟费 `round(3000000/24)=125000` + 冰柜 `round(600000/60)=10000` = `468333` 分 ✓

### 4.3 变异验证（证明自测**有鉴别力**，不是假绿）
把 `service.js` 尾差倒挤行 `return asset.total_value - base * (N - 1);` 篡改为 `return base;`（故意取消尾差倒挤）：

| | 结果 |
|---|---|
| 变异体 | **EXIT=1**，失败项：`装修末月 2028-12 = 3,333.33`（应 .45）、`装修全程累计 = 11,999,988`（应 12,000,000）、`未注入时 2028-12 = 3,333.45` |
| 还原后 | 42/42，**EXIT=0** |

⇒ 自测**确实**能抓到「没做尾差倒挤」这一最高频错误，绿灯有意义。（变异在临时副本上跑，仓库零污染。）

### 4.4 硬约束核验
- `cloudfunctions/common/` **未被动过** ✅（`git status -- cloudfunctions/common/` 为空）
- 新函数目录内**无子目录** ✅（`find calcAmortize -mindepth 1 -type d` 为空）
- 未新增前端页面 ✅（`git status --untracked-files=all` 仅 `cloudfunctions/calcAmortize/*`，无 html/页面）

### 4.5 总闸
- `node verify_all.js` → **10/10 套件通过**（本轮把 `calcAmortize/selftest.js` 接进 `SUITES`，与 R21 接入批次 1 同一约定；头部注释数量同步 9→10）。

---

## 五、留给复审方的 3 个判读点（**非缺陷，是口径/边界**）

1. **回写 `shop_amortize` 的形态可能与「资产台账」语义冲突（建议裁决）**：`shop_amortize` 在投喂包 §2.4 被定义为 **A 类锁定表「摊销资产台账」**（一行一资产），而 `index.js:79-93` 把**当月摊销明细**（`{shop_id, month, asset_id, amount_fen, …, residual_loss}`）逐行 **INSERT** 进同一张表。两个后果值得判：
   - (a) **语义混装**：资产登记行与月度摊销行同表；`da.list('shop_amortize')` 下一次会把月度行也当"资产"读出来；
   - (b) **二次调用会炸**：写入行**不含 `total_value`** → 再读时 `docToAsset`（`index.js:64-65`）对 `Number(undefined)=NaN` 抛 `INVALID_PARAM`。
   - 本批提示词只写了「写入 `shop_amortize` 表」未定义表形态，实现按字面执行；**是否要拆「资产台账 / 月度摊销明细」两表、或写入前先按 `(shop_id, month)` 删旧行**，请复审裁决。
2. **回写无幂等**：`writeMonthlyAmortize` 为**纯 INSERT、无去重**；同一 `month` 重复调用会累积重复行（批次 1 的 `saveLedger` 有 `client_request_id` 幂等，本批提示词未要求）。属规范空白。
3. **`docToAsset` 用 `Number(doc.total_value)` 强制转换**：对**服务端台账读取**做数值宽容（DB 读数应是整数分）；与 `validate.js` 对**接口入参**的严格 `typeof==='number'` 是两套口径。是否要统一为严格，请判。

---

## 六、投喂通道的技术留痕（避免重踩）

- **本轮首次尝试曾「回复未完整返回」**（InsCode 报「服务在回复结束前关闭了连接，可能是网络或服务超时」，进度停在 6%，文件未落盘）→ **重新把载荷粘回输入框再发一次即成功**。⇒ 长任务遇 mid-stream 断流时，**先重发同一载荷**即可，不必换模型。
- 剪贴板 + Ctrl+V 通道仍然可靠（自检 `readback=SELFCHECK-OK` → 粘贴后截图核对首行 → 回车）。
- **会话视图下聊天输入框位置会随内容变化**（欢迎态约 `y=573`；会话态约 `y=870`，屏幕 1920×1080）—— 代点前先截图定位。
- 可复用技能：`~/.workbuddy/skills/inscode-desktop-feed/`（含 `scripts/inscode_ui.py`）。

---

**当前状态**：`node verify_all.js` → **10/10 PASS**；门禁 A–L **exit 0**；批次 2 自测 **42/42**。
