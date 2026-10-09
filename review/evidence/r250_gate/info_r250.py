# -*- coding: utf-8 -*-
"""info_r250.py —— 回读 importSalesBill 云端 info（部署后必做：新部署 timeout 默认长回 3）

🔴 判据纪律：**绝不按 `│` 匹配**（GBK 会把竖线读坏）；只按 **ASCII** 关键字判，
   并把原始输出落盘（`info_r250_raw.txt`）供机器复核。
🔴 `cli … info --names` 是 **[array] ⇒ 必须空格分隔**（逗号 ⇒ 看着跑通、实为空表）。
"""
import io, os, subprocess

CLI = r"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
ENV = "cloud1-d4gphpoxy337f2a25"
FN = "importSalesBill"
ARCH = os.path.join(REPO, "review/evidence/r250_gate", "info_r250_raw.txt")

args = [CLI, "cloud", "functions", "info", "--names", FN, "-e", ENV, "--project", REPO]
r = subprocess.run(args, cwd=REPO, capture_output=True, text=True,
                   encoding="utf-8", errors="replace", timeout=300)
out = (r.stdout or "") + "\n--- STDERR ---\n" + (r.stderr or "")
io.open(ARCH, "w", encoding="utf-8").write(out)
print("RC =", r.returncode, "| 存档 =", ARCH)
keep = ("timeout", "runtime", "memorysize", "handler", "importsalesbill", "lastmodif", "status", "size")
for ln in out.splitlines():
    low = ln.lower()
    if any(k in low for k in keep):
        print("   " + ln.strip())
