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

## 配方 9：重开项目（让 project.config.json 的改动真生效）
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
