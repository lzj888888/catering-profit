# -*- coding: utf-8 -*-
p = 'review/NOTE_2026-09-21_round80-selfdrive-redline-thresholds.md'
text = r'''# round80 自驱动巡检 —— 经营红线阈值口径守卫 R111（同族病第 18 例）

> 仓库 `C:/Users/lzj/WorkBuddy/Claw/catering-profit`；证据 `review/evidence/selfdrive_20260921_r80/`。
> 纪律：不采信任何自述（含我方上一轮）；计数/口径一律回源实扫。

## 1. 探针（唯一入口）

`probe_agents.py` → **InsCode `idle`**（`inflight=0`、`message_count=1465` **二十二连**持平、
`idle_sec≈280488`（≈78h）、model `deepseek-v4-flash`、working_dir = 本仓）；**dsh `missing`**
（无标题含 DeepSeek Harness 的窗口）⇒ **不投喂、不投递**（dsh 按 09-21 李老师定暂停参与本仓）。

## 2. 并发写入方判据（停手四连）

| # | 判据 | 实测 |
|---|---|---|
| ① | 跨分钟 mtime 无变化 | `terms.js` 18:22 / `core/13` 19:51，采样时 21:0x ⇒ 静止 ≥1h |
| ② | 无仓内进程 | `_proc_scan_r80.py` 两采（间隔 75s）**0 / 0**（脚本写成 .py 文件跑，命令行只剩路径，已避「采样脚本匹配自己」坑） |
| ③ | 门禁跑完回读 mtime | 门禁 56s 跑完后 `stat` 复核 ⇒ 无变化 |
| ④ | `git log` 无新 commit | HEAD `cc17018` ≡ round79 收口 ⇒ 无未复核 commit |

`git status`：tracked 改动 **0**（`??` 1062 全为并发方历史过程 PNG + 我方前几轮 `_mut_*`/`_proc_*` 过程件，不代提交不代删）。
⇒ **四连通过，本轮可写**。

## 3. 队列①~⑤ 复验（实跑，非采信自述）

- 门禁 `node verify_all.js` → **84/84 RC=0**（首跑 83/83，挂 R111 后 84/84）；`check_error_codes.js`（A–L）→ **RC=0**
- ③ AD 适配 G1–G8：`selftest_ad_gates.js` → **24/24 RC=0**
- ② R91 UI 缺陷：`selftest_ui_fix.js` → **38/38 RC=0**
- ① A6b / ⑤ 14 页真数据走查：无新 commit ⇒ 维持 round62 结论，**不重跑**
- ④ R86 超时值：**本轮未实测**（按 round50 三方一致结论不再回读）⇒ 记**存疑**（人工面）

## 4. 防回潮扫描（队列空时的正事）

- **扫描①**（调试残留命名）：`git ls-files` 命中 1 处，`review/evidence/collection_perms_20260920/bak_15_…md`
  —— 取证命名、在证据目录，**合规**，非调试残留。
- **扫描②**（校验脚本 vs SUITES 差集）：`git ls-files | grep -iE "selftest|test_|check_|verify_"` 170 个，
  逐一比对 SUITES ⇒ 未挂者仅 `tools/verify_docx.py`（已由 `check_docx_derive.js` 按**路径**间接覆盖，
  round60 的 M6 变异已证该层间接生效）+ `SMOKETEST_RUNBOOK.*`（文档非脚本）⇒ **无新漏网**。
- **扫描③**（specs 文档被 `tools/`+`prototype/` 引用次数，扫描面 `os.walk('specs')` = **30 份**）：
  0 引用 6 份 —— `PRODUCT_PLAN`（round79 已证伪）、`BRANCH_STRATEGY`、`OBSOLETE_*`、`core/11`、
  **`core/开发规范v1.0_ModuleM1_月度盈利核算.md`**、**`core/开发规范v1.0_ModuleM3_菜品成本卡.md`**。
  ⇒ 后两份是**模块写码基线**（写码 AI 的输入），本轮首次纳入。

## 5. 正事：同族病第 18 例 —— 四红线阈值口径零守卫

**实然**：M1 规范 §M1.6 四红线（房租占比 ≤15% / 人工占比 ≤20% / 菜品毛利率 ≥55% / 食材损耗率 ≤5%），
当前态只在 **M1 规范（表 4 行）** 与 **M3 规范（:298 引用行）** 两处出现，`tools/` + `prototype/` 零引用
⇒ **改任一侧数字无人报警**，与 round61 套件数 / round64 红线条数 / round66 商业化额度同族。

**已落**：
- M1 规范 §M1.6 立单源声明行（语义标记 + 四个数）；
- 新增 `tools/check_redline_thresholds.js`（**R111**，18 断言，SUITES **83→84**，三处套件数由 R97 自动校验）：
  声明 ≡ 表格（双向逐项）+ 引用 ≡ 声明（双向逐项）+ 单源不扩散 + 三道前提守卫 + 弱面只明示。
- 首跑 **18/18 RC=0**；加固后仍 18/18；门禁 **84/84 RC=0**。

**坑⑭ 第八次印证**：裸扫「房租/人工/毛利/损耗 + 数字%」在 specs 内命中 **49 处**且**全是合法口径**
（S3 测试数据 65.625%、用例「损耗 5%」、`PRODUCT_PLAN` 自述的另一套警戒线）⇒ 只能走语义标记单源。

**双向变异 8 组 0 异常**（`review/evidence/selfdrive_20260921_r80/mutation2.txt`）：
M1 声明改 15→12 / M3 表格改 20→18 / M4 引用改 55→60 / M5 删声明（fail-closed）/ M6 声明扩散到第二份 md /
M8 扫描面根路径写错 ⇒ **全红**；M2 声明换措辞、M7 引用行换措辞 ⇒ **仍绿（不错杀）**。
还原后 `git diff --stat` 为空（变异用**字节快照**回写，规避坑⑧/⑳ 的 `checkout` 行尾反噬）。

**M7 首轮 MISMATCH 抓出判据强度缺口**：引用行判据写死 `毛利≥55%`，正确实现写成「毛利 ≥55%」（加空格）
即被判成解析失败而转红 —— 与 round58 E1 口径守卫「绑字面」同族 ⇒ 已加固为符号两侧允许空白（正则放开空白与 `=` 写法），
M7b 转绿、M4 仍红。（与 round77 坑㉓ 同一条：加固本身也必须双向回灌。）

## 6. 证伪记录（同样写进证据）

- M1.6 四红线 **4 项** vs M3:298 引用 **4 项** ⇒ 一致，**无分叉**；
- BOM 锚点 `975 / 448 / 1235`、M1 口径锁 `916000`（9160 元，8160=违规）⇒ 均已被
  `calcBom/selftest.js`、`calcMonthlyProfit/selftest.js` 断言覆盖 ⇒ **无缺口**；
- 索引/集合计数（25/40/10）⇒ **R74 的 S4 已在守**文档声明计数 ≡ 实测 ⇒ **非缺口**；
- 摊销期数（装修 36 / 加盟费 24 / 冰柜 60）⇒ 与 `calcAmortize/selftest.js` 一致 ⇒ **无分叉**。

## 7. 真发现（登记不代修）：四红线 + 保本达成率红绿灯**代码侧零实现**

实扫 `miniprogram/`（js/wxml/json）与 `cloudfunctions/`：`预警|warn|达红|红灯|保本达成|占比|红线|risk|level|
alarm|threshold|健康|诊断` ⇒ **零命中**；前端仅存 M2 的两个词条（`breakEvenMonthly` / `breakEvenDaily`），
与经营红线无关 ⇒ **阈值与红绿灯均未在小程序/云函数落地**。

按「禁止代选方案」：**不代实现、不删规范**，已在 `core/13` 立「待裁决」条目，
待李老师二选一：①补实现（先确认阈值是否沿用 15/20/55/5）②确认已裁剪（在 M1 规范标注 v1.0 不实现）。

## 8. 回执

- [2026-09-21 21:0x] R80 已落 · 证据：`probe_agents.py` → InsCode idle(msg 1465 二十二连)/dsh missing；
  `node verify_all.js` → **84/84 RC=0**；`check_error_codes.js` → RC=0；`selftest_ad_gates.js` → 24/24；
  `selftest_ui_fix.js` → 38/38；停手四连全过 · commit 见下
- [2026-09-21 21:0x] R80 已落 · 新增 `tools/check_redline_thresholds.js`（R111，18 断言），SUITES **83→84**，
  三处套件数同步（verify_all 头注 + 重启键 §1.1 + 「套件数会漂」行，由 R97 自动校验）；双向变异 8 组 0 异常
- [2026-09-21 21:0x] R80 **未落** · ④R86 超时值：按 round50 三方一致结论不再回读，**本轮未实测** ⇒ 记**存疑**（人工面）
- [2026-09-21 21:0x] R80 **未代修** · 四红线/红绿灯代码侧零实现：属范围裁决，已登记 `core/13` 待李老师二选一
'''
open(p, 'wb').write(text.replace('\n', '\r\n').encode('utf-8'))
b = open(p,'rb').read(); print('CRLF=', b.count(b'\r\n'), 'LF=', b.count(b'\n'))
