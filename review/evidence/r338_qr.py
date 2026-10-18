"""R338 出码：不阻塞 cli.bat（它派生的子进程持有管道，subprocess.run 的 timeout 不生效）。
步骤：Popen open → 轮询 10896 端口 → Popen preview → 轮询产物文件。
判据：产物文件存在 + 字节数 > 1000，rc 不作数（台账 R337 记过：rc=0 也可能没产物）。
"""
import subprocess
import os
import time
import shutil
import socket

CLI = r"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
D = os.path.join(REPO, "review/evidence/r338_a2")
os.makedirs(D, exist_ok=True)
OUT = os.path.join(D, "qr_%s.png" % time.strftime("%H%M"))


def port_open(host, port, timeout=1.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((host, port)) == 0
    finally:
        s.close()


print("[%s] 检查 10896 是否已在监听..." % time.strftime("%H:%M:%S"), flush=True)
if port_open("127.0.0.1", 10896):
    print("  已在监听，跳过 open", flush=True)
else:
    print("  未监听 ⇒ 启动 open", flush=True)
    subprocess.Popen([CLI, "open", "--project", REPO, "--port", "10896"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for i in range(36):                     # 最多 180s
        time.sleep(5)
        if port_open("127.0.0.1", 10896):
            print("  [%s] 端口已就绪（等了 %ds）" % (time.strftime("%H:%M:%S"), (i + 1) * 5), flush=True)
            break
        if i % 3 == 0:
            print("  [%s] 等待中 %ds" % (time.strftime("%H:%M:%S"), (i + 1) * 5), flush=True)
    else:
        print("  ❌ 180s 内端口未就绪（IDE 起不来）", flush=True)
        raise SystemExit(2)

time.sleep(3)
print("[%s] 启动 preview → %s" % (time.strftime("%H:%M:%S"), os.path.basename(OUT)), flush=True)
subprocess.Popen([CLI, "preview", "--project", REPO, "--port", "10896",
                  "--qr-format", "image", "--qr-output", OUT],
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

for i in range(48):                          # 最多 240s
    time.sleep(5)
    if os.path.exists(OUT) and os.path.getsize(OUT) > 1000:
        print("  ✅ [%s] 产物生成：%d 字节（等了 %ds）"
              % (time.strftime("%H:%M:%S"), os.path.getsize(OUT), (i + 1) * 5), flush=True)
        dst = os.path.join(os.path.expanduser("~"), "Desktop",
                           "店算_真机预览码_%s.png" % time.strftime("%H%M"))
        shutil.copyfile(OUT, dst)
        print("  桌面：%s" % dst, flush=True)
        break
    if i % 6 == 0:
        print("  [%s] 等产物 %ds（当前 %s）"
              % (time.strftime("%H:%M:%S"), (i + 1) * 5,
                 os.path.getsize(OUT) if os.path.exists(OUT) else "无文件"), flush=True)
else:
    print("  ❌ 240s 内无产物 ⇒ 编译失败或 IDE 无响应", flush=True)
    raise SystemExit(3)
