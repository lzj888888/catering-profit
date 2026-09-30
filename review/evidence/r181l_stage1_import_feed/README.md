# R181l · 阶段① 账单导入（批次 F）投喂证据

> 建立：2026-10-01 00:4x｜分支 `dev`｜投喂前基线 `ad17129`（工作树干净、门禁 120/120）

## 一 本轮做了什么

1. **P1–P4 定案**（李老师 2026-10-01「听你的，……接着操作」授权 ⇒ 按门禁方建议逐项定，不再等回编号）
   - P1 **走**替代路线（阶段 ① → ②，③ 挂起待公司主体）
   - P2 阶段① 入口**并入 `pages/takeaway` 第二 tab**（不新建页 ⇒ 免「新页三关」）
   - P3 K3 采**候选③**（`external_sales_daily` 明细 ＋ `shop_switch.m3_review_last` 摘要；🟢 零新建集合）
   - P4 阶段① 与甲级门禁**同批**投喂
2. **补一处口径空白**：`PLAN_2026-10-01_销量数据替代方案_去开放平台.md` 新增 **§四-bis**
   —— 账单级 → `external_sales_daily` 的映射。
   🔴 **为什么要补**：该集合（v1.4 §6.1）是按**菜品级销量**设计的（`external_ref_id` = 平台侧菜品 ID），
   而阶段① 拿到的是**账单级（门店 × 平台 × 日）营收**，**无菜品 ID** ⇒ 不先定映射，InsCode 必然自由发挥。
   定案：`external_ref_id='BILL:<platform>:<bizDate>'`（合成键）· `dish_key=''` · `qty`=有效订单数（不进金额）·
   `_id='BILL_<shop_id>_<platform>_<bizDate>'` 确定性主键 + `.doc(_id).set()` ⇒ **幂等、零重复行**。
3. **出投喂包** `feed_f_stage1.txt`（4252 字符 / 86 行）→ **已投喂**（送达判据见 §二）
4. **建测试 fixture** —— 本批最大的工程变量，见 §三

## 二 投喂与送达判据（全部机器判据，非目视）

| 项 | 值 |
|---|---|
| 载荷 | `feed_f_stage1.txt`，Python `len()` = **4252** 字符（`wc -c` 报 7226，是**字节数**——中文 3 字节/字） |
| 脚本 | 技能 `inscode-desktop-feed/scripts/inscode_send_v2.py <payload> --send` |
| 🔴 要点 | **直接带 `--send`、不做预演** —— 上批「先预演再正式发」会把载荷粘两遍（`16849 = 2×8425−1`） |
| 窗口 | hwnd `196708`，`LTRB=(20,20,1640,1020)`，未最小化（与点位基准一致） |
| composer 清残渣 | **二次清空幂等 diff = 0**（<30 ⇒ 已干净且稳定） |
| 粘贴 | `PASTE diff = 6938`（≥300 ⇒ 成功；**未用探针字符**——上批探针只等 0.55s 会截到旧帧误判） |
| DB before | `(inflight=0, User=22)` |
| DB after+16s | `(inflight=1, User=23)` |
| **送达判据** | 末条 User `len = 4251` ≡ 期望 `4251`、**逐字相等 = True**、疑似重复(≈2×−1) = **False** |
| 运行状态 | `turn_started_at` 15 项 / `turn_completed_at` 14 项 ⇒ **最新一轮未完成 = 正在跑** |

> 复跑：`python readback_sent.py feed_f_stage1.txt`

## 三 测试策略（本批最大工程变量）

**问题**：两份源账单都在**仓库外** —— `C:/Users/lzj/Desktop/淘宝闪购.xlsx`、`C:/Users/lzj/Downloads/09bbd01042244a1fa98e0d0f1963211b.xlsx`。
InsCode 的 working_dir 是仓库 ⇒ **它读不到源文件 ⇒ 无法端到端自测**（投喂包若只写「必须复现锚点」而不给 fixture，它做不到）。

**解法（本批定）**：
1. 源账单**拷进仓库** `fixtures/`（入库；私有仓 ＋ 自有数据，与 `review/` 下既有金额披露同级）
2. `mk_fixtures.py` 转成 **JSON 矩阵** `fixtures/{taobao,meituan}_2026-08.matrix.json`
   ⚠️ 用 `openpyxl read_only=False` —— 规避项目红线「`read_only=True` 少算 1 行」
3. 投喂包要求 `utils/billParse.js` 是**纯函数**（吃二维矩阵）⇒ 自测**读 JSON 矩阵**、**零依赖、可离线跑**
4. 线上路径仍走 SheetJS：云函数 `importSalesBill` 用 `xlsx ^0.18.5` 把真 xlsx 转矩阵
   ⇒ 🔴 **本项目首个非 `wx-server-sdk` 依赖**（部署时须「云端安装依赖」）

**行数自洽（fixture 生成即已验）**：
- 淘宝 `外卖账单明细`：`max_row=157` = 1 表头 ＋ **156** 数据 ✓（与锚点「156 行」吻合）
- 美团 `订单明细`：`max_row=98` = 1 表头 ＋ **97** 数据 ✓（与锚点「97 行」吻合）

## 四 投喂包口径要点（验收时逐条核）

六条已锁口径见 `feed_f_stage1.txt` §2；**两个锚点必须原样复现**：

| 平台 | 筛前 | 口径 | 锚点值 |
|---|---|---|---|
| 淘宝闪购 2026-08 | 156 行 | 只取 sheet「外卖账单明细」；到手 = Σ「结算金额」 | **3779.65 元** |
| 美团 2026-08 | 97 行 | 🔴 **先按「交易类型=外卖订单」筛行**（→ **50 行**）再 Σ「商家应收款」 | **1826.64 元** |

🔴 美团陷阱：**不筛**直接 Σ 全表「商家应收款」= **1747.95**（= 账单金额，**不是收入**；差 = 广告转入 76.41 ＋ 保险 2.28）。

## 五 待办（下一轮）

- [ ] 等 InsCode 交付 → 走 **R181i 五件套验收闭环**（红线自检 → 全量门禁 → 三同步面 → **锚点独立复算** → 变异回灌 → 提交推 dev）
- [ ] **锚点独立复算**：我方用 `require('utils/billParse.js')` ＋ **fixture 矩阵** 独立跑，**不抄 InsCode 的 selftest**
- [ ] 挂 2 个新 selftest 套件（`selftest_bill_parse` / `selftest_grade_gate`）⇒ 套件数 **120 → 122**（**六处级联**）
- [ ] 部署侧：`importSalesBill` 带 `xlsx` ⇒ **必须「云端安装依赖」**（我方/李老师）
- [ ] 验收重点三条：① `billParse` 是否**真复现两锚点** ② `external_sales_daily` 写入是否用**确定性 `_id`** ③ `pages/takeaway` 第二 tab 是否**真能点到**（上批 `pages/recon` 孤岛页教训）

## 附：本目录文件

| 文件 | 说明 |
|---|---|
| `feed_f_stage1.txt` | 投喂载荷（4252 字符） |
| `fixtures/淘宝闪购.xlsx` · `fixtures/09bbd0104…xlsx` | 源账单原件（**含真实经营数据，仅测试用**） |
| `fixtures/taobao_2026-08.matrix.json` · `meituan_2026-08.matrix.json` | JSON 矩阵（离线自测用） |
| `mk_fixtures.py` | 生成矩阵（`read_only=False` 口径） |
| `readback_sent.py` | 投喂送达判据脚本 |
| `gate_181l_1.txt` | 投喂前门禁（120/120 · RC=0 · 真 FAIL=0） |
| `e0_base.png` … `s4_sent16.png` | 投喂过程截图（`.gitignore` 已挡，不入库） |
