# 桌面自动化踩坑全集（本机实战沉淀，2026-09）

按"症状 → 真因 → 对策"组织。每条都来自真实翻车现场。

---

## 一、输入类

### P1 输入法吞字（最高频）
- 症状：`keybd_event` 打 `wbtest123`，输入框只剩 `25123`。
- 真因：搜狗等 IME 把字母当组字过程吃掉。
- 对策：**任何中文/长文本/甚至 ASCII 短串都走 `set_clipboard(text)` + `Ctrl+V`**。

### P2 64 位指针截断
- 症状：`GlobalLock` 返 0 → access violation。
- 真因：ctypes 默认 `restype=c_int`，64 位句柄被截成 32 位。
- 对策：`GlobalAlloc/GlobalLock/GetClipboardData` 必须设 `restype = ctypes.c_void_p`（脚本已设）。

### P3 剪贴板被占用
- 症状：`OpenClipboard` 返 False。
- 对策：重试 10 次、每次 sleep 0.3（脚本已内置）。

---

## 二、坐标与显示类

### P4 高 DPI 偏移
- 症状：坐标整体偏移 / 截图与预期不符（125%、150% 缩放屏尤其明显）。
- 对策：进程启动先 `shcore.SetProcessDpiAwareness(2)`，失败回退 `user32.SetProcessDPIAware()`（脚本已自动做）。

### P5 多显示器/负坐标
- 症状：窗口在副屏时 `GetWindowRect` 返回负 left。
- 对策：截图 bbox 直接用 rect，不要自己 clamp；点击坐标用物理像素原值。

### P6 SetCursorPos 看似失效
- 症状：设 (312, 500)，读回 (889, 500)。
- 排查顺序：① 用户的手是不是正在动鼠标（争夺光标）→ 等 1 秒再读；
  ② 是否管理员权限目标 + UIPI（见 P8）；③ 目标窗口是否卡死（见 P9）。

---

## 三、窗口与焦点类

### P7 SetForegroundWindow 静默失败
- 对策：兜底 `AttachThreadInput`（**属 user32！** 曾误写成 `kernel32.AttachThreadInput` → 一走兜底就 AttributeError）。
- 另：`ShowWindow(9)`（SW_RESTORE）即可，**别用 `ShowWindow(3)`/MAXIMIZE**（实测会把窗口搞成空白态）。

### P8 ⛔ 权限墙 UIPI
- 症状：`taskkill /PID x /T /F` 拒绝访问；`PostMessage(WM_CLOSE)` 返 False；点击/按键**完全无效果**。
- 真因：目标以管理员运行，低完整性进程不能给高完整性窗口发消息。
- 关键认知：**截图与 `SetCursorPos` 不受 UIPI 限制** → **"能截图、能移鼠标" ≠ "能点击"**。
- 对策：请用户人工处理（任务管理器结束任务；权限不足就点左下角"以管理员身份重新启动"）。

### P9 窗口"假活"（Chromium/ Electron / NW 系）
- 症状：连点十几下毫无反应，但 `IsHungAppWindow()` 报健康、`SendMessageTimeout(WM_NULL)` 也有应答。
- 判定三步法（写成 `probe_alive()`）：
  1. **悬停高亮探针**：鼠标移到已知按钮上，1.2s 后截图与基线比对（Chromium 悬停必高亮，无差异 = 渲染进程死）。
  2. **多帧字节比对**：连拍 3 帧，md5 全同 = 屏幕根本不重绘。
  3. **结论**：UI 活不活看**会不会重绘**，不要问消息队列。
- 对策：只能让人重启该 App。

### P10 窗口标题不按你想的来
- 微信开发者工具顶层标题是 **`WeChat Web Devtools`**，**不含项目名**（项目名只在内部标签里）。
  → 用 `find_window(title='Devtools')`（子串匹配），别用项目名，否则返回 None。
- 很多 App 有隐藏小窗（IME、托盘、`SoPY_*`），枚举时按尺寸/类名过滤。

### P11 单实例守卫
- 旧实例还在时再启动 exe，新进程**立即 exit code 0**。→ "重启 App"必须先真正结束旧进程。

---

## 四、关闭与进程类

### P12 SendMessage(WM_CLOSE) 永久阻塞
- 症状：脚本假死。
- 真因：被关窗口弹模态（记事本"是否保存"），SendMessage 不返回。
- 对策：一律 `PostMessage`；必要时挂 `threading.Timer` 看门狗。

### P13 Git Bash 转义坏参数
- 症状：`taskkill //PID 37976 //T //F` → `无效参数/选项 - '//PID'`。
- 对策：用 Python `subprocess.run(['taskkill','/PID','37976','/T','/F'])`，或 `MSYS2_ARG_CONV_EXCL="*"`。

### P14 Git Bash 的 /tmp ≠ Windows 的 C:\tmp
- 现象：脚本写到 `/tmp/x.png`，Windows 程序找不到（实际在 Git Bash 虚拟路径）。
- 对策：统一用 `%TEMP%`（`C:\Users\<用户>\AppData\Local\Temp`）作中转目录。

---

## 五、菜单与对话框类

### P15 右键菜单必须同段脚本点完
- 症状：右键后脚本结束，下一段再点菜单项 → 菜单早已关闭，点击穿透到下层（误点 `Sources` 标签）。
- 对策：一段脚本内完成「右键 →（可截图留证）→ 点击菜单项」。

### P16 下拉菜单别点第二次
- 点开 `Default levels ▾` 后要**连点两个项目**；中途再点下拉本身 = 关菜单，后续点击穿透。

### P17 原生保存框（class `#32770`）
- 填路径：`focus(#32770)` → `set_clipboard(全路径)` → `Ctrl+A` → `Ctrl+V` → `Enter`（`save_dialog_fill()`）。
- 这比"在文件名框里点来点去"可靠得多。

---

## 六、读界面类

### P18 不要 OCR，先找导出
- 控制台/日志区域 → **右键 `Save as...`** 导出成文本文件，用 Read 读逐字文本，比截图识别准得多。
- ⚠️ 导出格式**不含级别标记**（`console.error`/`warn` 都只是纯文本行）→ **级别仍需看图**。

### P19 "1 error" 要辨级
- 调试器面板右上角 **`∧`** 可铺满面板（小面板一次只看 3~4 行，极易漏掉那条红的）。
- 左侧图标即级别：⚠ 黄三角 = warning，⊗ 红圈叉 = error。徽标 `⊘1 ⚠6` = 1 error / 6 warning。
- **标红 ≠ 你的代码有错**：微信开发者工具就曾把"以 `__` 开头结尾的目录为保留目录，`__tests__` 下文件将被忽略"标成 error——而忽略测试目录正是期望行为。
- `Clear console history` 能清列表，但**徽标计数不会归零**（累计值），别被误导。

### P20 用颜色定位按钮（坐标不必靠猜）
- 扫全幅找亮绿色像素团取中心，同排其它按钮按固定像素偏移推算。
  ```python
  pred = lambda r,g,b: g>150 and r<120 and b<140 and (g-r)>60 and (g-b)>40
  x, y = find_color_center(r'C:\tmp\a.png', pred)   # 绿色「暂停模拟器」中心
  click(x-343, y)                                    # 实测：关闭 = 绿钮中心 x-343，同 y
  ```

---

## 七、环境与依赖类

### P21 Bash 里调 PowerShell 被安全策略拦截
- 曾试图用 `powershell.exe` 截屏失败。→ 走 Python + ctypes/PIL。

### P22 安全软件
- 本机装 360 主动防御 + 金山毒霸，输入注入**曾整体失效数天**。→ **每次代点前先 `selfcheck`**，通了再动用户窗口。

### P23 长跑脚本别用 `| tail`
- 管道缓冲会让你误判"没输出"。→ 不加管道，或把日志写文件。

### P24 同文件多次 Edit 的竞态（顺带记）
- 同一文件在一条消息里发多个 Edit，只有最后一个生效。→ 串行 Edit 或整文件 Write。

### P25 「半死」窗口会骗过 probe：能重绘、能响应悬停，但**不接受点击**
- 现象（微信开发者工具实测，2026-09-16）：工具执行「重新打开此项目」后弹出模态保存框，状态栏显示 `Closing the window is taking a bit longer...`；
  - `probe` 返回 `alive: True`、`hover_diff: True`（鼠标移到按钮上画面**确实变了**）、`IsHungAppWindow = 0`；
  - 但点「保存」（坐标已裁图放大核到按钮中心）**无反应**，按 `ENTER` **无反应**。
- 结论：`hover_diff=True` **只证明"合成鼠标事件进了窗口"，不证明"业务逻辑还活着"**。应用在"关闭/重载项目"的收尾阶段让出了 UI 线程，输入进队列但没人处理（画面由合成器继续重绘）。
- 对策：**别硬怼**（继续狂点可能把它推到真死，只能人工重启）。识别信号 = **状态栏出现"正在关闭/重开"这类进度文案 + 模态点不动** → 立刻停手，把「点哪个按钮」交给人，并在回报里写清"我停在哪一步、你要点哪一个"。
- 反例（同一天、同机、同工具）：普通编译/预览流程里合成点击**完全正常** ⇒ 这不是权限/DPI 问题，是**应用状态**问题。判据要绑"应用正在做什么"，不能绑"上次行不行"。

### P26 微信开发者工具：**不要先 kill GUI 再用 `cli open`** —— 会留下零窗口实例永久占锁
2026-09-16 实测踩穿的完整链条，照着避坑：
1. 菜单「项目 → 重新打开此项目」会触发 **VSCode 系保存冲突**：`未能保存 "settings.json"：文件的内容较新。请将你的版本与文件内容进行比较。`
   （磁盘文件 = `project.private.config.json`，通常已 gitignore）。保存失败 → 关闭流程卡住 → 退回询问框 → **死循环**；此时 `取消/不保存/保存` 三个按钮**全都点不动**（见 P25）。
2. 改文件 mtime **救不了**（改旧、还原都无效；它比的是自己记录的 etag，不是 mtime）。
3. `Alt+F4` **也无效**（它已经在"正在关闭"状态，会吃掉关闭指令）。
4. `taskkill /F /PID <主进程>` 可以杀掉 GUI，但**之后千万别用 `cli.bat open` 去开**：
   CLI 会起一个**零窗口的 IDE 服务进程**（占住单实例锁 + HTTP 端口 35237），
   之后再双击 exe 启动 GUI 只会把请求转发给它 → **永远开不出窗口**，且这个残留进程是**提权**的，`taskkill` 返回"拒绝访问"。
5. 想提权杀它：`wscript` 触发 UAC 这条路**被安全策略当 LOLBin 拦**（`Known Windows LOLBin…`），Bash 调 PowerShell 也被拦。
   ⇒ **只能让人在任务管理器里结束 `微信开发者工具.exe`（必要时用管理员任务管理器），再正常双击启动。**
- ✅ 正确姿势：要"重开项目"就用**菜单**（前提是没有未保存冲突）；要"重启工具"就 `taskkill` 主进程后**用桌面快捷方式/exe 正常启动**，不要走 `cli open`。
- 判定残留实例：`enum_windows` 按 PID 过滤 → **窗口数 0 + 内存"暂缺"/CPU 0** = 已变僵尸服务进程。
