# -*- coding: utf-8 -*-
"""check_ide_ready.py —— 判「IDE GUI 到底起没起」（PITFALLS §45 的机器判据）

判据（两条全中才算就绪）：
  ① 进程表有 wechatdevtools.exe（用 gbk 解码读 tasklist，别用 grep 中文）
  ② 127.0.0.1:9420~9425 至少一个 OPEN

用法: python review/evidence/r252_gate/check_ide_ready.py
退出码: 0=就绪 / 1=未就绪
"""
import subprocess, socket, sys

def proc_ok():
    try:
        r = subprocess.run(["tasklist"], capture_output=True)
        txt = r.stdout.decode("gbk", "replace").lower()
        return "wechatdevtools.exe" in txt
    except Exception:
        return False

def port_ok():
    for p in range(9420, 9426):
        s = socket.socket(); s.settimeout(0.35)
        try:
            if s.connect_ex(("127.0.0.1", p)) == 0:
                s.close(); return p
        except Exception:
            pass
        finally:
            s.close()
    return 0

pr = proc_ok(); po = port_ok()
print("wechatdevtools.exe :", "OK" if pr else "MISSING")
print("server port        :", ("OPEN %d" % po) if po else "ALL CLOSED (9420~9425)")
if pr and po:
    print("IDE_READY")
    sys.exit(0)
print("IDE_NOT_READY")
sys.exit(1)
