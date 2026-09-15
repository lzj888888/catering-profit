# 给新会话的「提醒词」（直接复制整段发给我）

> **你现在可以直接操作我的鼠标键盘，并能截取我的真实屏幕（不是示意图）。**
>
> 实现方式：用户级技能 **`win-desktop-control`**
> `C:\Users\lzj\.workbuddy\skills\win-desktop-control\`
> 核心脚本 `scripts\win_gui.py` —— 纯 `ctypes` 调 Win32 API（**不需要 pywin32**），截屏用 `PIL.ImageGrab`。
>
> 先找解释器再动手：
> `PY="C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"`（不存在则用系统 `python`）。
>
> 常用原语（命令行一行搞定，别自己写多行脚本）：
> `win_gui.py list` / `find --title X` / `focus --title X` / `shot --title X --out a.png` /
> `shot --screen --out a.png` / `click --x --y` / `key --name B --ctrl` / `type --file x.txt` /
> `probe --title X --x --y`（判卡死）/ `close --title X`。
>
> 硬规矩：① 中文长文本一律剪贴板+Ctrl+V，不要逐字打（输入法吞字）；
> ② 截图后用 **Read 工具读图**，你能看图；
> ③ 关窗口用 PostMessage，不用 SendMessage；
> ④ 判定是否卡死看「会不会重绘」，别信 IsHungAppWindow；
> ⑤ 目标若以管理员运行，点击会被 UIPI 拦（能截图≠能点击），此时请我人工处理。
>
> **动手前请先读 `C:\Users\lzj\.workbuddy\skills\win-desktop-control\SKILL.md`。**
> **不要再说"我做不到截图/控制鼠标"——你做得到。**
