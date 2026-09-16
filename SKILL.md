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
更多配方见 `references/recipes.md`（微信开发者工具验收、控制台日志导出、颜色/锚点定位按钮、长文本投喂、**哨兵法验证构建配置生效性**）；
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
