#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
install_hooks.py —— 把「常驻提醒」钩子装进 WorkBuddy 全局设置（幂等，可重复跑）。

作用：让 win-desktop-control 技能**开机/开新会话即常驻** —— 不用等模型"想起来"再去匹配技能。

安装两条钩子（写入 ~/.workbuddy/settings.json）：
  - SessionStart     : 每次启动/新会话，注入 3 行能力定位信息（目录/解释器/最小唤起/OCR 用法）。
  - UserPromptSubmit : 仅当你的提问命中桌面类关键词（截图/点击/窗口/界面/OCR/卡死…）时，
                       再注入"标准闭环七步 + 5 条避坑"的详细提示。未命中则一字不吐（零噪音）。

依据（CodeBuddy/WorkBuddy Hooks 规范）：SessionStart 与 UserPromptSubmit 在 exit 0 时，
**stdout 会被注入 Agent 上下文**，这正是"常驻"的实现原理。

用法：
    python install_hooks.py            # 安装（幂等）
    python install_hooks.py --remove   # 卸载本技能注册的钩子
    python install_hooks.py --status   # 只看状态，不改文件

换电脑/给别人装时：先跑 `bootstrap.py --install` 装依赖，再跑本脚本装钩子，然后重开一个会话即可。
"""

import sys
import os
import json
import shutil
from datetime import datetime

SETTINGS = os.path.expanduser("~/.workbuddy/settings.json")
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMINDER = os.path.join(SKILL_DIR, "scripts", "hook_reminder.py").replace("\\", "/")

# 优先用当前解释器；若不是 WorkBuddy 自带 env，回落到常见路径
PY = sys.executable.replace("\\", "/")
if "envs" not in PY:
    fallback = os.path.expanduser("~/.workbuddy/binaries/python/envs/default")
    for cand in (os.path.join(fallback, "Scripts", "python.exe"),
                 os.path.join(fallback, "bin", "python")):
        if os.path.exists(cand):
            PY = cand.replace("\\", "/")
            break

HOOK_CMD_TMPL = '"%s" "%s" %s'


def build_hooks():
    return {
        "SessionStart": [
            {
                "hooks": [
                    {
                        "type": "command",
                        "command": HOOK_CMD_TMPL % (PY, REMINDER, "session"),
                        "timeout": 10,
                    }
                ]
            }
        ],
        "UserPromptSubmit": [
            {
                "hooks": [
                    {
                        "type": "command",
                        "command": HOOK_CMD_TMPL % (PY, REMINDER, "prompt"),
                        "timeout": 10,
                    }
                ]
            }
        ],
    }


def is_ours(hook_obj):
    """判断某条 hook 是否由本技能注册（按 hook_reminder.py 路径识别）。"""
    return "hook_reminder.py" in hook_obj.get("command", "")


def main():
    args = sys.argv[1:]
    do_remove = "--remove" in args
    status_only = "--status" in args

    print("settings : %s" % SETTINGS)
    print("skill    : %s" % SKILL_DIR)
    print("python   : %s" % PY)
    print("reminder : %s" % REMINDER)
    if not os.path.exists(REMINDER):
        print("\n❌ 找不到 hook_reminder.py，安装中止。")
        return 1

    data = {}
    if os.path.exists(SETTINGS):
        with open(SETTINGS, encoding="utf-8") as f:
            data = json.load(f)
    else:
        print("\n⚠️ settings.json 不存在，将新建。")

    hooks = data.get("hooks", {})
    ours = sum(
        1
        for ev, cfgs in hooks.items()
        for cfg in cfgs
        for h in cfg.get("hooks", [])
        if is_ours(h)
    )
    print("\n当前本技能已注册钩子数 = %d（事件：%s）" % (ours, list(hooks.keys())))

    if status_only:
        print("（--status：未做任何修改）")
        return 0

    if do_remove:
        for ev in list(hooks.keys()):
            kept = []
            for cfg in hooks[ev]:
                cfg["hooks"] = [h for h in cfg.get("hooks", []) if not is_ours(h)]
                if cfg["hooks"]:
                    kept.append(cfg)
            if kept:
                hooks[ev] = kept
            else:
                del hooks[ev]
        if hooks:
            data["hooks"] = hooks
        else:
            data.pop("hooks", None)
        action = "卸载"
    else:
        # 幂等：先清掉本技能的旧条目，再整组写入（避免重复叠加）
        for ev in list(hooks.keys()):
            kept = []
            for cfg in hooks[ev]:
                cfg["hooks"] = [h for h in cfg.get("hooks", []) if not is_ours(h)]
                if cfg["hooks"]:
                    kept.append(cfg)
            if kept:
                hooks[ev] = kept
            else:
                del hooks[ev]
        for ev, cfgs in build_hooks().items():
            hooks.setdefault(ev, []).extend(cfgs)
        data["hooks"] = hooks
        action = "安装"

    # 备份后写入
    if os.path.exists(SETTINGS):
        bak = SETTINGS + ".bak-" + datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(SETTINGS, bak)
        print("\n已备份原设置 → %s" % bak)

    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    n = sum(
        1
        for cfgs in data.get("hooks", {}).values()
        for cfg in cfgs
        for h in cfg.get("hooks", [])
        if is_ours(h)
    )
    print("\n✅ %s完成。本技能钩子数 = %d（事件：%s）" % (action, n, list(data.get("hooks", {}).keys())))
    if n:
        print("   → 重开一个 WorkBuddy 会话即生效。")
        print("   → 若未生效：在对话框输入 /hooks 打开面板，审核通过外部新增的钩子即可。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
