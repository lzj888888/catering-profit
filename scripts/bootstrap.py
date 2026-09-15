#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""bootstrap.py — 换电脑 / 首次使用的环境自检与安装引导。

用法：
    python bootstrap.py               # 只体检，不装东西
    python bootstrap.py --install     # 体检并尝试 pip 安装 Pillow（仅截屏需要）
    python bootstrap.py --hint        # 只打印「给新会话的提醒词」

体检项：
  1. 是否 Windows
  2. Python 版本 + 解释器路径（别的工具调用时要用这个路径）
  3. Pillow 是否可用（没有则只有键鼠能力，截屏不可用）
  4. ctypes 调 Win32 是否通（枚举窗口数量）
  5. 剪贴板读写是否通
"""
import os
import platform
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REMINDER_FILE = os.path.join(os.path.dirname(HERE), 'references', 'reminder.md')


def check():
    rows = []
    rows.append(('system', platform.system() + ' ' + platform.release(), platform.system() == 'Windows'))
    rows.append(('python', sys.executable + '  (' + platform.python_version() + ')', True))
    try:
        import PIL  # noqa
        from PIL import ImageGrab  # noqa
        pil = ('Pillow ' + PIL.__version__, True)
    except Exception as e:
        pil = ('MISSING -> pip install pillow  (%s)' % type(e).__name__, False)
    rows.append(('pillow', pil[0], pil[1]))

    win_ok, n = False, -1
    clip_ok = False
    if platform.system() == 'Windows':
        try:
            sys.path.insert(0, HERE)
            import win_gui as w
            n = len(w.enum_windows())
            win_ok = n >= 0
            clip_ok = w.set_clipboard('WIN_GUI_BOOTSTRAP_OK') and (w.get_clipboard() == 'WIN_GUI_BOOTSTRAP_OK')
        except Exception as e:
            rows.append(('win32', 'ERROR ' + repr(e), False))
    rows.append(('win32', 'visible windows = %s' % n, win_ok))
    rows.append(('clipboard', 'read/write ok' if clip_ok else 'FAILED（可能被安全软件/剪贴板占用拦截）', clip_ok))
    return rows


def install():
    cmds = [
        [sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip'],
        [sys.executable, '-m', 'pip', 'install', 'pillow'],
    ]
    for c in cmds:
        print('$', ' '.join(c))
        r = subprocess.run(c, capture_output=True, text=True)
        print(r.stdout.strip()[-800:])
        if r.returncode != 0:
            print(r.stderr.strip()[-800:])
    return 0


def hint():
    if os.path.exists(REMINDER_FILE):
        with open(REMINDER_FILE, encoding='utf-8') as f:
            print(f.read())
    return 0


def main():
    args = sys.argv[1:]
    if '--hint' in args:
        return hint()
    print('=== win-desktop-control 环境体检 ===')
    all_ok = True
    for name, val, ok in check():
        all_ok = all_ok and ok
        print('%-10s %-6s %s' % (name, 'OK' if ok else 'FAIL', val))
    print('-----------------------------------')
    print('解释器（其它工具调用本技能脚本时用它）：')
    print('    ' + sys.executable)
    if not all_ok and '--install' in args:
        print('\n=== 尝试安装缺失依赖 ===')
        install()
        print('\n=== 复检 ===')
        for name, val, ok in check():
            print('%-10s %-6s %s' % (name, 'OK' if ok else 'FAIL', val))
    elif not all_ok:
        print('\n有项目 FAIL：加 --install 让本脚本试着装依赖；仍失败见 references/install.md')
    print('\n=== 给新会话的提醒词（复制这段给 Agent）===')
    hint()
    return 0


if __name__ == '__main__':
    sys.exit(main())
