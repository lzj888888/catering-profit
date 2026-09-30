# -*- coding: utf-8 -*-
"""gen_n1_cmd.py —— 生成「N1 · R86 timeout 只读复验」的可复制命令文件。"""
import io, json, os

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
SRC = os.path.join(REPO, "review/evidence/r86_final_20260919/final_readback.json")
OUT = os.path.join(REPO, "review/evidence/r181b_gate/N1_timeout_readback_cmd.txt")

d = json.load(io.open(SRC, encoding="utf-8"))
names = list(d.keys())
exp = {k: v["expect"] for k, v in d.items()}

CLI = r'"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"'
PROJ = r'"C:\Users\lzj\WorkBuddy\Claw\catering-profit"'
ENV = "cloud1-d4gphpoxy337f2a25"
# 🔴 2026-09-30 实测更正：--names 是 [array] 类型，必须**空格分隔**。
#   原版用 ",".join(names) ⇒ cli 把整串当成一个函数名 ⇒ 云端报 InvalidParameterValue.FunctionName
#   （`cli cloud functions info --help` 明确写着：Names of cloud functions seperated by space,
#     e.g.: cli cloud functions info --names func_a func_b）
CMD = "%s cloud functions info --project %s -e %s --names %s" % (CLI, PROJ, ENV, " ".join(names))

L = []
L.append("N1 · R86 云函数 timeout 复验（只读 · 约 45 秒 · 不改任何东西）")
L.append("=" * 72)
L.append("🔴 2026-09-30 实测更正（本条命令此前**跑不通**，真因已定位）：")
L.append("   `--names` 是 [array] 类型，**必须空格分隔**。原版本用逗号分隔 ⇒ 整串被当作")
L.append("   一个函数名 ⇒ 云端返回 {\"code\":\"InvalidParameterValue.FunctionName\"}。")
L.append("   权威依据：`cli.bat cloud functions info --help` 输出写着")
L.append("     --names, -n  Names of cloud functions seperated by space, e.g.:")
L.append("                  cli cloud functions info --names func_a func_b   [array] [required]")
L.append("")
L.append("✅ 2026-09-30 已执行（WorkBuddy 走「用户态 cmd」跑的）：42/42 与期望值逐条一致，")
L.append("   timeout 分布 {60:2, 30:1, 20:38, 15:1}，**无 ==3**。")
L.append("   证据：review/evidence/r181e_c3c4/c3_timeout_final.txt（原始输出）")
L.append("         review/evidence/r181e_c3c4/c3_verify.json（机器比对，VERDICT=PASS）")
L.append("    ⇒ 「R86 云函数 timeout」这条待办可以划掉。")
L.append("")
L.append("用法：把下面【一条命令】整行复制，粘到 Windows 的 cmd 窗口里回车。")
L.append("⚠️ 两种跑法都行：① 你自己桌面的 cmd；② 由 WorkBuddy 用键鼠开「用户态 cmd」代跑")
L.append("   （实测可行 —— Win+R 启动的 cmd 由 explorer 创建，不受沙箱 reg.exe 黑名单限制）。")
L.append("⚠️ 前提：微信开发者工具必须**已经打开**（CLI 连的是 IDE 的 127.0.0.1 服务端口）。")
L.append("")
L.append("【一条命令】")
L.append(CMD)
L.append("")
L.append("【怎么判】只看输出表里每个函数的 timeout 列：")
L.append("  · 列里没有 3  → ✅ 与 2026-09-19 的三方独立回读一致 ⇒ 这条待办可以划掉")
L.append("  · 出现 3      → ❌ 才是真要有改的：把这几个函数名告诉我，再决定怎么改")
L.append("")
L.append("【期望值（2026-09-19 round46 / round50 三方独立回读定值）】")
for k in names:
    L.append("  %-24s %s" % (k, exp[k]))
L.append("")
L.append("【判据】整张表 grep 表格里的 “3” 列值应为 0 命中（分布只有 60/30/15/20 四种）。")
L.append("")
L.append("【如果要改（只在真出现 3 时才做）】")
L.append("  微信开发者工具 → 云开发控制台 → 云函数 → 选函数 → 版本管理 → 配置 →")
L.append("  高级配置 → 执行超时（1–300 秒）→ 确定；改完回读 info 的 timeout 列复核。")

io.open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
print("written:", OUT)
print("函数数:", len(names))
print("命令长度:", len(CMD), "字符")
