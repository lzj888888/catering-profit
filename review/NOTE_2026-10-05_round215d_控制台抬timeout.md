# NOTE · round215d 控制台抬 timeout（3 → 20）· 缺口清零（2026-10-05）

> **触发**：R215c 巡检留下的最后一项残留 —— `importSalesBill` / `manageShop` 的云函数
> `timeout` 仍是**平台默认 3 秒**（其余 42 个 = 20 / 60 / 30 / 15）。
> 李老师指令：「只剩一项要您动手：把 importSalesBill、manageShop 两个的超时从 3 抬到 20
> （控制台：版本管理 → 配置 → 高级配置 → 执行超时）。改完我可以回读 info 复核。
> **这个你键鼠和其他技能去操作**。」

**一句话结论**：✅ **已完成，且不需要李老师动手** —— 用键鼠全程代操云开发控制台把两个函数抬到 20；
`cli cloud functions info` **全量 44 函数回读**：`timeout==3` 的**数量 = 0**，全部 `Active`。

---

## 一 结果（权威判据）

`cli cloud functions info`（env 现读 `initDb/config.json::DEV_ENV_ID`）全量回读：

| 项 | 值 |
|---|---|
| 回读函数数 | **44** |
| `status` 分布 | `'Active'` **44/44** |
| `timeout` 分布 | **`{15: 1, 20: 40, 30: 1, 60: 2}`**（合计 44 ✅） |
| 🔴 `timeout == 3` | **NONE（0 个）** |
| `importSalesBill` | `status='Active'` · **`timeout=20`** |
| `manageShop` | `status='Active'` · **`timeout=20`** |

原文：`review/evidence/r215d_timeout/cli_info_all_44fn_after.txt`
（⚠️ **编码坑**：`cli` 输出实际是 **UTF-8**，按 GBK 解会得到 `鈹�`/`鈭�` 一类 mojibake ⇒ 本目录归档件按 UTF-8 落盘）

### 二次旁证（控制台内的「最后更新时间」）

| 函数 | 配置前 | 配置后 |
|---|---|---|
| `manageShop` `$LATEST` | 2026-10-05 01:11:36 | **2026-10-05 01:44:37** |
| `importSalesBill` `$LATEST` | 2026-10-05 01:10:46 | **2026-10-05 01:49:28** |

---

## 二 操作路径（全键鼠，李老师零操作）

技能 `win-desktop-control`（键鼠 + 截屏 + OCR）+ `miniprogram-cloud-deploy`（§9「控制台是 timeout 唯一通道」）。

| # | 步骤 | 关键判据/坑 |
|---|---|---|
| 1 | 确认 IDE 在跑 | `win_gui.py list` → `WeChat Web Devtools` hwnd=18418930（**IDE 顶层标题不含项目名**） |
| 2 | 先清屏上模态框 | 「模拟器长时间没有响应」会**吃掉所有点击**（OCR 实测「关闭」= (787,241)） |
| 3 | 打开云开发控制台 | 工具栏 `∞` 图标 ≈ **(1408, 33)**（**无 tooltip，OCR 无文字**，裁图放大后按比例定位）；判据 = `find_window('云开发控制台')` 返回 hwnd 非 0 |
| 4 | 侧栏「云函数」 | OCR 实测 **(166, 375)** |
| 5 | 点该行「版本与配置」 | OCR 实测 x=1639；`manageShop` y=388、`importSalesBill` y=467 |
| 6 | 点 `$LATEST` 行的「配置」 | OCR 实测 (1612, 389) |
| 7 | 展开「高级配置」 | (607, 556) |
| 8 | 🔴 改执行超时 | **连通域分析**实测：`−`(708,717) · 数字框 **(792,716)** · `+`(878,717)。数字框**可直接编辑** ⇒ 点击 → `Ctrl+A` → 粘贴 `20` |
| 9 | 🔴 确认改对了 | **剪贴板回读**：`Ctrl+A`+`Ctrl+C` ⇒ 剪贴板 = `20`（不靠目视） |
| 10 | 点绿底「确定」 | **像素法**（`g>140 and g-r>50 and g-b>30`，限定 x 1279–1364）⇒ 中心 **(1321, 906)**；绿底白字 **OCR 读不出** |
| 11 | 复核 | `cli cloud functions info --names importSalesBill manageShop`（**空格分隔**，逗号会静默空表） |

---

## 三 本轮新踩的坑（已进技能）

1. 🔴 **回显图坐标 ≠ 物理坐标**：本机 150% 缩放，Read 回显图 ≈ 1.758× 缩放。
   我第一次点「返回箭头」直接用了回显目测值 (222,85) ⇒ 实际点到**顶部环境切换下拉框**，弹出只读菜单。
   正解：`ocr_screen.py find` 或**像素/连通域实测**。（此坑技能里早有 #31，**我又踩了一次** ⇒ 值得再强调：凡"目测"的坐标一律先换算或实测）
2. 🔴 **二级页点侧栏同名项不返回列表**：在 `manageShop` 版本页点侧栏「云函数」**无反应**，必须点左上 **`←`**（物理 (382,152)）。
3. ⚠️ **改之前先确认函数名**：两个函数的「配置云函数」对话框长得**一模一样**，只有名称行不同
   ⇒ 裁图放大读名称（OCR 读不出该行小字）后再操作，别靠"上一步点的是哪行"的记忆。
4. ⚠️ **`cli` 输出编码是 UTF-8**（不是 GBK）：按 GBK 解码会得到 `鈹�` 表格线 ⇒
   `/tmp` 里归档或解析时**先试 UTF-8**。（技能 §8 原写"GBK 编码"，实为 UTF-8，已更正）

---

## 四 处置

| # | 动作 | 状态 |
|---|---|---|
| 1 | `manageShop` timeout 3 → 20 | ✅ 控制台已保存（01:44:37） |
| 2 | `importSalesBill` timeout 3 → 20 | ✅ 控制台已保存（01:49:28） |
| 3 | 全量 44 函数 `info` 回读复核 | ✅ 44/44 `Active`；`timeout==3` = **0** |
| 4 | 证据归档 | ✅ `review/evidence/r215d_timeout/`（4 张控制台截图 + 2 份 info 原文） |
| 5 | 记录回填 | ✅ 本 NOTE + `CHECKLIST §D2-bis` 划闭 + `NOTE_215c §四-4/§五` 追加 + `PITFALLS §R215d` + `MEMORY.md §3` |
| 6 | 技能更正 | ✅ `miniprogram-cloud-deploy §9`（现状段：3 残留 2 → 0；编码坑 GBK → UTF-8）；`win-desktop-control` 增配方 19（改云函数 timeout） |

---

## 五 回执

- [2026-10-05 01:50] **R215d 已落** · ① `importSalesBill`/`manageShop` timeout **3 → 20**（控制台键鼠代操，李老师零操作）；
  ② 全量 44 函数 `info` 回读 `timeout==3` = **0**、`Active` 44/44；③ 证据 `review/evidence/r215d_timeout/`；
  ④ 三处记录 + 两处技能已回填。commit `<待填>`。
- [2026-10-05 01:50] **R215d 未落** · ① **真机验证未做** —— 本次只改配置，未在真机走一次「账单导入」/「新建店铺」；
  按纪律「配置生效 ≠ 功能可用」，`importSalesBill` 的 xlsx 路径仍待真机点一次（R181m 已埋探针，但那是本地库路径）。
  ② prod 环境不存在 ⇒ 本条只对 dev 生效。

---

## 六 取证目录

| 文件 | 内容 |
|---|---|
| `review/evidence/r215d_timeout/cli_info_all_44fn_after.txt` | 🔴 **权威判据**：44 函数 `info` 原文（UTF-8） |
| `review/evidence/r215d_timeout/cli_info_2fn_before_after.txt` | 两函数 `info` 原文 |
| `review/evidence/r215d_timeout/console_manageShop_timeout3_before.png` | 改前：对话框显示执行超时 **3** |
| `review/evidence/r215d_timeout/console_manageShop_saved_014437.png` | 改后：`$LATEST` 更新时间 **01:44:37** |
| `review/evidence/r215d_timeout/console_importSalesBill_timeout3_before.png` | 改前（含名称行，用于防串函数） |
| `review/evidence/r215d_timeout/console_importSalesBill_saved_014928.png` | 改后：`$LATEST` 更新时间 **01:49:28** |
