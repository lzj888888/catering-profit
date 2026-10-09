# -*- coding: utf-8 -*-
"""店算 · 云函数部署器（一次一个 / 必带 -r / 流式落盘 / 机器判据 / 失败自动重跑）

用法：
    python review/evidence/_deploy_fns.py <fn1> [fn2 ...]
    python review/evidence/_deploy_fns.py --from-head        # 自动取「最近一次提交动过的 cloudfunctions 顶层目录」

判据：review/evidence/_judge_deploy.js（读原始字节走 latin1，只匹配 ASCII —— 某行同时含函数名 + `true`，
     且全文含完成行 `deploy cloudfunctions`）。**绝不用 `│`(U+2502) 匹配**：cli 输出是 GBK，表格线会 mojibake。

铁律：漏 `-r` 会连云端 wx-server-sdk 一起覆盖 ⇒ 前端全站报「网络不可用」。
      `rc` 永不作判据（cli 失败也返回 0）。首轮常因 IDE 通道未起而失败 ⇒ 直接重跑，别改代码。
"""
import io, os, sys, json, time, subprocess

REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
CLI = r"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"


def _pick_node():
    """判据用 node：**自适应解析**，别写死版本号。
    起因（R249）：原本硬编码 `.../versions/22.22.2-3/node.exe`，而本机已升到 `22.22.2-6`
    ⇒ judge 每次抛异常、把**成功的部署一律判成 MISS**（假阴性，浪费一轮重跑）。"""
    base = r"C:\Users\lzj\.workbuddy\binaries\node\versions"
    cands = []
    try:
        cands = sorted(os.listdir(base), reverse=True)
    except Exception:
        pass
    for c in cands + ["current"]:
        exe = os.path.join(base, c, "node.exe")
        if os.path.isfile(exe):
            return exe
    return "node"


NODE = _pick_node()
JUDGE = os.path.join(REPO, "review", "evidence", "_judge_deploy.js")
OUT = os.path.join(REPO, "_m3", "deploy_logs")


def env_id():
    cfg = json.load(io.open(os.path.join(REPO, "cloudfunctions", "initDb", "config.json"), encoding="utf-8"))
    return (cfg.get("envVariables") or cfg)["DEV_ENV_ID"]


def from_head():
    out = subprocess.run(["git", "show", "--name-only", "HEAD", "--", "cloudfunctions/"],
                         capture_output=True, text=True, cwd=REPO).stdout
    fns = []
    for ln in out.splitlines():
        if ln.startswith("cloudfunctions/"):
            parts = ln.split("/")
            if len(parts) > 2 and parts[1] not in ("common", "_adminCore"):
                if parts[1] not in fns:
                    fns.append(parts[1])
    return fns


def judge(log, fn):
    try:
        r = subprocess.run([NODE, JUDGE, log, fn], capture_output=True, text=True, cwd=REPO, timeout=60)
        return r.returncode == 0, (r.stdout or "").strip().replace("\n", " ")
    except Exception as e:
        return False, "judge 异常: %s" % e


def main():
    args = sys.argv[1:]
    fns = from_head() if (not args or args[0] == "--from-head") else args
    if not fns:
        print("没有需要部署的函数（本提交未动 cloudfunctions/）")
        return 0
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    env = env_id()
    print("ENV = %s   待部署 %d 个: %s" % (env, len(fns), ", ".join(fns)), flush=True)
    summary = []
    for fn in fns:
        hit, t_all = False, time.time()
        for attempt in (1, 2):
            log = os.path.join(OUT, "deploy_%s_%d.log" % (fn, attempt))
            cmd = ["cmd", "/c", CLI, "cloud", "functions", "deploy",
                   "--project", REPO, "-e", env, "--names", fn, "-r"]
            t0, rc = time.time(), None
            with open(log, "ab") as out:
                try:
                    rc = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT, timeout=240).returncode
                except subprocess.TimeoutExpired:
                    rc = "TIMEOUT"
            ok, msg = judge(log, fn)
            print("[%s] try%d rc=%s 用时=%.1fs %s | %s"
                  % (fn, attempt, rc, time.time() - t0, "HIT" if ok else "MISS", msg), flush=True)
            if ok:
                hit = True
                break
            print("    -> 未命中，重跑（首轮常因 IDE 通道未起失败）", flush=True)
        summary.append((fn, "OK" if hit else "FAIL", "%.0fs" % (time.time() - t_all)))

    print("\n===== 部署汇总 =====", flush=True)
    for fn, st, dur in summary:
        print("%-20s %-4s %s" % (fn, st, dur), flush=True)
    okn = sum(1 for _, s, _ in summary if s == "OK")
    print("---- %d/%d OK ----" % (okn, len(summary)), flush=True)
    with io.open(os.path.join(OUT, "_summary.txt"), "w", encoding="utf-8") as f:
        f.write("部署汇总 %s\nENV=%s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), env))
        for fn, st, dur in summary:
            f.write("%-20s %-4s %s\n" % (fn, st, dur))
        f.write("---- %d/%d OK ----\n" % (okn, len(summary)))
    return 0 if okn == len(summary) else 1


if __name__ == "__main__":
    sys.exit(main())
