# 实战配方（可直接改坐标复用）

统一前置：
```python
import sys, time
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
T = r'C:\Users\lzj\AppData\Local\Temp'      # 用 %TEMP%，别用 Git Bash 的 /tmp
```

---

## 配方 1：驱动任意桌面应用（通用模板）
```python
h = find_window(title='目标窗口标题关键字')   # 先 list 看真实标题
assert h, '窗口没找到，先 list'
focus(h)
screenshot_window(h, T + r'\step0.png')      # 留证：操作前
# ... 你的动作 ...
screenshot_window(h, T + r'\step1.png')      # 留证：操作后
```

## 配方 2：微信开发者工具 —— 编译 + 截图验收
```python
h = find_window(title='Devtools')            # 顶层标题是 WeChat Web Devtools，不含项目名
focus(h)
key(VK['B'], ctrl=True)                      # Ctrl+B 编译
time.sleep(8)
screenshot_window(h, T + r'\devtools_after.png')
```
- 工具 CLI（`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，支持 open/preview/upload）
  **需先在「设置 → 安全设置」开启服务端口**，否则报"工具的服务端口已关闭"；工具卡死时改不了设置 → CLI 同样不通。

## 配方 3：控制台日志导出成文本（别 OCR）
```python
h = find_window(title='Devtools'); focus(h)
rclick(900, 700)                             # 在控制台区域右键
time.sleep(0.8)
screenshot_window(h, T + r'\ctx_menu.png')   # 看清 Save as... 的坐标
click(920, 730)                              # 点 Save as...（必须与右键同一段脚本！）
time.sleep(1.2)
save_dialog_fill(T + r'\console.log')        # 填路径 + Enter
```
导出文本不含级别标记 → 级别用 `∧` 放大面板看左侧图标辨（见 pitfalls.md P19）。

## 配方 4：判定窗口卡死
```python
r = probe_alive(h, x=900, y=60)   # x,y = 某个已知会高亮的按钮
print(r['alive'], r['hashes'], r['note'])
# alive=False → 请用户人工重启该 App（管理员权限时 taskkill 也无效）
```

## 配方 5：长中文投喂（聊天框 / 输入框）
```python
focus(h)
click(1147, 573)                  # 输入框中心
key(VK['A'], ctrl=True); key(VK['DELETE'])     # 清残留
paste_file(r'C:\...\payload.txt')              # 剪贴板 + Ctrl+V
screenshot_window(h, T + r'\before_send.png')  # 确认内容对不对
key(VK['ENTER'], settle=2.0)                   # 确认无误再发
```

## 配方 6：按颜色找按钮（坐标不用猜）
```python
screenshot_window(h, T + r'\a.png')
cx, cy = find_color_center(T + r'\a.png', is_bright_green)   # 亮绿主按钮
click(cx - 343, cy)              # 同排按钮按固定偏移推算（本机实测 -343）
```

## 配方 7：等 App 冷启动
```python
import subprocess
subprocess.Popen([r'C:\Path\To\App.exe', r'C:\Path\To\Project'])   # 单实例：先确保旧的已结束
h = wait_window(title='App', timeout=60)
focus(h)
```

## 配方 8：只想要一张全屏（最快）
```bash
PY="C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
"$PY" "C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/win_gui.py" shot --screen --out "$TEMP/full.png"
```
然后用 Read 工具读这张 png。

## 配方 9：微信开发者工具「预览」+ 读包体积（实测于 2026-09-16，R37 验收）
目标：不改线上版本的前提下，拿到**代码包体积**。
```python
h = find_window(title='Devtools'); focus(h)
L, T, _, _ = rect(h)
click(L + 1109, T + 27, settle=1.2)      # 顶栏「预览」按钮（窗口内坐标，1875x1034 窗口实测）
time.sleep(4)
# ⚠ 会弹「有文件未保存，本次预览使用修改前的文件，是否继续？」
click(L + 1090, T + 237, settle=4)      # 「确定」
time.sleep(35)                            # 实测编译 ~34s
screenshot_window(h, T + r'\preview.png') # 面板上会显示「编译提示 N ▸ 代码包 X KB ▸」
```
- **如何拿到「预览」按钮坐标**：顶栏按钮**不是色块**，绿色定位法在这里失效 →
  截图后 `crop((900, 4, 1400, 60))` 再放大 3 倍，Read 看图目视读出中心（本机 = 窗口内 x≈1109, y≈27）。
- 预览面板 = 二维码 + `代码包 X KB`；二维码有效期内自动失效，无破坏性。
- 若面板没关：`focus(h); key(VK['ESCAPE'])`。
- ⚠️ **别点「上传」**：会真向微信后台提交体验版本（不可逆），必须由人确认后再点。
- ⚠️ `packOptions` 改动官方注明"**可能需要重新打开项目才生效**"；工具会提示"本次预览使用修改前的文件" —— 想验证配置真生效，先重开项目。

## 配方 10：重开项目（让 project.config.json 的改动真生效）
```python
h = find_window(title='Devtools'); L, T, _, _ = rect(h)
focus(h, settle=0.5)
click(L + 700, T + 120, settle=0.8)      # 先点正文区，窗口才算真激活
click(L + 193, T + 20,  settle=2.0)      # 顶栏菜单「项目」（1875x1034 窗口实测 x≈193, y≈20）
# 菜单弹出：新建项目 / 导入项目 / 打开最近项目 ▸ / 创建代码片段… / 查看所有项目 / 调试公众号网页 / 重新打开此项目
click(L + 249, T + 500, settle=2.0)      # 「重新打开此项目」（菜单最底一项）
```
- **菜单坐标怎么定**：先 `screenshot_screen` 全屏，再 `crop` 出菜单区放大 1.6–3 倍 + Read 目视读中心；
  **菜单是独立弹层**，`screenshot_window` 可能照不到 → 用全屏截图再裁。
- 菜单**第一次点常常不弹**：先点一下正文区把焦点抢回来，再点菜单栏。
- ⚠️ 重开会弹 **「是否保存对以下文件的更改？settings.json」**（落盘其实是项目根的 `project.private.config.json`，通常已 gitignore）。
- 🔴 **这一步在实测中卡死过**：状态栏 `Closing the window is taking a bit longer...` 出现后，模态按钮**点不动**（probe 仍报 alive + hover_diff）→ 见 `pitfalls.md` P25。**遇到就去叫人，别连点**。

## 配方 11：OCR 读屏 / 读图（模型读不了图片时必用）
```bash
PY="C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
OCR="C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py"

# ① 截图 + OCR + 屏幕坐标，一次到位（默认找标题含 Devtools 的窗口）
"$PY" "$OCR" shot

# ② 已有 png → 纯文本
"$PY" "$OCR" read "$TEMP/a.png" --out "$TEMP/a.txt"

# ③ 关键词 → 中心坐标（可直接喂 click）
"$PY" "$OCR" find "$TEMP/a.png" 真机调试 上传

# ④ 裁剪 + 放大后 OCR（小字/低对比度必做，2~4 倍）
"$PY" "$OCR" find "$TEMP/a.png" 预览 --crop 1020 4 1400 48 --scale 4

# ⑤ 连拍抓一闪而过的提示（本机实战抓到了「文件较新」）
"$PY" "$OCR" watch 文件较新 取消 --frames 12 --interval 0.5
```
- **中文会被切成单字**（`预览` → `'预'` `'览'`）：`find` 内部已做「同行相邻字合并」，直接给多字词即可。
- **绿色/彩色按钮上的浅色文字常常 OCR 不出来**（实测「预览」MISS，而「真机调试」「上传」正常）→ 此时改用**锚点法**（下条）。
- 定点裁小块 + `--scale 3~4` 能显著提升识别率；`--crop` 传的是**原图坐标**，脚本会自动把结果换算回原图坐标。

## 配方 12：锚点法定按钮（主题可变 / 颜色失效时的正解）
```python
# 思路：OCR 认得出「真机调试」「上传」→ 两锚点算间距 → 等距推左边的「预览」
# 实测（窗口 1875x1034）：真机调试 x=1221、上传 x=1329 → 间距 108 → 预览 x=1113 ☑ 一次点中
import subprocess
PY  = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
png = r'C:\Users\lzj\AppData\Local\Temp\a.png'
subprocess.run([PY, OCR, 'find', png, '真机调试', '上传'])   # 读回坐标后手工等距推算
```
- **不要**写死"亮绿色按钮色团"这类判据：微信开发者工具**浅色↔深色主题可切换**，切换后色团判据整体失效。
- 工具栏按钮一般**等距**，用两个 OCR 得出来的锚点推第三个，比颜色可靠得多。

## 配方 13：哨兵法 —— 证明某个构建配置「真生效」
> 场景：改了忽略/过滤/打包配置，工具不报错、结果又看不出区别（例：小程序 `packOptions.ignore`）。

```bash
# ① 造一个「只可能被目标规则挡住」的探针，放进目标目录
#    · 后缀要选「不在其它规则里」的（.js 不在 .pdf/.docx/.md/.txt 里）
#    · 体积要够大（本次 400 KB），保证"生效/不生效"现象差异巨大
# ② 让它成为「被使用文件」：入口文件里 require 它
#    ⇒ 排除"过滤未使用文件"这类机制对结果的掩盖
# ③ 触发构建（本处 = 点预览）
# ④ 判读：
#    生效   → 直接报 module not found（本处实测 Error: MiniProgramError）★
#    未生效 → 构建正常，包体从 9 KB 涨到 ~400 KB
# ⑤ 还原并复验：删探针 + 还原入口 + git diff 必须为空 + 再跑一次确认回基线
```
- 本机实测原文：`Error: MiniProgramError — module 'specs/dev-specs/prototype/_sentinel_r13.js' is not defined`
  ⇒ 磁盘有、包里没有 ⇒ `folder: specs` **确已生效**（**直接证据**，非推理）。
- ⚠️ 代价：会**故意制造一次构建失败**。必须先备份、后还原，**还原后一定要复跑一次**。
- suffix 型规则（`.md` 等）不能照搬：`.md` 无法被 `require`，需改走"图片 + 模板引用"变体。

## 配方 14：微信开发者工具「云开发控制台」—— 查/建数据库索引（实测 2026-09-16）

**场景**：云数据库的索引只能用控制台管理（SDK 建不了，实测本地定义 39 条、云端零条）。要在 GUI 里核对/新建索引时用这条。

**入口（踩过 4 次才定）**：主窗口工具栏右侧那一排图标里，**`∞`（两个叠圆）= 云开发控制台**。
不是 `≡`（那是「详情」面板）、不是 `⚙ / ⇧ / 分享 / 布局 / 铃铛`；**悬停不出 tooltip**（Electron 下不可靠），别耗时间。

```
主窗口（标题含 Devtools；注意标题会在 'WeChat Web Devtools' ↔ 项目名 之间变）
  → 点工具栏 ∞（实测 x≈1404, y≈26；先截工具栏放大图标定一次）
  → 控制台是**独立顶层窗口**，标题「云开发控制台 v2.x」
     · 若 rect = (-32000,-32000,…) ⇒ 被最小化，focus(hwnd) 后即恢复
  → 左侧：概览 / 运营分析 / 数据库 / 存储 / 云函数 / AI / 费用管理 / 扩展能力 / 设置
  → 数据库 → 分段页「集合管理」
     · 集合列表第一行是**搜索框**（占位符「集合名称前缀」）—— 点它、Ctrl+A、粘贴集合名即可筛
     · 点集合名 → 右侧出现分段控件「记录列表 | **索引管理** | 数据权限」
  → 索引管理 → 表头「索引名称 / 索引属性 / 索引字段 / 索引占用空间 / 命中次数 / 操作」
```

**新建索引**：`+ 添加索引` → 表单三项：索引名称（**文本框，手打/粘贴**）、索引属性（`唯一`/`非唯一` 单选）、
索引字段（**文本框** + `升序/降序` 下拉 + 右侧圆形按钮）。

> 🔴 **圆形按钮的含义固定但方向易记反**：**第 1 行是 `⊕`（加一行）**，**最后一行是 `⊗`（删掉本行）**。
> ⚠️ **本条此前记反了**（写成"只有最后一行是 ⊕"）—— 2026-09-17 用 2 行弹窗的**放大图**实测更正
> （证据：项目 `review/evidence/index_buildout_20260917/07_加减行图标_第1行加_末行删.png`）。
> 照记反的那句点，**1 行时对、2 行时就删掉刚加的字段行**，而报错显示"提交后弹窗未关"，排查方向会被完全带偏。
> 正确节奏：**加行恒点第 1 行**的圆钮 → 断言「行数 = 原行数 + 1」（用结构判据数行，不靠眼看）。

**弹窗纵向有 3 类状态（y 必须每次现读，x 可写死）**：
1. 字段行数每 +1 ⇒ 底部按钮下移 **65px**（顶部不动）；
2. 出现校验红字（如「请输入索引名称」）⇒ **名称行以下整体 +39px**；
3. **第 1 个字段行与「索引字段」标签同行**（差 **4px**，不是 43px —— 曾把 4.6 抄成 43，点在行间空隙里）。

**方向下拉的选项位置**：点 `(方向控件 x, 本行 y)` 展开 ⇒ **升序 = 本行 y+65 / 降序 = +112 / 地理位置 = +160**（间距 48）。
判据要用**裁切 + `--scale 3`**（全屏 1x 读不到「地理位置」）。

**坐标标定（比眼看更准）**：png = 窗口 1:1，`屏幕坐标 = png坐标 + 窗口原点(L,T)`；
圆按钮这类无文字元素用**像素扫描**定位：
```python
from PIL import Image
im = Image.open(png).convert('L'); px = im.load()
cols = sorted(((sum(1 for y in range(330, 375) if px[x, y] > 140), x) for x in range(1080, 1320)), reverse=True)
# ⇒ 亮像素最多的列就是圆环所在列，中心 ≈ (min+max)/2，再加窗口原点即屏幕坐标
```

**读数纪律**：WinRT OCR 会把 `_openid_1` 认成 `_ogEnid`、`idx_card_code_version` 认成 `idxcardversion`（截断/形近）。
⇒ **关键结论必须人眼看图复核**（抽 1–2 张确认「集合名 + tab + 表体」三者一致），OCR 只用于定位与批量筛查。

**别走的两条路**：① `cli.bat` 无法从 bash 直调（`WinError 2`），经命令解释器转一手又因中文路径乱码而"找不到文件"；
② DevTools CLI 根本没有索引管理子命令 ⇒ 索引这件事**只能走 GUI**。

### 14.1 批量建 40 条 —— 全量跑通实测（2026-09-17）

**结论**：免密钥路径已逐条证伪（SDK 无 `createIndex` / CLI 无 `invoke` / 网页控制台 302→`/cloudrun` /
云调用无免 token 触发 / **控制台窗口 `Ctrl+Shift+I` 新增窗口数 = 0** ⇒ 拿不到 DOM 也重放不了请求）
⇒ GUI 键鼠是**唯一**可行路径，且**可生产级批量跑**：本次 25 集合 **40 条索引一次跑通**（24m35s，
`ok=13 exists=27 fail=0`），随后三层独立核对全绿。

**脚本已归档**：`scripts/examples/cloudbase_index/`
（`do_indexes3.py` 建库 · `verify_indexes2.py` 核名称 · `verify_fields.py` 核组成 ·
`gen_tasks.py` 从单源 dump 派生任务清单 · `probe_attr*.py` 读法探针）。
⚠️ 脚本内坐标绑定**当前版本控制台**（`rect=(60,0,1860,1034)`）；换版本先重标一次。

**实测坐标（屏幕坐标；本窗口 1:1 截图 ⇒ 屏幕 = png + (60,0)）**：

| 控件 | 坐标 |
|---|---|
| 集合搜索框 / 集合第 1 行 / 「索引管理」页签 | (470,280) / (400,333) / (1232,228) |
| 索引名称输入 | x=920 |
| 「唯一」标签（**点标签即选中**） | x=795 |
| 字段名输入 / 方向控件 / `⊕` 加行 | 890 / 1102 / 1243 |
| 取消 / 确定 | 1146 / 1247（取消 = 确定 − 101） |

**「唯一」用像素级判据（不经 OCR）**：单选绿点中心 **唯一 ⇒ png x≈698 / 非唯一 ⇒ ≈791**
（各约 328 px），**分界 745** ⇒ 提交前硬校验，10 条 unique 全靠它保证。

**🔴 绿色簇定位必须抗噪**：取中点**不能**用 `min/max`。实测扫描框混进 **2 个游离绿像素**（png x≈1390,y≈305），
把「确定」中心从 1186 拉到 1269 ⇒ 据此推的「取消」落在弹窗外，**连点 4 次全空、4 张截图 md5 完全相同**，
现象酷似"窗口不接受输入"，害人去查焦点/权限。正解 = **x 众数 ±45 窗口 + 最小像素数门槛（≥60）**。

**批量跑的四条纪律**：
1. 开工前/结束前**各关一次残留弹窗**（模态：不关掉时点背后按钮无效，而"弹窗已开"的判据仍为真 ⇒ 会往**旧弹窗**里填）；
2. **粘贴前 `Ctrl+A` + `Delete`**（否则旧值被拼接：实测把 `idx_audit_created` 拼成
   `idx_audit_createdprobe_tmp`，**不报错、静默造出错名字**）；
3. **长跑必须后台**（前台 Bash 120s 上限会 SIGTERM），且 **"进程被杀 ≠ 动作没做成"**
   ⇒ 必须**回读现场**才算数（本次有一条索引在超时前其实已建成）；
4. **进度判据不依赖行序**（控制台列表顺序会变，实测同集合两次跑行序不同）：
   一律「按名称**容错匹配** + 逐行绑定三列」，行锚点取**必有且唯一**的列（如「索引占用空间」的 `8.00 KB`）。

**三层核对（缺一层都不算验过）**：
① 名称核对（逐集合列出实读名 · 25/25）；② **组成核对**（字段顺序 + 升/降序 + 唯一性 ——
复合索引字段顺序错了**前缀查询就废**，而名称完全一样，只看名字永远发现不了）；
③ 关键行**放大截图人眼复核**（OCR 报红先出放大图，见 P32）。

## 配方 15：微信开发者工具「云开发控制台」—— 跑云函数 / 云端测试（免部署在云上验逻辑，实测 2026-09-25）

**场景**：要在**真云上**执行一次云函数（补种子数据 / 验一段逻辑 / 看真实出参），但**不想改代码、不想等部署**时走这条。
本配方是 round124 的实战沉淀：云端缺一行 `feature_permissions.plan_free` 配置导致"新增菜品"报系统异常，
用「云端测试」直接调 `initDb` 补种，**30 秒内拿到真云出参**。

### 15.1 前置：先让 IDE 活着
IDE 的存活挂在 cli 的 WebSocket 上（**SKILL.md 硬教训 27 / pitfalls P33**）⇒ 先用后台循环 `cli.bat open --project <repo>` 续命，
确认 `win_gui.py list` 里能看到顶层窗口，再往下走。

### 15.2 入口链路（坐标为 1920×1080 @150% 的**实测屏幕物理坐标**）

```
主窗口「WeChat Web Devtools」
  → ① 工具栏 ∞（屏幕 1429,25）            → 弹出「云开发控制台 v2.x」顶层窗口
  → ② 左侧导航「云函数」（屏幕 166,375）  → 右侧出函数列表（每行带「✓已部署 / 最后更新时间 …」）
  → ③ 列表上方搜索框（屏幕 1685,240）：点 → Ctrl+A → Delete → Ctrl+V 粘贴函数名 ⇒ 过滤到目标函数
  → ④ 右侧页签「云端测试」（屏幕 1538,388）
  → ⑤ 代码编辑器（屏幕 1200,400）：点 → Ctrl+A → Delete → Ctrl+V 粘贴入参 JSON
  → ⑥ 绿色「运行测试」按钮（屏幕 1733,592）
  → 结果区：「测试结果：成功/失败」+「返回结果 {…}」+「请求 ID …, 运行时间 … ms」
```

⚠️ **每次开工先现取控制台窗口 rect**（实测 `(60,0,1860,1034)`，但**别写死**），下面所有坐标都按"屏幕绝对坐标"给。

### 15.3 两个"无文字/读不到"元素的定位法

**① 工具栏 ∞ 图标 —— 必须在全屏 PNG 上量，不能在窗口 PNG 上量**
```python
# 全屏 1:1 PNG，工具栏 y≈24，扫"亮像素密集的窄列"找两个交叠圆圈
# 实测 ∞ 中心 = 屏幕 (1429,25)，夹在「上传」与「⇄」之间
# 验证：crop x∈[1280,1560] 放大 4× ⇒ 应能看出「上传 | ∞ | ⇄ | 分享」
```
🔴 **我第一版就是错的**：拿 `screenshot_window` 的 PNG 量到 png x≈1386、加窗口原点得 (1431,24)，**点了四五次全空**。
真因 = PrintWindow 渲染的**主题/尺寸与真实屏幕不一致**（见硬教训 28 / P34）。**窗口 PNG 只用来"读"，坐标一律取全屏 PNG。**

**② 绿色「运行测试」按钮 —— WinRT OCR 读不到（绿底白字），必须像素簇 + 抗噪**
```python
# 判据 g>140 and g-r>50；取 x 众数 ±45 + 最小像素数门槛（≥60）—— 呼应 P20/P27 的"抗噪"纪律
# 实测绿簇 png x 1638-1709 / y 579-605 ⇒ 模式中心 (1639,580)、x 跨度中心 ≈1673 ⇒ 屏幕 (1733,592)
```

### 15.4 入参 / 出参的四条纪律

1. **编辑器粘贴前必须 `Ctrl+A` → `Delete`**（P31：不 Delete 会和旧值拼成新值，且**不报错**）。
2. **入参是 JSON ⇒ 用剪贴板写、不逐字敲**（硬教训 1）；**出参是 JSON ⇒ 走剪贴板回读或截图，不当 OCR 证据**（硬教训 21）。
3. **"通过/失败"只认结果区文字**：`测试结果：成功` + `返回结果 {…}` + `请求 ID …`（**请求 ID 是这条真云调用的唯一凭据，必须留证**）。
4. 🔴 **幂等性要用"两次运行的结果差"来证**，别读代码断言：
   - 第 1 轮 `seeds:["feature_permissions:plan_free::free_quota"]`、第 2 轮 `seeds:[]`
   - ⇒ 同时证了两件事：**该行原本确实缺失** + **补种只插一次**。这比"看代码觉得是幂等的"强一个数量级。

### 15.5 本次实战产出（可直接当样板）
| 项 | 值 |
|---|---|
| 函数 / 入参 | `initDb` + `{"only":"seed_missing"}` |
| 出参 | `{"created":[],"indexes":[],"seeds":["feature_permissions:plan_free::free_quota"],"errors":[]}` |
| 判读 | `测试结果：成功`，请求 ID `80a51a3a-03fe-4402-9e44-1e4161b1fb3f`，运行时间 374 ms |
| 幂等复查 | 第 2 轮 `seeds:[]`（RC 一致、无 errors） |
| 证据归档 | `review/evidence/r124_seed_20260925/`（6 PNG + 可复现脚本 `_r124_fill.py` / `_r124_run.py`） |

### 15.6 边界（别把"云端测试通过"说成"端到端通了"）
- 云端测试**只证云函数这一侧的逻辑对**；**不证小程序端到端**——"点了新增菜品不再报系统异常"仍需在真机/模拟器上点一次。
- `only:seed_missing` 这类轻量通道返回 `created:[] / indexes:[]` = **它只写种子**，别据此宣称"集合/索引也核过了"。
- 想验"线上函数件是否为仓库版本"，`cli cloud functions info` **不含更新时间** ⇒ 仍需取控制台函数列表的「最后更新时间」截图（硬教训 24/25）。
