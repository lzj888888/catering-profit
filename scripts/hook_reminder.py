#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hook_reminder.py —— 让「win-desktop-control」技能常驻的钩子脚本。

用法（由 ~/.workbuddy/settings.json 的 hooks 调用，勿手工执行）：
    python hook_reminder.py session   # SessionStart：始终注入简短能力提示
    python hook_reminder.py prompt    # UserPromptSubmit：命中桌面类关键词才注入详细提示

契约（CodeBuddy/WorkBuddy Hooks 规范）：
  - 输入：stdin 为 JSON（UserPromptSubmit 含 "prompt" 字段）；输入可为空，不得崩溃。
  - 输出：exit 0 时，stdout 对 SessionStart / UserPromptSubmit **会注入 Agent 上下文**。
  - 不输出任何内容 = 静默（prompt 模式未命中时的正常行为）。
  - 调试日志一律写 stderr，绝不污染 stdout。

设计原则：**零噪音**。session 模式只给 3 行定位信息；prompt 模式未命中关键词则一字不吐。
"""

import sys
import re
import json

SKILL_DIR = r"C:/Users/lzj/.workbuddy/skills/win-desktop-control"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

# —— 命中即注入详细提示的关键词（正则，中文 + 英文）——
PROMPT_PATTERN = re.compile(
    r"截屏|截图|截个图|屏幕|屏幕上|显示器的|点一下|点击|点这个|点那个|鼠标|右键|双击|滚轮|"
    r"键盘|按键|快捷键|组合键|剪贴板|粘贴|ctrl\+|窗口|界面|按钮|弹窗|对话框|弹框|"
    r"桌面|软件|应用|客户端|GUI|OCR|读屏|识图|看图|坐标|控键鼠|键鼠|驱动|"
    r"卡死|无响应|未响应|假死|死循环|开发者工具|DevTools|devtools|预览|上传|真机|"
    r"InsCode|inscode|微信开发者|小程序工具|帮我操作|操作一下|自动化|自动化点击",
    re.IGNORECASE,
)

COMPACT = (
    "[常驻能力·win-desktop-control] 本机已装「真实截屏 + 键鼠控制 + OCR 读屏」技能，"
    "可驱动任意 Windows 桌面应用。\n"
    "  技能目录: {d}\n"
    "  解释器  : {p}\n"
    "  最小唤起: sys.path.insert(0, r'{d}/scripts'); from win_gui import *   "
    "# shot/click/key/find_window/probe/rect/screenshot_window\n"
    "  OCR 读屏: {p} {d}/scripts/ocr_screen.py read <png>   |   find <png> 关键词...\n"
    "  ⚠️ 禁止说「我做不到截图/控鼠标」——先跑 {d}/scripts/bootstrap.py 自检再下结论。"
).format(d=SKILL_DIR, p=PY)

DETAIL = COMPACT + (
    "\n\n[动手前必读]\n"
    "  1) 标准闭环七步：找 → 前置 → 留证(前) → 定位 → 判活(probe) → 动 → 验+留证(后)。"
    "**先解决「坐标从哪来」和「窗口活没活」，再动手**，别试错连点（会把半死窗口推成真死）。\n"
    "  2) `T` 必须用 Windows %TEMP%，**不能用 Git Bash 的 /tmp**（虚拟挂载，桌面应用打不开）。\n"
    "  3) 复核截图要截**目标窗口本身**（screenshot_window(hwnd)），别用全屏截图——会把别的窗口文字误读进来。\n"
    "  4) 按钮定位**优先锚点法**（OCR 出两个已知按钮 → 等距推第三个），别只靠颜色（主题一切换就失效）。\n"
    "  5) 现象用本技能取、**结论用既有纪律判**：直接证据>推理、留证入 review/evidence/、可回滚+复验。\n"
    "  详见 {d}/references/playbook.md（装配图）、pitfalls.md（26 坑）、recipes.md（13 配方）。"
).format(d=SKILL_DIR)


def read_prompt():
    """尽力从 stdin 取出用户提示词；任何异常都返回空串，绝不崩。"""
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return ""
        data = json.loads(raw)
        if isinstance(data, dict):
            return str(data.get("prompt", "") or "")
        return raw
    except Exception as exc:  # 输入缺失/非 JSON 都属正常
        print("[hook_reminder] stdin 解析跳过: %r" % (exc,), file=sys.stderr)
        return ""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "session"

    if mode == "session":
        # SessionStart：始终注入（这是「启动 WorkBuddy 就一直有这个技能」的保证）
        print(COMPACT)
        return 0

    if mode == "prompt":
        prompt = read_prompt()
        if prompt and PROMPT_PATTERN.search(prompt):
            print(DETAIL)
        # 未命中 → 静默，零噪音
        return 0

    print("[hook_reminder] 未知 mode=%r（应为 session|prompt）" % mode, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
