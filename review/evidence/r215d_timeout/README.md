# r215d_timeout · 控制台抬 timeout（3 → 20）取证

R215c 巡检留下的最后一项残留：`importSalesBill` / `manageShop` 的云函数 `timeout`
仍是平台默认 **3 秒**（新部署的函数一律是 3，与部署无关；`config.json` 写 timeout 不被采纳）。
R215d 用**键鼠代操云开发控制台**把两个函数抬到 20，李老师零操作。

## 权威判据

```
cli cloud functions info --names <44 个，空格分隔> -e cloud1-d4gphpoxy337f2a25 --project <repo>
```

| 文件 | 内容 |
|---|---|
| `cli_info_all_44fn_after.txt` | 🔴 全量 44 函数 `info` 原文：`status` 44/44 `Active`；`timeout` 分布 `{15:1, 20:40, 30:1, 60:2}`；**`timeout==3` = NONE** |
| `cli_info_2fn_before_after.txt` | 两个目标函数的 `info` 原文（均 `timeout=20`） |

> ⚠️ **编码**：`cli` 输出实际是 **UTF-8**（不是 GBK）。按 GBK 解会得到 `鈹�` / `鈭�` 一类 mojibake。
> 本目录归档件一律 UTF-8；解析脚本先试 UTF-8。

## 控制台截图（键鼠代操留证）

| 文件 | 内容 |
|---|---|
| `console_manageShop_timeout3_before.png` | 改前：配置对话框「执行超时」= **3 秒** |
| `console_manageShop_saved_014437.png` | 改后：`$LATEST` 最后更新时间 2026-10-05 **01:44:37** |
| `console_importSalesBill_timeout3_before.png` | 改前：同名对话框（**含函数名行**，用于防串函数） |
| `console_importSalesBill_saved_014928.png` | 改后：`$LATEST` 最后更新时间 2026-10-05 **01:49:28** |

## 操作要点（可复用）

- 云开发控制台 = 开发者工具工具栏 **`∞`** 图标 ≈ (1408, 33)（本机 1920×1080/150%；**无 tooltip、OCR 无字**）
- 路径：云函数 → 该行「版本与配置」→ `$LATEST` 行「配置」→ 高级配置 → 执行超时
- 数字框**可直接编辑** ⇒ 点击 → `Ctrl+A` → 粘贴 `20`；**改完必须 `Ctrl+A`+`Ctrl+C` 回读 = `20`**（不靠目视）
- 「确定」是**绿底白字**，OCR 读不出 ⇒ **像素法** `g>140 and g-r>50 and g-b>30`（限定 x 1279–1364）
- 🔴 改之前**先裁图确认「云函数名称」行**：两个函数的对话框长得完全一样
- 完整记录见 `review/NOTE_2026-10-05_round215d_控制台抬timeout.md`
