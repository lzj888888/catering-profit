# -*- coding: utf-8 -*-
"""R357 出码（改过 .wxml ⇒ 必须证明包能编译，门禁绿不算）"""
import os
import subprocess
import sys

CLI = r"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
OUT = os.path.join(REPO, "review", "evidence", "r357_qr")
QR = os.path.join(OUT, "qr_r357.png")
LOG = os.path.join(OUT, "preview_r357.txt")

os.makedirs(OUT, exist_ok=True)
if os.path.exists(QR):
    os.remove(QR)

lines = []


def run(cmd, tmo):
    lines.append("$ " + " ".join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=tmo, cwd=REPO)
        out = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
        lines.append("[rc=%s]" % r.returncode)
        lines.append(out)
        return r.returncode, out
    except subprocess.TimeoutExpired as e:
        o = (e.stdout or b"").decode("utf-8", "replace") + (e.stderr or b"").decode("utf-8", "replace")
        lines.append("[TIMEOUT]")
        lines.append(o)
        return -9, o


# ① 先把项目打开（IDE 退化时直接 preview 会卡满 10 分钟且 rc 仍为 0）
run([CLI, "open", "--project", REPO, "--port", "10896"], 300)

# ② 真出码
rc, out = run([CLI, "preview", "--project", REPO, "--port", "10896",
               "--qr-format", "image", "--qr-output", QR], 600)

size = os.path.getsize(QR) if os.path.exists(QR) else -1
lines.append("")
lines.append("QR = %s" % QR)
lines.append("SIZE = %d" % size)
lines.append("HAS_APPID = %s" % ("Using AppID" in out))
lines.append("HAS_PKG_TABLE = %s" % ("TOTAL" in out))

with open(LOG, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("\n".join(lines[-8:]))
ok = size > 10000 and "Using AppID" in out
print("VERDICT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
