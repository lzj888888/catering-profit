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
