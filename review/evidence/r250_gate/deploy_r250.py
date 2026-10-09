# -*- coding: utf-8 -*-
"""deploy_r250.py —— 部署 importSalesBill（R250：平台自动判定 + 门禁原因透出）

🔴 铁律（技能 miniprogram-cloud-deploy）：
  ① **必带 `-r`**（= `--remote-npm-install`：不动云端依赖；本函数带首个非原生依赖 `xlsx`
     ⇒ 不带 `-r` 会覆盖云端 wx-server-sdk ⇒ 前端「网络不可用」）；
  ② **一次一个函数**（--names 只给一个）；
  ③ 判据**绝不按 `rc`**、**绝不按 `│` 匹配**（GBK）：判据 = 日志里某行**同时**含函数名 +
     ASCII `true` + 完成行；`filesCount` **必回磁盘数**对账。
  ④ 本函数目录下有 `common/` 派生的 `cx_*.js` ⇒ 部署前确认已跑过 tools/sync_common.js。
"""
import os, subprocess, sys, time

CLI = r"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
ENV = "cloud1-d4gphpoxy337f2a25"
FN = "importSalesBill"
ARCH = os.path.join(REPO, "review/evidence/r250_gate", "deploy_r250_raw.txt")

args = [CLI, "cloud", "functions", "deploy", "--names", FN, "-r", "-e", ENV, "--project", REPO]
print("CALL:", " ".join(args), flush=True)
t0 = time.time()
try:
    r = subprocess.run(args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    out = (r.stdout or "") + "\n--- STDERR ---\n" + (r.stderr or "")
    rc = r.returncode
except subprocess.TimeoutExpired as e:
    out = "TIMEOUT >600s\n" + str(e)
    rc = 124
open(ARCH, "w", encoding="utf-8").write(out)
print("RC =", rc, " elapsed=%.1fs" % (time.time() - t0), flush=True)

# 🔴 判据：只认「同时含函数名 + ASCII true」的行；绝不按 │ 匹配
hits = [ln for ln in out.splitlines() if FN in ln and "true" in ln]
done = [ln for ln in out.splitlines() if ("部署完成" in ln or "upload" in ln.lower() or "成功" in ln)]
print("含函数名+true 的行数 =", len(hits))
for ln in hits[:6]:
    print("   ", ln.strip()[:200])
print("疑似完成行数 =", len(done))
for ln in done[:6]:
    print("   ", ln.strip()[:200])
print("存档：", ARCH)
