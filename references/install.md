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
│  ├─ ocr_screen.py         OCR 读屏/读图（list/read/find/shot/watch）
│  ├─ bootstrap.py          环境体检 / 装依赖 / 打印提醒词
│  ├─ hook_reminder.py      常驻提醒钩子本体（SessionStart / UserPromptSubmit 调用）
│  ├─ install_hooks.py      把钩子装进 WorkBuddy 全局设置（幂等，含 --remove/--status）
│  └─ pack.py               打包成 zip
│  （scripts/examples/ 为实战脚本族：cloudbase_index 建索引 / cloudbase_deploy 部署 / cloudbase_smoketest 冒烟）
├─ vendor/
│  └─ ocrlibs/              OCR 依赖自带（winocr + winrt-*，约 3.5 MB，离线可用）
└─ references/
   ├─ pitfalls.md           踩坑全集（35 条；P21 起为持续追加，以标题判断类目）
   ├─ recipes.md            实战配方（15 个）
   ├─ playbook.md           装配图（统一前置 / 闭环七步 / 决策树 / 方法学嫁接）
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
| **Windows OCR 语言包** | OCR 必需 | 引擎是系统自带的 `Windows.Media.Ocr`，**需要目标语言的 OCR 能力包** |

### OCR 语言包（换机必读）
`ocr_screen.py` 走系统 `Windows.Media.Ocr`，**不是离线模型**、也不带字库 —— 它依赖 Windows 已装的 OCR 语言包。
- 本机实测：`zh-Hans-CN / zh-Hans / zh-CN` 可用，`en-US` 未安装（`ocr_screen.py` 会按 `zh-Hans-CN → zh-Hans → zh-CN → en-US` 顺序自动挑第一个能用的）。
- **换到新电脑/给别人**：要识别哪种语言文字，那台机器就得装对应 OCR 包。
  - 通常**系统显示语言**的 OCR 包默认就在（中文系统 → 中文 OCR 开箱即用）。
  - 若要识别**非系统语言**（如中文系统想认英文），需先装包：
    ```powershell
    # 以"英语 OCR"为例（管理员 PowerShell）
    Add-WindowsCapability -Online -Name "Language.OCR~~~en-US~0.0.1.0"
    ```
- 装好前 `ocr_screen.py` 会明确报错而不是静默返回空 —— 看到报错先确认目标机有没有对应语言包。

## 5. 验证（换机后必做）
```bash
python scripts/win_gui.py selfcheck      # 期望：windows>0、clipboard=True、screenshot=路径，末行 SELFCHECK PASS
python scripts/win_gui.py list           # 能看到窗口清单
python scripts/win_gui.py shot --screen --out "%TEMP%\t.png"   # 出图
```
然后用 Read 读那张 png 确认真的是你的屏幕。

## 6. 常驻化：让技能「启动 WorkBuddy 就在」（强烈建议）

光把技能放在 `skills/` 目录里，模型要靠**关键词匹配**才会想起它 —— 提问没踩中触发词就会漏。
解决办法是用 **Hooks** 把能力提示**强行注入上下文**，不依赖模型记忆。

**原理**（CodeBuddy/WorkBuddy Hooks 规范）：`SessionStart` 与 `UserPromptSubmit` 这两个事件，
在钩子 **exit 0** 时其 **stdout 会被注入 Agent 上下文**。这是官方文档明确的语义，不是玄学。

装好后的效果：
| 事件 | 行为 | 噪音 |
|---|---|---|
| `SessionStart` | 每次新会话，注入 5 行能力定位（目录 / 解释器 / 最小唤起 / OCR 用法 / 禁止投降） | 固定 5 行，很小 |
| `UserPromptSubmit` | **仅当**你的提问命中桌面类关键词（截屏/点击/鼠标/键盘/窗口/界面/按钮/弹窗/OCR/读屏/卡死/InsCode…）时，才注入「标准闭环七步 + 5 条避坑」 | 未命中则**一字不吐**（零噪音） |

```bash
# 安装（幂等，可重复跑；会自动备份原 settings.json）
python "C:/Users/<用户名>/.workbuddy/skills/win-desktop-control/scripts/install_hooks.py"

python .../install_hooks.py --status   # 只看状态，不改文件
python .../install_hooks.py --remove   # 卸载本技能注册的钩子
```

它写的是 `~/.workbuddy/settings.json` 的顶层 `hooks` 字段（只**新增**这一个 key，不动 sandbox/claw/enabledPlugins）。

⚠️ **两个注意点**
1. 装完**重开一个会话**才生效（hooks 在会话启动时加载）。
2. 官方规范说"外部修改需在 `/hooks` 面板审核后生效"。若重开会话后没看到提示，在对话框输入 **`/hooks`** 打开面板，把新增的两条审核通过即可。

想手动确认钩子本身没问题，可直接跑：
```bash
echo '{"prompt":"帮我截屏看看界面"}' | python scripts/hook_reminder.py prompt   # 应输出详细提示
echo '{"prompt":"帮我写首诗"}'        | python scripts/hook_reminder.py prompt   # 应无输出
python scripts/hook_reminder.py session                                          # 应输出 5 行定位
```

## 7. 与其它技能的关系
- 前身实现散落在 `inscode-desktop-feed/scripts/{inscode_ui.py, win_generic.py}`（为「快马 InsCode」投喂而写）。
- 本技能把其中**与 App 无关**的部分抽出来泛化增强，成为通用能力；`inscode-desktop-feed` 仍保留业务投喂流程（批次、验收、硬约束）。
- 建议：**通用键鼠/截屏一律用本技能**；InsCode 投喂用 `inscode-desktop-feed`（它会复用同类原语）。

## 8. 备份
- 备份副本惯例目录：`C:\Users\lzj\WorkBuddy\_skill_backups\win-desktop-control_YYYYMMDD\`
- 打包 zip 放桌面 / 网盘，换机直接解压。
