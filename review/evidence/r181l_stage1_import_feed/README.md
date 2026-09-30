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

## 五 InsCode 交付清单（批次 F · 已回执归档）

| 交付项 | 文件 | 关键形态 |
|---|---|---|
| A 解析器 | `utils/billParse.js`（148 行） | 纯函数、**零 `require`**；`parseBillMatrix(matrix, opts)` 吃**整份 fixture 文档**（含 `sheets`），非二维数组 |
| B 甲级门禁 | `utils/gradeGate.js`（79 行） | 三门 **fail-closed**；`checkGradeA(...) -> {pass, level:'A', failures[]}` |
| C 云函数 | `cloudfunctions/importSalesBill/`（4 源文件 ＋ 14 `cx_*` 派生副本） | `index.js` 流程：鉴权 → validate → `cloudFile` 下载 → `bufferToMatrix` → 解析 → 甲级 → `confirm=false` 预览 / `true` 才落库 |
| D 入口 | `pages/takeaway/index.{js,wxml,wxss}` | 第二 tab（**未动 `app.json`**，符合 P2 定案） |
| E 自测 | `tools/selftest_bill_parse.js`（15 断言）· `tools/selftest_grade_gate.js`（11 断言） | 零依赖、读 JSON 矩阵、离线可跑 |

🔴 **C 的落库主键**（确定性 `_id` ⇒ 重跑零重复行）：

```
_id = 'BILL_' + shopId + '_' + platform + '_' + r.bizDate     // 确定性主键
db.collection('external_sales_daily').doc(_id).set({ data: {
  shop_id, biz_date, external_ref_id: 'BILL:' + platform + ':' + bizDate,
  dish_key: '', qty: r.qty /* 有效订单数，绝不进金额 */, amount: r.amountFen, ... } })
```

🔴 **C 的依赖**：`package.json` = `wx-server-sdk ~2.6.3` ＋ **`xlsx ^0.18.5`**
—— **本项目首个非 `wx-server-sdk` 依赖**，部署时**必须勾「云端安装依赖」**（本地上传不带 node_modules）。

## 六 验收闭环（五件套 · 2026-10-01 01:4x）

> 判据全部机器可读；脚本与输出同目录可复跑。

### ① 红线三条自检 · 全过

| 红线 | 判据命令 | 结果 |
|---|---|---|
| 不新建集合 / 不新增索引 | `git status --short -- initDb/ tools/check_collection_perms.js` | **空** ✓（集合仍 27 / 索引仍 45） |
| 不改 `common/**` | `git status --short -- common/` | **空** ✓ |
| 不改 `specs/**`（除我方同步面） | `git status --short -- specs/` | 仅 **5 个**同步面文件 ✓ |

> 🔴 本批 `utils/` 是**新增顶层目录**，不在 `common/` 下 ⇒ 不触碰引擎红线。

### ② 全量门禁 · 122/122 · RC=0 · 真 FAIL=0

`gate_181l_9.txt`（投喂前基线 120/120 见 `gate_181l_1.txt`）。
新增两套件已挂进 `SUITES`：`bill-parse`（15 通过 / 0 失败）· `grade-gate`（11 通过 / 0 失败）。

### ③ 同步面（三组，共 18 处锚点）

| 组 | 处数 | 内容 | 脚本 / 输出 |
|---|---|---|---|
| 套件数级联 | **8** | `verify_all.js` 头注 ×2（串联数 ＋ 守卫说明段）· `SUITES` 末尾 · 重启键 §1.1 入口行 · 「套件数会漂」行 ＋ 演进链尾部 · 断言数声明行（「三十六者」→**「三十八者」**）· `check_suite_assert_counts.js::CASES` | `sync_surface_181l.py` → `sync_surface_181l_out.txt`（8/8 唯一命中） |
| 新增云函数 | **6** | A15 白名单 · core10 全集 **42→43** ＋ 契约行 · 隐私收集项第 7 行 · 不收集段 · 取证段 | `sync_fn_181l.py` |
| 收尾 | **4** | 隐私声明 **6→7** · 守卫 `TOKEN_WHITELIST` ＋ `chooseMessageFile`/`uploadFile` · 提审材料包 **6→7** · `importSalesBill` 补幂等 | `sync_idem_priv_181l.py` |

### ④ 锚点独立复算（**不抄 InsCode 的 selftest**）

- **Python 侧** `anchor_indep_181l.py`：我方**自己实现一遍口径**（不 require 其代码）
- **JS 侧** `anchor_run_181l.js`：`require('utils/billParse.js')` ＋ fixture 矩阵 ⇒ **10/0 全过**

| 平台 | 行数（筛后） | 到手（分） | 有效订单数 |
|---|---|---|---|
| 淘宝闪购 2026-08 | **156** | **377965** | 150 |
| 美团 2026-08 | 97 → **50** | **182664** | 50 |

⚠️ **首次跑 4/10 是**我方**调用错**：我传了**二维数组**，而 `parseBillMatrix` 要**整份文档**（`{sheets}`）⇒ 改传 `tbDoc`/`mtDoc` 后 10/0。（纪律实证：守卫红先怀疑自己。）

### ⑤ 变异回灌 · **4/4 有效红**（`mut_181l.py` → `mut_181l_result.json`）

硬判据：`❌ in out` **且** 目标断言名在行上 **且** 非崩溃红。

| # | 变异点 | 目标断言名（命中行原文） | 结果 |
|---|---|---|---|
| M1 | `detectPlatform` 恒返 `'meituan'` | `detectPlatform 淘宝表头 → taobao` | ✅ 有效红 |
| M2 | `parseBillMatrix` 恒返空 totals | `淘宝 行数 156（totals.rowCount）` | ✅ 有效红 |
| M3 | `checkGradeA` 恒返 pass | `① rows 空 → pass=false 且报 CHANNEL_EMPTY` | ✅ 有效红 |
| M4 | 删掉 `findPriorResult` 预检 | `importSalesBill 含幂等预检` | ✅ 有效红 |

🔴 **终态字节自证**（`md5` 相等只是**归一化后**的假相等 ⇒ 必须用 git blob 对账）：

`git hash-object` ≡ `git ls-files -s` ⇒ `utils/billParse.js` / `utils/gradeGate.js` / `cloudfunctions/importSalesBill/index.js` **三份逐字节还原**、`git status` 为 `A` 而非 `AM`。

## 七 回执

- [2026-10-01 01:5x] **R181l 已落 · 证据：** `git status --short -- common/` → 空 · `initDb/` → 空 · `gate_181l_9.txt` → `122/122 套件通过` · `mut_181l.py` → `4/4 有效红` ＋ 三份源文件 git blob 逐字节还原 · commit `72f22af`
- **未落**：`importSalesBill` **未上云部署**（须「云端安装依赖」，`xlsx` 是首个外部依赖）—— 留给部署轮，非本轮范围。
- **存疑**：无。

## 附：本目录文件

| 文件 | 说明 |
|---|---|
| `feed_f_stage1.txt` | 投喂载荷（4252 字符） |
| `fixtures/淘宝闪购.xlsx` · `fixtures/09bbd0104…xlsx` | 源账单原件（**含真实经营数据，仅测试用**） |
| `fixtures/taobao_2026-08.matrix.json` · `meituan_2026-08.matrix.json` | JSON 矩阵（离线自测用） |
| `mk_fixtures.py` | 生成矩阵（`read_only=False` 口径） |
| `readback_sent.py` | 投喂送达判据脚本 |
| `gate_181l_1.txt` | 投喂前门禁（120/120 · RC=0 · 真 FAIL=0） |
| `gate_181l_2.txt` | **反面证据**：投喂后在飞期间跑门禁 ⇒ 19分41秒 / 118/120（三处红全因在飞）⇒ 已固化进技能 |
| `gate_181l_9.txt` | **终态门禁**（122/122 · RC=0 · 真 FAIL=0） |
| `anchor_indep_181l.py` · `anchor_run_181l.js` | 锚点独立复算（Python 侧 / JS 侧，JS 10/0） |
| `sync_surface_181l.py` · `sync_fn_181l.py` · `sync_idem_priv_181l.py`（＋ `*_out.txt`） | 三组同步面补丁脚本（8 / 6 / 4 处） |
| `mut_181l.py` · `mut_181l_result.json` | 变异回灌（4 变异体，4/4 有效红） |
| `inscode_receipt_f.txt` | InsCode 批次 F 回执（2745 字符） |
| `e0_base.png` … `s4_sent16.png` | 投喂过程截图（`.gitignore` 已挡，不入库） |
