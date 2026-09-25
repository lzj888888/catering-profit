---
name: win-desktop-control
description: Windows 桌面「真实截屏 + 键鼠控制 + OCR读屏」通用技能。截取真实屏幕/某个窗口、控制鼠标点击拖拽滚轮、敲键与组合键、剪贴板粘贴长中文、判定窗口是否卡死、**把界面文字 OCR 成文本并按关键词定位按钮坐标**、驱动任意桌面应用（微信开发者工具 / 浏览器 / 记事本 / InsCode 等）。当用户说"截屏给我看""截图看看屏幕上有什么""帮我点一下""控制鼠标键盘""驱动 XX 窗口""帮我操作 XX 软件""看看这个软件界面""屏幕上写了什么"时使用；**当模型读不了图片时，也必须用本技能把截图转成文字**。纯 ctypes 调 Win32，不需要 pywin32；截屏需 Pillow；OCR 内置（winocr + WinRT，离线）。
agent_created: true
---

# win-desktop-control · 真实截屏 + 键鼠控制

**本技能的能力是真的：能抓你电脑的真实屏幕（不是示意图），能移动/点击鼠标，能敲键盘。**
Agent 若准备说"我做不到截图/控制鼠标"，请先读完本文件并跑一次自检再说。

## 何时用
- 要看**真实屏幕**（"截屏给我看""看看现在界面是什么""帮我看看这个报错"）。
- 要**代点**（"帮我点一下""把这个按钮点了""帮我操作 XX 软件"）。
- 要把**长中文/长文本**送进桌面应用的输入框。
- 要**驱动某个 Windows 应用**完成一串动作（打开菜单、导出日志、点编译按钮等）。
- 要看某个窗口**是不是卡死了**。

## 环境（先找解释器，别硬编码路径）
```bash
# 1) WorkBuddy 自带 python（多数机器有）
PY="C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
[ -x "$PY" ] || PY="$(command -v python)"; [ -n "$PY" ] || PY="$(command -v py)"
echo "$PY"

# 2) 体检（Windows/pillow/Win32/剪贴板 四项）
"$PY" "C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/bootstrap.py"
```
- 只有 Pillow 是外部依赖（**仅截屏需要**）；缺失时键鼠能力照常可用：`pip install pillow`。
- 不需要 pywin32、不需要管理员权限。

## 三分钟上手（照抄即可）
```bash
PY="C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/win_gui.py"   # 直接用模块路径
"$PY" list                                    # ① 列窗口：拿句柄 + 看真实标题
"$PY" selfcheck                               # ② 自检：窗口数/剪贴板/截图 是否 OK
"$PY" shot  --title "Devtools" --out "$TEMP/a.png"   # ③ 截某个窗口
"$PY" shot  --screen --out "$TEMP/full.png"          #    或全屏
"$PY" click --x 1147 --y 573                  # ④ 点击
"$PY" key   --name B --ctrl                   # ⑤ Ctrl+B
"$PY" type  --file payload.txt                # ⑥ 粘贴整段长中文
```
**然后用 Read 工具读那张 png** —— 你能看图，这才是闭环的关键一步。截图只是手段，"读图"才是结果。

> ⚠️ **如果你的模型读不了图片**（无图像输入），别就此认为"截了也没用"：
> 用 `scripts/ocr_screen.py` 把 png 转成**文字**，一样能闭环（而且更精确 —— 能拿到坐标）。
> ```bash
> "C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py" shot   # 截图+OCR+坐标一次到位
> "$OCR" "$P" read  "$TEMP/a.png"                 # 只要文字
> "$OCR" "$P" find  "$TEMP/a.png" 预览 上传        # 关键词 → 坐标（可直接喂给 click）
> "$OCR" "$P" watch 文件较新 --frames 12 --interval 0.5   # 连拍抓一闪而过的提示
> ```

## 能力速查（CLI = 命令行动词，模块 = from win_gui import *）
| 用途 | 命令 | 模块函数 |
|---|---|---|
| 列所有窗口 | `list` | `enum_windows()` |
| 找窗口 | `find --title X [--all]` | `find_window / find_windows` |
| 等窗口出现 | — | `wait_window(title, timeout=30)` |
| 置前 | `focus --title X` | `focus(hwnd)` |
| 截全屏/窗口/区域 | `shot --screen/--title/--region` | `screenshot_*` |
| 移动/单击/双击/右键 | `move` `click` `dblclick` `click --right` | `move_to/click/dblclick/rclick` |
| 拖拽 / 滚轮 | `drag` `scroll` | `drag/scroll` |
| 按键与组合键 | `key --vk 0x42 --ctrl` / `--name ENTER` | `key(vk, ctrl=..)` |
| 剪贴板 | `clip --set "x"` / `--get` | `set_clipboard/get_clipboard` |
| 安全输入长文本 | `type --text ..` / `--file ..` | `type_text/paste_file` |
| 判定卡死 | `probe --title X --x .. --y ..` | `probe_alive(hwnd, x, y)` |
| 原生保存框填路径 | `save-dialog --path ..` | `save_dialog_fill(path)` |
| 关窗口 | `close --title X [--force]` | `close_window(hwnd)` |
| 颜色定位按钮 | — | `find_color_center(path, pred)` |
| **OCR 读屏/读图** | `ocr_screen.py list/read/find/shot/watch` | 见下节 |

## OCR 读屏（`scripts/ocr_screen.py`）—— 读不了图时的眼睛
| 子命令 | 作用 |
|---|---|
| `list <png>` | 列出所有行 + 坐标 |
| `read <png> [--out txt]` | 输出纯文本 |
| `find <png> <kw>...` | **关键词 → 中心坐标**（多字词自动做同行相邻字合并，中文被切成单字也能命中） |
| `shot [--window X\|--screen]` | 截图 + OCR 一次完成（窗口截图会给**屏幕坐标**） |
| `watch <kw>... [--frames 12] [--interval 0.5]` | **连拍 + 逐帧 OCR**，抓一闪而过的 Toast/提示框 |

- 引擎 = Windows 自带 `Windows.Media.Ocr`（**离线**，无需 tesseract）；依赖已内置 `vendor/ocrlibs/`。
- 语言自动挑：`zh-Hans-CN` → `zh-Hans` → `zh-CN` → `en-US`。
- **坐标换算**：png 坐标 + 窗口原点 `(L,T)` = 屏幕坐标（`win_gui.rect(hwnd)` 取 L,T）。

键名可用 `--name B / ENTER / F5 / ESC / TAB`，也可直接 `--vk 0x42`。

## 🔴 硬教训（每条都是踩出来的，别再踩）
1. **中文/长文本绝不逐字 `keybd_event`** —— 搜狗等输入法会吞字（`wbtest123` → `25123`）。一律 `set_clipboard + Ctrl+V`。
2. **必须先 DPI-aware**（脚本已自动做），否则高 DPI 屏坐标/截图整体偏移。
3. **`SetForegroundWindow` 会静默失败** → 兜底 `AttachThreadInput`；注意它属 **user32**，挂到 kernel32 上会 `AttributeError`。
4. **关窗口只用 `PostMessage(WM_CLOSE)`**，别用 `SendMessage`（遇"是否保存"模态框会永久阻塞脚本）。
5. **判定窗口活着 ≠ `IsHungAppWindow`**：卡死的 Chromium 照样应答。看**会不会重绘**（多帧 md5 + 悬停高亮），用 `probe`。
6. **⛔ 权限墙**：目标进程以管理员运行时，普通权限 `taskkill` 拒绝访问、`PostMessage` 被 UIPI 拦（返回 False）。但**截图和 `SetCursorPos` 仍可用** —— 所以"能截图≠能点击"。此时**只能请用户人工处理**。
7. **右键菜单必须同一段脚本里点完**，脚本一结束菜单就没了（否则点击穿透到下层标签页）。
8. **窗口标题常不含你以为的内容**：微信开发者工具顶层标题是 `WeChat Web Devtools`，**不含项目名**；用 `--title Devtools`（默认子串匹配）而不是项目名。
9. **`SetCursorPos` 第一次读回坐标不对**：先看是不是用户的手正在动鼠标（争夺光标），别急着判"被缩放/被挡"。
10. **Git Bash 会把 `taskkill //PID` 转义坏** → 用 Python `subprocess.run([...])` 绕开。
11. 同一 App 的第二个实例会秒退（单实例守卫）——"重启"必须先真正结束旧进程。
12. 安全软件（360 主动防御 / 金山毒霸）曾让输入注入整体失效数天 → **每次代点前先 `selfcheck`**。
13. **别只用颜色找按钮** —— 应用主题可变（微信开发者工具浅色↔深色 `#383838`），"亮绿色按钮"这类判据会**整体失效**（`find_color_center` 返回 None，不是按钮不在）。**锚点法更稳**：OCR 定位两个已知按钮，按**等距**推第三个（实测：真机调试 1221 / 上传 1329 → 间距 108 → 预览 1113，一次点中）。
14. **kill 掉微信开发者工具后，绝不要用 `cli.bat open` 去开** —— CLI 会拉起一个**零窗口、提权**的 IDE 服务进程占住单实例锁，之后双击 exe 只会把请求转发给它 ⇒ **再也开不出窗口**，且该僵尸进程 `taskkill` 报"拒绝访问"。正确做法：**结束后用桌面图标/`exe` 正常启动**。
15. **"能重绘 + 能响应悬停 + `IsHungAppWindow` 报健康" 仍可能是半死状态**（不接受业务输入）。`probe` 也会被骗过 —— 判据要加一条：**按钮点完 UI 无变化**。此时别硬怼（会推成真死），交给人工。

16. **云开发控制台 = 工具栏 `∞` 图标**（不是 `≡`，也不是其余图标；**悬停不出 tooltip**，别在图标上耗时间）。控制台是**独立顶层窗口**，被最小化时 rect 是 `(-32000,-32000,…)`，`focus(hwnd)` 即恢复。详见 `references/recipes.md` 配方 14。
    ✅ **批量建索引已跑通全量**：2026-09-17 一次建成 **25 集合 40 条索引**（24m35s），脚本归档在
    `scripts/examples/cloudbase_index/`（建库 / 名称核对 / 组成核对 / 读法探针 + README），
    关键判据与四纪律见配方 14.1，OCR 读错问题见 `references/pitfalls.md` P32。
17. **圆形按钮的语义会随行变**：加索引表单里 **只有最后一行是 `⊕`（加行）**，其余行是 `⊗`（删本行）—— 按行距连点会把刚填好的行删掉。凡"每行带图标"的列表控件，**点之前先截图核对行位**，别用 delta 推。
18. **中文路径别交给命令解释器去调外部程序**：`微信web开发者工具` 这类路径会被编码吃掉 → `系统找不到指定的文件`（`WinError 2`）。用 Python `subprocess` 直调（带 `cwd`），或干脆走 GUI。
19. **别用"关窗"收尾 —— DevTools 系（VSCode 内核）有"保存冲突"卡死序列**：磁盘文件比编辑器缓冲区新 ⇒ 弹「是否保存 settings.json」⇒ 三个按钮全不响应、`Alt+F4` 被吃、`IsHungAppWindow` 仍报健康、`probe` 显示"能重绘+能悬停但不接受输入"。**连环点只会更糟**。规矩：① 任务做完**不要主动关**开发者工具/云开发控制台（它开着不影响别的自动化，例如另一程序侧的投喂）；② 非关不可时**只点一次**，然后**停手等 10 秒**再看；若已卡住，**交给人手动收尾**，别继续注入输入。
20. **暗底浅字 + 两字窄格 → WinRT OCR 会返回空**（实测：云开发控制台索引属性列「唯一」/「非唯一」，10× 放大 + 反色 + 自动对比度三种预处理**全部读空**）。此时改用**两个不依赖 OCR 的判据**：① 人眼读放大图（裁到该行、放大 2–8 倍）；② **像素簇宽度量化** —— 同一张图里量同一列不同行的亮像素横向跨度：2 个汉字 ≈ 34px、3 个汉字 ≈ 53px（1080p/100% 缩放下），可据此区分「唯一」与「非唯一」。**结论必须写清"人眼判读 / OCR 判读"，别把两者混为一谈。**
21. **JSON / 代码块这类"原文即证据"的文字：走剪贴板回读，绝不用 OCR**（2026-09-18 实测）：云开发控制台「返回结果」里的长 JSON，OCR 把 `-501001` 读成 `一501991`、还整行丢 ⇒ **只能当"看一眼"，不能当证据**。取全文的**可用姿势**：点进文本框 → `Ctrl+A` → `Ctrl+C`（实测拿到 3204 字符全文）；**「返回结果」标题旁那个复制图标点不动**（换 4 个坐标全无效），别在图标上耗。⚠️ `win_gui.VK` 里**没有 `END`/`HOME`**，要用原始码 `key(0x23, ctrl=True, shift=True)`（Ctrl+Shift+End）。
22. **坐标必须由 OCR / 像素实测给出，不能按"我看到图有多宽"换算**（2026-09-18 踩两次）：Read 工具回显的图是**缩放后**的，按它的比例反推 png 坐标会整体偏 1.6–1.7 倍（点进标题栏、点中隔壁按钮）。正确做法：① `ocr_screen.py find <kw>` 拿中心点；② 或按颜色/亮像素**在 png 上实测**（如绿色按钮 = `g>140 and g-r>50`）；③ 换算屏幕坐标 = png + `rect(hwnd)` 原点（**每次现取**）。**每次点击后比 md5**（`[shot]_pre` vs `_post`）—— 否则会把"没点中"读成"界面没反应"。⚠️ **md5 只能证否不能证成**（相同=肯定没动；不同≠你点的东西动了）—— 见 #29 / P35。
23. **删文件别用 `os.remove` / `PowerShell Remove-Item`（本机都静默失败或被 SIGTERM），改用 `os.rename`**（2026-09-18 实测）：清理临时截图时 `os.remove` 整批被 SIGTERM 打断、`Remove-Item -Force` 报 exit 0 但文件还在；**`os.rename` 到 `_debug/` 子目录反而立刻成功**。⇒ 收尾整理用"改名归档"，别用"删除"。
24. **要"重发线上云函数"用微信开发者工具自带 CLI，别用腾讯云 `tcb`**（2026-09-18 实测）：`任务=线上件落后于仓库 ⇒ 执行单判据读不到字段`。
    - ❌ `tcb login` 走 device-flow，需人工在浏览器点授权（**授权页在本机渲染空白**），且授权后是**主账号级凭据落到 `~/.cloudbase/`** ⇒ 违反最小权限。
    - ✅ `"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" cloud functions deploy --project <repo> --env <envId> --names <fn> -r`
      —— `cli islogin` → `{"login":true}`（**复用 IDE 会话，零新凭据**）；`--env` 从单源现读不写死；`-r`=云端装依赖。
    - ⚠️ `cli cloud functions info` **只有 status/timeout/runtime，不含更新时间** ⇒ **证不了"已更新"**；必须另取**控制台函数列表「最后更新时间」**截图。
    - ⚠️ 首次部署常撞 `Creating/Updating` 并发错 ⇒ **等 1 分钟原命令重跑即过**。
    - 完整 runbook（含"先证非 prod"、`sync_common.js` 前置、包体差异留证）见 `scripts/examples/cloudbase_deploy/README.md`。
25. **引用"某截图显示了 X"之前，先查那张图自己的 mtime**（2026-09-18 实踩，代价 = 一条证据当场被撤回）：我曾把截图 `35_function_list2.png` 说成"显示了 `2026.09.18 02:29:24`"，而该文件 **mtime = 02:27:08** ⇒ **截图不可能显示"未来"的时间** ⇒ 复审方一查 `ls` 就推翻了该数值，只能撤回并降级为定性表述。
    - 当时它是"部署件已更新"的**唯一**证据（`cli cloud functions info` **不含更新时间**）⇒ 撤掉后只能靠**字段差**（旧件根本没有那两个键）兜底 —— 结论没塌，纯属运气好。
    - **规矩**：① 写进文档前先 `ls -l --time-style=+%H:%M:%S <png>`，确认"图里那个时刻"**在逻辑上可能**；② **读图看时间戳/小号数字 = 高风险**（见 `references/pitfalls.md` P32：OCR/视觉对小字稳定读错）⇒ 关键数值优先找**机器可读**出处（CLI 输出 / JSON / 日志），截图只当辅助；③ 一条证据被撤时，**必须同时回检依赖它的结论**，并显式改判（别只改那一处引用）。
26. **从沙箱里拉起微信开发者工具 + 用其自带 CLI 出预览码（2026-09-21 全链路实测）**：
    - **拉 IDE**：别用 `cli.bat open`（见 #14；沙箱里直接跑 `wechatdevtools.exe` 会 ICU 崩）。用 **Shell 启动**：Python `subprocess.Popen([r"C:\Windows\explorer.exe", <wechatdevtools.exe 全路径>])` —— explorer 把请求转交给已在运行的 shell，进程继承用户正常环境 ⇒ 正常起窗（顶层标题仍是 `WeChat Web Devtools`）。约 30–60s 出窗，**用 `win_gui.py list` 判**（截图可能拍早、窗口还在后面）。
    - 🔴 **CLI 必须用「完整规范长路径」调**：`"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"`。若用 8.3 短路径 `C:/PROGRA~2/.../cli.bat`，CLI 会按不同的"安装路径"算出**错误的 profile hash**（实测去找不存在的 `User Data\8a18a98f…`）⇒ 报 `Please ensure that the IDE has been properly installed` + 写 `.cli` ENOENT。**换成完整长路径即通**：`islogin` → `{"login":true}`、`IDE server … :35237`。
    - **调法**：路径含空格+中文 ⇒ 用 Python `subprocess.run([CLI]+args, cwd=<装目录>)` 传 list，别走命令解释器（呼应 #18）。示例见本机 `_gui/cli_run.py`。
    - **出预览码**：`cli.bat preview --project <repo> --qr-output <png> --qr-format image` ⇒ 直接落一张二维码 png（实测包体 154 KB、AppID `wx33c110dc57a9c8dc`）。
27. **IDE 的"活着"是挂在 cli 的 WebSocket 上的 —— 断连即退出**（2026-09-25 实测）：日志最后一行恒为 `[CLIWebSocketServer] cli ws client disconnect`，随后进程消失。`os.startfile` / `Popen(DETACHED_PROCESS|CREATE_BREAKAWAY_FROM_JOB)` 直接起窗**都会在 2–30 秒内退出、且不写任何新日志**（日志停在编译器阶段），极易误判成"崩了/被杀了/单实例锁"。
    - ✅ **续命配方**：**后台循环反复喂** `cli.bat open --project <repo>`（每轮 2.6–5 s，输出含 `IDE server started successfully` 即成功）⇒ **实测连续保活 9m48s / 30 轮全成功**。
    - ⚠️ 代价：高频 `cli open` 让项目反复重载 ⇒ 模拟器反复卡死弹「模拟器长时间没有响应」（见 #29）。**只在自己要连续操作 GUI 的那段时间开循环**，操作完立刻停。
    - ⇒ 推论：**"IDE 起不来" 先查日志最后一行**，别上来就查单实例锁或权限（详见 `references/pitfalls.md` P33）。
28. **点击坐标只能有一个来源：全屏 1:1 物理 PNG**（2026-09-25 实踩两次）：
    - `win_gui` 自带 `set_dpi_aware` ⇒ 其 `rect(hwnd)`/`list` 返回**物理像素**（实测窗口 1920×1500）；而**裸 ctypes `EnumWindows`+`GetWindowRect`**（临时探查脚本）返回**逻辑像素**（1280×1000）—— 150% 缩放下**差 1.5 倍**，混用必然整体点偏。
    - `screenshot_window` 走 **PrintWindow**：渲染出的**主题/尺寸可能与真实屏幕不一致**（实测窗口 PNG 是浅色主题、真实屏幕是深色）⇒ **窗口 PNG 只可用于"阅读"，其坐标不可喂 `click`**。
    - ✅ 正解：坐标一律在 `screenshot_screen`（或 `PIL.ImageGrab.grab()`）的**全屏 PNG** 上实测（OCR 中心 / 像素簇）—— 见 `references/pitfalls.md` P34。
29. **模态框会"吃掉"你的点击，而 `frames_hash` 仍旧在变 ⇒ 极易误判成"点击无效"**（2026-09-25 实踩）：连点工具栏 `∞` 四五次，每次 hash 都"变了"（背后模拟器在重绘），但云开发控制台窗口**始终不出现**；真因是屏上压着模态框「**模拟器长时间没有响应**…」（关闭 / 终止模拟器 / 暂停模拟器）挡住了工具栏。
    - ✅ 破法：① 先 OCR 定位模态框按钮并点掉（实测「关闭」≈(812,241)、「终止模拟器」≈(963,241)）；② **"点中了" 的唯一有效判据 = 目标窗口真的出现**（`find_window(title='云开发控制台')` 返回 hwnd），**不是 hash 变化** —— hash 变只说明"有东西在动"，不说明"你的目标动了"。
    - ⇒ 与 #22 的"比 md5"配套用：md5 只用来**证否**（相同=肯定没动），**不能用来证成**（见 `references/pitfalls.md` P35）。

## 安全护栏（不可违反）
- 只做用户明确要求的操作；**不确定就先截图给用户确认再点**。
- 禁止在**密码框/支付/银行/网银**等敏感界面做输入注入；遇到就停下交回人工。
- 不做不可逆动作（删除文件、格式化、发送邮件/消息、提交订单）——除非用户逐字确认。
- 修改用户文件前先备份；脚本只读/写用户指定的路径，不做任何目录遍历删除。
- 键鼠属于"替人动手"，**每一步留证**：关键动作前后各截一张图，存 `%TEMP%` 或用户指定目录。

## 实战配方（照抄改坐标）
```python
import sys
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

h = find_window(title='Devtools')        # ① 找窗（子串匹配）
focus(h)                                 # ② 置前
screenshot_window(h, r'C:\tmp\a.png')    # ③ 截图 → 用 Read 看图
key(VK['B'], ctrl=True)                  # ④ Ctrl+B 编译
time.sleep(6)
screenshot_window(h, r'C:\tmp\b.png')    # ⑤ 再截一张确认结果
```
更多配方见 `references/recipes.md`（微信开发者工具验收、控制台日志导出、颜色/锚点定位按钮、长文本投喂、**哨兵法验证构建配置生效性**、**云开发控制台批量建数据库索引 —— 配方 14/14.1**、**云开发控制台跑云函数/云端测试（免部署在云上验逻辑 + 用"两次运行结果差"证幂等）—— 配方 15**）；
**怎么把原语串成一次"看→想→动→验"的高效闭环（装配图）见 `references/playbook.md`**；
全部坑与判定法见 `references/pitfalls.md`；换电脑安装见 `references/install.md`；
给新会话的"提醒词"在 `references/reminder.md`。

**常驻化（推荐）**：本技能已通过 Hooks 常驻 —— 新会话开工就有这套能力，不用等关键词匹配。
换机重装只需 `python scripts/install_hooks.py`（幂等）。详见 `references/install.md` §6。

## 一条通用方法学：**哨兵法**（要"证明某个配置真生效"时）
> 适用：任何"我改了构建/忽略/过滤配置，但工具没报错、结果又看不出区别"的场合。

思路：**造一个只可能被目标配置挡住的探针**，让"配置生效"和"配置没生效"产生**完全不同的现象**。

实战案例（微信小程序 `packOptions.ignore`）：
1. 目标规则是 `folder: specs`；但另有"过滤未使用文件"机制会掩盖效果 → 两者结果都是 9 KB，**分不开**。
2. 破法：把探针做成**"被使用文件"**（`app.js` 里 `require` 它）⇒ 只剩 folder 规则能挡。
3. 探针后缀选**不在其它规则里**的（`.js` 不在 `.pdf/.docx/.md/.txt` 里）。
4. 观察：预览**直接报 `module not found`** ⇒ 规则生效（若未生效则是包体从 9 KB 涨到 ~400 KB，现象完全不同）。
5. **务必还原**：删探针 + 还原入口文件 + `git diff` 必须为空 + 还原后复跑一次确认回基线。

## 移植到别的电脑
```bash
python scripts/pack.py --out "%USERPROFILE%/Desktop/win-desktop-control.zip"
```
把 zip 拷到新机器，解压到 `C:\Users\<用户名>\.workbuddy\skills\win-desktop-control\`，跑 `scripts/bootstrap.py` 即可。
