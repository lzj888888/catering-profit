# 安装 / 迁移 / 分发

技能是**纯脚本 + 文档**，没有编译产物，拷目录即装。

## 1. 安装位置（用户级，所有项目通用）
```
C:\Users\<用户名>\.workbuddy\skills\win-desktop-control\
```
目录结构：
```
win-desktop-control/
├─ SKILL.md                 技能入口（Agent 读这个）
├─ scripts/
│  ├─ win_gui.py            核心驱动（模块 + CLI）
│  ├─ bootstrap.py          环境体检 / 装依赖 / 打印提醒词
│  └─ pack.py               打包成 zip
└─ references/
   ├─ pitfalls.md           踩坑全集
   ├─ recipes.md            实战配方
   ├─ install.md            本文件
   └─ reminder.md           给新会话的提醒词
```

## 2. 本机已装
- 路径：`C:\Users\lzj\.workbuddy\skills\win-desktop-control\`
- 解释器：`C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe`（自带 Pillow）
- 若 WorkBuddy 换了内置 Python 位置，用 `bootstrap.py` 重新确认解释器路径。

## 3. 换电脑 / 给别人（三步）
```bash
# ① 打包（在本机）
python "C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/pack.py" --out "%USERPROFILE%/Desktop/win-desktop-control.zip"

# ② 拷到新机器，解压到用户级技能目录
#    C:\Users\<用户名>\.workbuddy\skills\win-desktop-control\

# ③ 体检
python "C:\Users\<用户名>\.workbuddy\skills\win-desktop-control\scripts\bootstrap.py"
#      缺 Pillow 就：python scripts/bootstrap.py --install
```

## 4. 依赖
| 依赖 | 必需 | 说明 |
|---|---|---|
| Windows | ✅ | 用的是 Win32 API |
| Python 3.8+ | ✅ | 系统 python 或 WorkBuddy 内置 python 都行 |
| Pillow | 仅截屏 | `pip install pillow`；没有也能点、能敲键 |
| pywin32 | ❌ | **不需要**，全部走 ctypes |
| 管理员权限 | ❌ | 不需要；反而"目标是管理员"时才需要人工介入 |

## 5. 验证（换机后必做）
```bash
python scripts/win_gui.py selfcheck      # 期望：windows>0、clipboard=True、screenshot=路径，末行 SELFCHECK PASS
python scripts/win_gui.py list           # 能看到窗口清单
python scripts/win_gui.py shot --screen --out "%TEMP%\t.png"   # 出图
```
然后用 Read 读那张 png 确认真的是你的屏幕。

## 6. 与其它技能的关系
- 前身实现散落在 `inscode-desktop-feed/scripts/{inscode_ui.py, win_generic.py}`（为「快马 InsCode」投喂而写）。
- 本技能把其中**与 App 无关**的部分抽出来泛化增强，成为通用能力；`inscode-desktop-feed` 仍保留业务投喂流程（批次、验收、硬约束）。
- 建议：**通用键鼠/截屏一律用本技能**；InsCode 投喂用 `inscode-desktop-feed`（它会复用同类原语）。

## 7. 备份
- 备份副本惯例目录：`C:\Users\lzj\WorkBuddy\_skill_backups\win-desktop-control_YYYYMMDD\`
- 打包 zip 放桌面 / 网盘，换机直接解压。
