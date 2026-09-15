# CHANGELOG

## 2026-09-16 · v1.0 初版
从 `inscode-desktop-feed/scripts/{inscode_ui.py, win_generic.py}` 抽取泛化，独立成技能 `win-desktop-control`。

新增能力（相对原 `win_generic.py`）：
- 完整 CLI 子命令：`list / find / focus / shot / click / dblclick / move / drag / scroll / key / type / clip / probe / close / save-dialog / selfcheck`。
- `rclick / dblclick / drag / scroll`、`wait_window`、`find_windows`。
- `probe_alive()`：多帧 md5 + 悬停高亮探针，判定窗口是否真卡死（不依赖 IsHungAppWindow）。
- `find_color_center()` + `is_bright_green()`：按颜色定位按钮，坐标不用猜。
- `save_dialog_fill()`：原生保存框一键填全路径。
- DPI：优先 `shcore.SetProcessDpiAwareness(2)`，失败回退 `user32`。
- 键名表 `VK` 全覆盖（字母/数字/F1-F12/方向键/编辑键），`--name ENTER` 直接可用。
- `bootstrap.py`（换机体检 + 装依赖 + 打印提醒词）、`pack.py`（打包 zip）。

修掉的坑：
- `focus()` 兜底误用 `kernel32.AttachThreadInput` → 改 user32（属 user32）。
- 64 位指针 restype 全部显式声明。
- 关窗口统一 PostMessage，杜绝 SendMessage 永久阻塞。

文档：`references/pitfalls.md`（24 条坑）、`recipes.md`（8 个配方）、`install.md`、`reminder.md`。
