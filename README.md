# win-desktop-control

Windows 桌面「**真实截屏 + 键鼠控制 + OCR 读屏**」通用技能 —— 给 AI Agent（WorkBuddy / CodeBuddy / 任何能跑命令行的助手）用。

能抓**真实屏幕**（不是示意图）、能移动/点击鼠标、能敲键盘与组合键、能判定窗口是否卡死、能驱动任意桌面应用
（微信开发者工具 / 浏览器 / 记事本 / Electron 系 App…）。
**当模型读不了图片时**，还能把屏幕/截图上的文字 OCR 成文本、按关键词定位按钮坐标，照样闭环。

- 纯标准库 `ctypes` 直调 Win32（user32 / kernel32），**不需要 pywin32**
- 截屏用 `PIL.ImageGrab`（唯一外部依赖，缺了它也只剩"不能截图"，键鼠照常能用）
- OCR 用系统自带 `Windows.Media.Ocr`（离线），依赖随技能内置在 `vendor/ocrlibs/`
- **不需要管理员权限**

## 安装（三步）

```bash
# 1) 下载/解压到本机技能目录
#    Windows: C:\Users\<用户名>\.workbuddy\skills\win-desktop-control\
#    （别的 Agent 框架同理：放到它认的 skills 目录下即可）

# 2) 装依赖（只有截屏需要）
pip install pillow

# 3) 体检
python scripts/bootstrap.py
```

体检五项全 OK（Windows / Python / Pillow / Win32 可枚举窗口 / 剪贴板读写）即可使用。

## 用法（一行一个动作）

```bash
PY="<你的 python 解释器>"
S="skills/win-desktop-control/scripts/win_gui.py"

"$PY" "$S" list                                     # 列所有可见窗口（句柄/类名/标题/尺寸）
"$PY" "$S" selfcheck                                # 自检，末行 SELFCHECK PASS
"$PY" "$S" find  --title Devtools                   # 找窗口（默认子串匹配）
"$PY" "$S" focus --title Devtools                   # 置前
"$PY" "$S" shot  --title Devtools --out a.png       # 只截该窗口
"$PY" "$S" shot  --screen --out a.png               # 全屏
"$PY" "$S" click --x 1147 --y 573                   # 左键；--right 右键
"$PY" "$S" key   --name B --ctrl                    # Ctrl+B
"$PY" "$S" type  --file payload.txt                 # 长中文 → 剪贴板 + Ctrl+V
"$PY" "$S" probe --title Devtools --x 900 --y 60    # 判定窗口是否卡死
"$PY" "$S" close --title Devtools                   # 关窗口（PostMessage）
```

**关键闭环：截图之后用 Agent 的"读图"能力去看那张 png。** 截屏只是手段，"看得懂"才是结果。
**若模型读不了图片**：用 `python scripts/ocr_screen.py shot` 把屏幕 OCR 成文字（含坐标），一样能闭环，还更精确。

也能当模块用：

```python
import sys; sys.path.insert(0, r'.../win-desktop-control/scripts')
from win_gui import *
h = find_window(title='Devtools'); focus(h)
screenshot_window(h, r'C:\tmp\a.png')
key(VK['B'], ctrl=True)          # Ctrl+B 编译
```

## 目录

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 技能入口（触发词 / 能力速查 / 15 条硬教训 / 安全护栏） |
| `scripts/win_gui.py` | 核心驱动，模块 + CLI 双形态 |
| `scripts/ocr_screen.py` | OCR 读屏/读图（list/read/find/shot/watch），依赖在 `vendor/ocrlibs/` |
| `scripts/bootstrap.py` | 换机体检 + `--install` 装依赖 + `--hint` 打印提醒词 |
| `scripts/pack.py` | 打包成 zip，便于拷贝到别的电脑 |
| `vendor/ocrlibs/` | OCR 依赖自带（winocr + winrt-*），离线可用 |
| `references/pitfalls.md` | **26 条踩坑全集**（症状 → 真因 → 对策） |
| `references/recipes.md` | 13 个照抄配方（DevTools 验收、控制台日志导出、OCR 读屏、锚点/颜色定位按钮、哨兵法…） |
| `references/playbook.md` | **装配图**：统一前置 + 标准闭环七步 + 能力搭配决策树 + 与既有方法学嫁接 |
| `references/install.md` | 换电脑 / 给别人安装的完整步骤（含 OCR 语言包说明） |
| `references/reminder.md` | 给新会话的「提醒词」，复制发给 Agent 即可唤醒能力 |

## 三条最重要的坑

1. **中文/长文本绝不逐字敲键** —— 搜狗等输入法会吞字（`wbtest123` → `25123`）。一律剪贴板 + `Ctrl+V`。
2. **判定窗口是否卡死，看它会不会重绘**（多帧 md5 + 悬停高亮），**不要问消息队列**：卡死的 Chromium 对 `IsHungAppWindow()` 照样应答。
3. **目标是管理员权限进程时，能截图 ≠ 能点击**：`taskkill` 拒绝访问、`PostMessage` 被 UIPI 拦，只能请人手工处理。

更多见 `references/pitfalls.md`。

## 许可

随便用、随便改、随便分发。
