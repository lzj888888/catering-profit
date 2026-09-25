"""监工的启停助手（全部基于心跳文件，不用 wmic，秒级返回）。

用法：
  <py> watch_start.py --status    # 看是否在跑（读 heartbeat.json）
  <py> watch_start.py --stop      # 让在跑的监工退出
  <py> watch_start.py --start     # 尝试脱离终端启动（注意：某些宿主会回收子进程，
                                  #   若起不来，改用宿主自身的后台任务方式跑 inscode_watch.py）
"""
import sys, os, json, time, subprocess

SCRIPT = r"C:\Users\lzj\.workbuddy\skills\inscode-desktop-feed\scripts\inscode_watch.py"
PY = r"C:\Users\lzj\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
WATCH = r"C:\Users\lzj\.config\inscode\watch"
STOPFILE = os.path.join(WATCH, "stop.flag")
HEART = os.path.join(WATCH, "heartbeat.json")
os.makedirs(WATCH, exist_ok=True)


def hb():
    try:
        d = json.load(open(HEART, encoding="utf-8"))
        d["age_s"] = int(time.time() - float(d.get("epoch", 0)))
        d["alive"] = d["age_s"] < 90
        return d
    except Exception:
        return None


def stop():
    open(STOPFILE, "w").close()
    h = hb()
    time.sleep(2)
    pid = (h or {}).get("pid")
    if pid:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    print("已请求停止（pid=%s）" % pid)


def start():
    DETACHED, NEWGRP, NO_WINDOW = 0x00000008, 0x00000200, 0x08000000
    logf = open(os.path.join(WATCH, "stdout.log"), "a", encoding="utf-8")
    p = subprocess.Popen([PY, SCRIPT], cwd=WATCH, stdout=logf, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL,
                         creationflags=DETACHED | NEWGRP | NO_WINDOW, close_fds=True)
    print("已尝试启动 pid=%d（6 秒后看心跳）" % p.pid)
    time.sleep(6)
    h = hb()
    print("心跳:%s" % ("存活 %ss 前" % h["age_s"] if h and h["alive"] else "未出现（说明被子进程回收阻断）"))


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--stop" in a:
        stop()
    elif "--start" in a:
        if (hb() or {}).get("alive"):
            print("已在运行：", hb())
        else:
            start()
    else:
        h = hb()
        print(json.dumps({"heartbeat": h,
                          "verdict": ("在跑" if h and h["alive"] else
                                      ("心跳过期（已退出或卡住）" if h else "从未启动")),
                          "stop_flag": os.path.exists(STOPFILE)}, ensure_ascii=False, indent=1))
